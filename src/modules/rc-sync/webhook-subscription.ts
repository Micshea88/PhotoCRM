import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { log } from "@/lib/log"
import { ringCentralClientWithToken, RingCentralApiError } from "@/lib/ringcentral/client"
import { telephonyConnections } from "@/modules/telephony/schema"
import { getValidAccessToken } from "@/modules/telephony/token-refresh"
import { enqueueIfNoActiveJob } from "@/modules/rc-sync/queries"
import { isRcSyncEnabled, kickRcSyncConsumer } from "@/modules/rc-sync/runner"
import { parseDisconnectedSessions } from "@/modules/rc-sync/webhook-parse"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Account-level telephony/sessions webhook, filtered to finished calls. One
 * subscription per RC account (multi-account is V2 — Mike-locked). The
 * `?statusCode=Disconnected` filter means RC only delivers hang-up events, so
 * the webhook fires ~once per completed call instead of 3-4× per session.
 */
const TELEPHONY_SESSIONS_EVENT_FILTER =
  "/restapi/v1.0/account/~/telephony/sessions?statusCode=Disconnected"

/** RC subscriptions expire after ~7 days; we request the 7-day max and the
 *  daily refresh-telephony-tokens cron renews well before the boundary. */
const WEBHOOK_EXPIRES_IN_SECONDS = 604800

/** Build the per-org webhook delivery address. The org id in the path is how
 *  the route resolves which org an event belongs to; the global verification
 *  token authenticates that the delivery genuinely came from RC. */
function webhookAddressForOrg(organizationId: string): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")
  return `${base}/api/webhooks/ringcentral/telephony/${organizationId}`
}

export interface EnsureWebhookResult {
  action: "created" | "renewed" | "skipped"
  subscriptionId: string | null
  reason?: string
}

/**
 * Create-or-renew the account telephony webhook for one (org, user) RC
 * connection. MACHINE context: the access token is fetched tx-bound via
 * `getValidAccessToken(args, tx)` (no request ALS — same discipline as the
 * worker; see runner.ts), then a `ringCentralClientWithToken` client is built
 * from it. Persists the subscription id back onto the connection row.
 *
 * Idempotent: an existing subscription id is renewed; if renewal fails
 * (expired / deleted RC-side → 4xx) it falls through to a fresh create. The
 * bootstrap button and the daily cron both call this.
 *
 * Requires `RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN` to be configured — without
 * it the delivered events could not be authenticated, so we refuse to create a
 * subscription and return `skipped`.
 */
export async function ensureWebhookSubscription(
  tx: DbHandle,
  args: { organizationId: string; userId: string },
): Promise<EnsureWebhookResult> {
  const verificationToken = env.RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN
  if (!verificationToken) {
    log.warn(
      { feature: "rc-sync.webhook", organizationId: args.organizationId },
      "[rc-sync] RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN not set — cannot create subscription",
    )
    return { action: "skipped", subscriptionId: null, reason: "no_verification_token" }
  }

  const [row] = await tx
    .select({
      id: telephonyConnections.id,
      webhookSubscriptionId: telephonyConnections.webhookSubscriptionId,
    })
    .from(telephonyConnections)
    .where(
      and(
        eq(telephonyConnections.organizationId, args.organizationId),
        eq(telephonyConnections.userId, args.userId),
        eq(telephonyConnections.provider, "ringcentral"),
        isNull(telephonyConnections.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    return { action: "skipped", subscriptionId: null, reason: "no_connection" }
  }

  const { token } = await getValidAccessToken(args, tx)
  const client = ringCentralClientWithToken(token)
  const address = webhookAddressForOrg(args.organizationId)

  // Try renew first if we already have a subscription id.
  if (row.webhookSubscriptionId) {
    try {
      const renewed = await client.renewWebhook(
        row.webhookSubscriptionId,
        WEBHOOK_EXPIRES_IN_SECONDS,
      )
      if (renewed.id !== row.webhookSubscriptionId) {
        await tx
          .update(telephonyConnections)
          .set({ webhookSubscriptionId: renewed.id, updatedAt: new Date() })
          .where(eq(telephonyConnections.id, row.id))
      }
      return { action: "renewed", subscriptionId: renewed.id }
    } catch (err) {
      // 4xx → the subscription is gone/expired RC-side; recreate. Re-throw
      // anything else (network / 5xx / rate-limit) so the caller can retry.
      const recoverable =
        err instanceof RingCentralApiError && err.status >= 400 && err.status < 500
      if (!recoverable) throw err
      log.warn(
        {
          feature: "rc-sync.webhook",
          organizationId: args.organizationId,
          status: err instanceof RingCentralApiError ? err.status : undefined,
        },
        "[rc-sync] subscription renew failed (gone/expired) — recreating",
      )
    }
  }

  const created = await client.subscribeWebhook({
    eventFilters: [TELEPHONY_SESSIONS_EVENT_FILTER],
    address,
    expiresIn: WEBHOOK_EXPIRES_IN_SECONDS,
    verificationToken,
  })
  await tx
    .update(telephonyConnections)
    .set({ webhookSubscriptionId: created.id, updatedAt: new Date() })
    .where(eq(telephonyConnections.id, row.id))
  return { action: "created", subscriptionId: created.id }
}

/**
 * Ingest one verified webhook delivery for `organizationId`: parse the
 * Disconnected session id(s) and dedup-enqueue a `call_log` sync job for each,
 * then kick the consumer. Runs each enqueue inside a per-org machine-context tx
 * (SET LOCAL ROLE + app.current_org) so the RLS-protected insert + existence
 * check are org-scoped — the workflow-execute / worker pattern.
 *
 * No-op (returns 0) when RC_SYNC_ENABLED is off; the route always acks 200.
 * Best-effort kick — the 5-minute cron sweep is the durable backstop if it
 * fails.
 */
export async function ingestDisconnectedSessions(
  organizationId: string,
  payload: unknown,
): Promise<{ enqueued: number; skipped: number }> {
  if (!isRcSyncEnabled()) return { enqueued: 0, skipped: 0 }

  const sessionIds = parseDisconnectedSessions(payload)
  if (sessionIds.length === 0) return { enqueued: 0, skipped: 0 }

  let enqueued = 0
  let skipped = 0
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
    await tx.execute(sql`SELECT set_config('app.current_org', ${organizationId}, true)`)
    await tx.execute(sql`SELECT set_config('app.current_role', 'admin', true)`)
    for (const telephonySessionId of sessionIds) {
      const res = await enqueueIfNoActiveJob(tx, {
        organizationId,
        kind: "call_log",
        telephonySessionId,
      })
      if (res.enqueued) enqueued += 1
      else skipped += 1
    }
  })

  if (enqueued > 0) kickRcSyncConsumer()
  return { enqueued, skipped }
}
