"use server"

import { z } from "zod"
import { and, eq, isNull } from "drizzle-orm"
import { orgAction, ActionError } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { RingCentralApiError } from "@/lib/ringcentral/client"
import { telephonyConnections } from "@/modules/telephony/schema"
import { enqueueIfNoActiveJob } from "@/modules/rc-sync/queries"
import { isRcSyncEnabled, kickRcSyncConsumer } from "@/modules/rc-sync/runner"
import { ensureWebhookSubscription } from "@/modules/rc-sync/webhook-subscription"

const enqueueCallSyncInput = z.object({
  telephonySessionId: z.string().min(1),
})

/**
 * Layer 2 producer. Called by the dialer after a Pathway-witnessed call is
 * logged: enqueues a `call_log` sync job keyed by the telephony session id
 * (the precise Rule-0 reconciliation key) and kicks the consumer.
 *
 * Dedup-aware (`enqueueIfNoActiveJob`): the account webhook (Layer 1) fires for
 * the same session id, so whichever producer lands first wins and the other is
 * a no-op — no duplicate jobs for one call.
 *
 * Best-effort + flag-gated: when RC_SYNC_ENABLED is off it's a no-op, so the
 * dialer can call it unconditionally. No audit (operational queue insert, not
 * a user-facing resource); no revalidate (no rendered page changes here — the
 * row's disposition badge re-renders when the worker writes RC truth and the
 * activity feed refetches).
 */
export const enqueueCallSync = orgAction
  .metadata({ actionName: "rc_sync.enqueue_call" })
  .inputSchema(enqueueCallSyncInput)
  .action(async ({ parsedInput, ctx }) => {
    if (!isRcSyncEnabled()) return { skipped: true as const }
    await enqueueIfNoActiveJob(ctx.db, {
      organizationId: ctx.activeOrg.id,
      kind: "call_log",
      telephonySessionId: parsedInput.telephonySessionId,
    })
    kickRcSyncConsumer()
    return { ok: true as const }
  })

const bootstrapRcWebhookInput = z.object({})

/**
 * Layer 1 bootstrap — the one-time "Enable call sync" Settings button.
 * Owner/admin only (defense-in-depth re-check; the wizard render-gate is the
 * primary check). Creates (or renews, if already present) the account-level
 * telephony webhook subscription so cell-/Kelly-/desk-answered calls start
 * auto-appearing in Pathway. The daily cron renews it silently thereafter.
 *
 * Idempotent: clicking again ("Refresh") renews the existing subscription or
 * recreates a gone one. Audited (a real configuration change to the workspace's
 * telephony integration).
 */
export const bootstrapRcWebhook = orgAction
  .metadata({ actionName: "rc_sync.bootstrap_webhook" })
  .inputSchema(bootstrapRcWebhookInput)
  .action(async ({ ctx }) => {
    if (ctx.activeOrg.role !== "owner" && ctx.activeOrg.role !== "admin") {
      throw new ActionError(
        "FORBIDDEN",
        "Only owners and admins can enable call sync for this workspace.",
      )
    }
    if (!isRcSyncEnabled()) {
      throw new ActionError(
        "VALIDATION",
        "Call sync is not enabled for this deployment yet. Contact support.",
      )
    }

    // Resolve a live RC connection to authenticate as. The webhook is
    // account-level (one per RC account), so any live connection works; prefer
    // the acting user's own connection when present.
    const liveRows = await ctx.db
      .select({ userId: telephonyConnections.userId })
      .from(telephonyConnections)
      .where(
        and(
          eq(telephonyConnections.provider, "ringcentral"),
          isNull(telephonyConnections.deletedAt),
        ),
      )
    const firstUserId = liveRows[0]?.userId
    if (!firstUserId) {
      throw new ActionError("NOT_FOUND", "Connect RingCentral first, then enable call sync.")
    }
    const userId = liveRows.find((r) => r.userId === ctx.activeOrg.userId)?.userId ?? firstUserId

    let result
    try {
      result = await ensureWebhookSubscription(ctx.db, {
        organizationId: ctx.activeOrg.id,
        userId,
      })
    } catch (err) {
      // Surface RC's exact response body so the operator sees the actual cause
      // ("RC 400: <body>") instead of a bare "RingCentral API error 400". The
      // body is bounded (RC returns short JSON) but truncate defensively.
      if (err instanceof RingCentralApiError) {
        const body = (err.body || "(empty body)").slice(0, 400)
        throw new ActionError("VALIDATION", `RingCentral ${String(err.status)}: ${body}`)
      }
      throw err
    }
    if (result.action === "skipped") {
      throw new ActionError(
        "VALIDATION",
        "Could not enable call sync — the webhook secret is not configured. Contact support.",
      )
    }

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "rc_sync.webhook_bootstrapped",
      { metadata: { subscriptionId: result.subscriptionId, mode: result.action } },
    )

    return { ok: true as const, action: result.action }
  })
