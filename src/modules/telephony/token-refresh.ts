import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { decrypt } from "@/lib/crypto"
import { env } from "@/lib/env"
import { log } from "@/lib/log"
import { withOrgContext } from "@/lib/org-context"
import { telephonyConnections } from "@/modules/telephony/schema"
import { upsertRingCentralConnection } from "@/modules/telephony/upsert"
import { RingCentralOAuthNotConfigured } from "@/modules/telephony/ringcentral-oauth"
import type { RingCentralTokenResponse } from "@/modules/telephony/ringcentral-oauth"

/**
 * Server-side pre-emptive token refresh for RingCentral connections.
 *
 * UX CONTRACT (locked):
 *   - Refresh failures NEVER surface to the user.
 *   - Connection stays "connected" in the UI from the moment of OAuth
 *     grant until the user explicitly clicks Disconnect.
 *   - No "needs reconnect" banner, no greyed-out buttons, no
 *     soft-delete on auth failure. Same UX as a dropped Wi-Fi packet.
 *   - Callers catch the typed errors, log via pino, and silently
 *     abort the operation. The user clicks again, the system
 *     self-heals (or silently fails again — same pattern as HubSpot
 *     / Salesforce integrations).
 *
 * CONCURRENCY:
 *   - SELECT ... FOR UPDATE on the row inside a transaction
 *     serializes concurrent refreshes across all Vercel instances.
 *     Two parallel callers → first wins, second waits, second
 *     re-reads after the lock and returns the now-fresh token.
 *   - In-memory promise dedup REJECTED — doesn't span Vercel
 *     function instances; FOR UPDATE does.
 *
 * BUFFER:
 *   - 10 minutes (not 5). Typical sales/support calls run 15-30 min;
 *     a 5-min buffer can leave a call mid-renegotiation with a stale
 *     token. 10 min captures >99th percentile of call durations
 *     within a single token's validity.
 *
 * MONTHS-LATER RESURRECTION:
 *   - RC refresh tokens last ~7 days. Each successful refresh issues
 *     a new refresh token with a fresh TTL — the chain stays alive
 *     as long as we refresh at least every ~6 days.
 *   - `app/api/jobs/cron/refresh-telephony-tokens` runs daily at 4am
 *     UTC and force-refreshes anything with `refresh_token_expires_at
 *     < now() + 2 days` via `refreshConnectionUnconditionally` below.
 *     2-day buffer means a single missed cron run doesn't kill the
 *     chain.
 */

type DbHandle = NodePgDatabase<typeof schema>

/** 10-minute pre-emptive refresh buffer. See module docstring. */
const REFRESH_BUFFER_MS = 10 * 60 * 1000

/**
 * Permanent-ish RC auth failure (invalid_grant, invalid_client,
 * unauthorized_client, no_active_connection). INTERNAL — callers
 * catch this and silently abort. Never bubble to UI.
 */
export class RingCentralAuthError extends Error {
  constructor(public readonly code: string) {
    super(`RingCentral auth error (${code})`)
    this.name = "RingCentralAuthError"
  }
}

/**
 * Retry-able RC failure (network, 5xx, 429). INTERNAL — callers
 * catch this and silently abort. The next user action triggers a
 * fresh attempt.
 */
export class RingCentralTransientError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail?: string,
  ) {
    super(`RingCentral transient error (${code})`)
    this.name = "RingCentralTransientError"
  }
}

/**
 * Return a usable access token plus whether a rotation occurred.
 * Refreshes pre-emptively if within the 10-min expiry buffer;
 * otherwise returns the existing decrypted one. SELECT FOR UPDATE
 * inside the transaction serializes against concurrent refreshes.
 *
 * The `rotated` flag is TRUE only when this call performed the OAuth
 * refresh-token grant (the within-buffer branch). When the cached
 * token is still fresh enough — OR a concurrent caller already
 * refreshed and we re-read their fresh row — `rotated` is FALSE.
 * Callers use this to gate audit / metric emission so a cache hit
 * doesn't write an audit row for a non-event.
 *
 * Pass `tx` when called from inside an existing transaction (server
 * action's `ctx.db`, webhook handler's `withOrgContext` scope).
 * Omit `tx` when calling from a context that doesn't already hold
 * one — the helper opens its own via `withOrgContext`.
 */
export async function getValidAccessToken(
  args: { organizationId: string; userId: string },
  tx?: DbHandle,
): Promise<{ token: string; rotated: boolean }> {
  if (tx) return getValidAccessTokenInTx(tx, args)
  return withOrgContext((innerTx) => getValidAccessTokenInTx(innerTx, args))
}

async function getValidAccessTokenInTx(
  tx: DbHandle,
  args: { organizationId: string; userId: string },
): Promise<{ token: string; rotated: boolean }> {
  // SELECT ... FOR UPDATE: serializes concurrent callers across all
  // Vercel instances. After acquiring the lock we have the most
  // recent expiry/cipher state — if another caller refreshed first
  // we see their result here.
  const [row] = await tx
    .select({
      accessToken: telephonyConnections.accessToken,
      refreshToken: telephonyConnections.refreshToken,
      accessTokenExpiresAt: telephonyConnections.accessTokenExpiresAt,
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
    .for("update")

  if (!row) {
    throw new RingCentralAuthError("no_active_connection")
  }

  const now = Date.now()
  if (row.accessTokenExpiresAt.getTime() > now + REFRESH_BUFFER_MS) {
    // Not near expiry — either we got here first or a concurrent
    // caller already refreshed and we re-read the fresh row. Either
    // way no rotation occurred on THIS call.
    return { token: decrypt(row.accessToken), rotated: false }
  }

  // Within the 10-min buffer — refresh.
  const refreshTokenPlaintext = decrypt(row.refreshToken)
  const newTokens = await performRefresh(refreshTokenPlaintext)
  await upsertRingCentralConnection(tx, {
    organizationId: args.organizationId,
    userId: args.userId,
    tokens: newTokens,
  })
  return { token: newTokens.access_token, rotated: true }
}

/**
 * Forced refresh used by the daily resurrection cron. Bypasses the
 * access-token-expiry check; refreshes regardless to keep the
 * refresh_token chain alive during dormancy. Same lock + same upsert
 * write path as the runtime helper.
 *
 * Returns `{ token, rotated: true }` — `rotated` is always TRUE
 * here by definition (the function name says it: unconditional
 * refresh; no skip-if-fresh branch exists). The shape matches
 * `getValidAccessToken` so the same { token, rotated } contract
 * holds at every callable in this module; the cron handler
 * currently discards the return value.
 *
 * Caller (the cron handler) MUST already be inside a transaction
 * with RLS context set — typically via `runWithOrgContext` +
 * `withOrgContext` after resolving the connection's
 * (organizationId, userId, role).
 */
export async function refreshConnectionUnconditionally(
  tx: DbHandle,
  args: { organizationId: string; userId: string },
): Promise<{ token: string; rotated: boolean }> {
  const [row] = await tx
    .select({ refreshToken: telephonyConnections.refreshToken })
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
    .for("update")
  if (!row) {
    throw new RingCentralAuthError("no_active_connection")
  }
  const refreshTokenPlaintext = decrypt(row.refreshToken)
  const newTokens = await performRefresh(refreshTokenPlaintext)
  await upsertRingCentralConnection(tx, {
    organizationId: args.organizationId,
    userId: args.userId,
    tokens: newTokens,
  })
  return { token: newTokens.access_token, rotated: true }
}

/**
 * OAuth refresh_token grant. Server-side fetch with Basic auth
 * (client_id:client_secret). Maps RC response to typed errors:
 *   - HTTP 400/401/403 → RingCentralAuthError (permanent-ish)
 *   - HTTP 5xx / 429 / network error → RingCentralTransientError
 *
 * Logs error code + status via pino (feature:
 * "telephony.token-refresh") at warn level. NEVER logs the
 * plaintext tokens — only the RC-side error code and HTTP status.
 */
async function performRefresh(refreshToken: string): Promise<RingCentralTokenResponse> {
  const { RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_SERVER_URL } = env
  if (!RINGCENTRAL_CLIENT_ID || !RINGCENTRAL_CLIENT_SECRET || !RINGCENTRAL_SERVER_URL) {
    throw new RingCentralOAuthNotConfigured()
  }
  const basic = Buffer.from(`${RINGCENTRAL_CLIENT_ID}:${RINGCENTRAL_CLIENT_SECRET}`).toString(
    "base64",
  )
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
  const tokenUrl = `${RINGCENTRAL_SERVER_URL.replace(/\/$/, "")}/restapi/oauth/token`

  let res: Response
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    log.warn(
      { feature: "telephony.token-refresh", err: detail },
      "[token-refresh] network error reaching RingCentral",
    )
    throw new RingCentralTransientError("network_error", detail)
  }

  if (res.ok) {
    return (await res.json()) as RingCentralTokenResponse
  }

  let providerCode = "unknown"
  let providerDetail = ""
  try {
    const errBody = (await res.json()) as { error?: string; error_description?: string }
    if (typeof errBody.error === "string") providerCode = errBody.error
    if (typeof errBody.error_description === "string") providerDetail = errBody.error_description
  } catch {
    // Fall through with generic code.
  }

  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    log.warn(
      {
        feature: "telephony.token-refresh",
        providerCode,
        status: res.status,
      },
      "[token-refresh] auth error from RingCentral",
    )
    throw new RingCentralAuthError(providerCode)
  }

  log.warn(
    {
      feature: "telephony.token-refresh",
      providerCode,
      status: res.status,
    },
    "[token-refresh] transient error from RingCentral",
  )
  throw new RingCentralTransientError(providerCode, providerDetail)
}
