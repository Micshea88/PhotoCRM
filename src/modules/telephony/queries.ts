import "server-only"
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { withOrgContext } from "@/lib/org-context"
import { contacts } from "@/modules/contacts/schema"
import { getProvidersByCategory } from "@/modules/integrations/registry"
import { telephonyConnections } from "@/modules/telephony/schema"
import { decrypt, encrypt } from "@/lib/crypto"
import { env } from "@/lib/env"
import { log } from "@/lib/log"
import { RingCentralOAuthNotConfigured } from "@/modules/telephony/ringcentral-oauth"
import {
  RingCentralAuthError,
  RingCentralTransientError,
  getValidAccessToken,
} from "@/modules/telephony/token-refresh"

/**
 * Org-scoped read of live telephony connections. Used by the
 * Integrations Hub (Browse / Connected Apps / provider wizard) AND
 * by the contact-card affordance to decide which branch (no-connection
 * picker vs ready-for-dialer) to render.
 *
 * Returns only fields that are safe to surface client-side — never
 * accessToken/refreshToken/validationToken. Decryption (when ever
 * needed) happens at point of use in a server-only path, not here.
 *
 * Each function is split into a public wrapper (reads ALS via
 * withOrgContext — what server components call) and an `Impl` variant
 * that takes a tx directly (single source of truth that integration
 * tests can drive against the test's BEGIN/ROLLBACK transaction).
 * Same pattern as src/modules/telephony/upsert.ts and
 * src/modules/telephony/disconnect.ts.
 */

type DbHandle = NodePgDatabase<typeof schema>

export interface ConnectedProviderRow {
  id: string
  userId: string
  provider: string
  scope: string
  externalUserId: string
  accessTokenExpiresAt: Date
  refreshTokenExpiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export async function listConnectedProvidersForOrgImpl(
  tx: DbHandle,
): Promise<ConnectedProviderRow[]> {
  return tx
    .select({
      id: telephonyConnections.id,
      userId: telephonyConnections.userId,
      provider: telephonyConnections.provider,
      scope: telephonyConnections.scope,
      externalUserId: telephonyConnections.externalUserId,
      accessTokenExpiresAt: telephonyConnections.accessTokenExpiresAt,
      refreshTokenExpiresAt: telephonyConnections.refreshTokenExpiresAt,
      createdAt: telephonyConnections.createdAt,
      updatedAt: telephonyConnections.updatedAt,
    })
    .from(telephonyConnections)
    .where(isNull(telephonyConnections.deletedAt))
}

/** All live connections in the current org (any user). */
export async function listConnectedProvidersForOrg(): Promise<ConnectedProviderRow[]> {
  return withOrgContext(listConnectedProvidersForOrgImpl)
}

export async function listConnectedProvidersForUserImpl(
  tx: DbHandle,
  userId: string,
): Promise<ConnectedProviderRow[]> {
  return tx
    .select({
      id: telephonyConnections.id,
      userId: telephonyConnections.userId,
      provider: telephonyConnections.provider,
      scope: telephonyConnections.scope,
      externalUserId: telephonyConnections.externalUserId,
      accessTokenExpiresAt: telephonyConnections.accessTokenExpiresAt,
      refreshTokenExpiresAt: telephonyConnections.refreshTokenExpiresAt,
      createdAt: telephonyConnections.createdAt,
      updatedAt: telephonyConnections.updatedAt,
    })
    .from(telephonyConnections)
    .where(and(eq(telephonyConnections.userId, userId), isNull(telephonyConnections.deletedAt)))
}

/** Live connections for one user in the current org. */
export async function listConnectedProvidersForUser(
  userId: string,
): Promise<ConnectedProviderRow[]> {
  return withOrgContext((tx) => listConnectedProvidersForUserImpl(tx, userId))
}

/**
 * Org-level "is call sync enabled?" — does ANY live RingCentral connection in
 * the current org carry a webhook subscription id? Drives the Settings →
 * Integrations "Enable call sync" button state (Enabled vs not). The webhook is
 * account-level (one-per-RC-account), so the subscription lives on whichever
 * connection bootstrapped it; this checks org-wide rather than per-user.
 *
 * `webhook_subscription_id` is an opaque RC id, not a secret — safe to reduce
 * to a boolean for the client. Tokens/validationToken are never read here.
 */
export async function orgRcCallSyncEnabledImpl(tx: DbHandle): Promise<boolean> {
  const rows = await tx
    .select({ id: telephonyConnections.id })
    .from(telephonyConnections)
    .where(
      and(
        eq(telephonyConnections.provider, "ringcentral"),
        isNull(telephonyConnections.deletedAt),
        isNotNull(telephonyConnections.webhookSubscriptionId),
      ),
    )
    .limit(1)
  return rows.length > 0
}

/** Public wrapper — org-context read of the call-sync enabled flag. */
export async function orgRcCallSyncEnabled(): Promise<boolean> {
  return withOrgContext(orgRcCallSyncEnabledImpl)
}

/**
 * Storable phone-provider ids — derived from the registry's Phone
 * category, filtered to providers that actually have a backing
 * connection (`connectKind !== "none"` excludes the tel: pseudo-
 * provider which is always-available and never written to
 * telephony_connections). Computed once at module load; a registry
 * edit reflects automatically with no separate update here.
 */
const STORABLE_PHONE_PROVIDER_IDS: ReadonlySet<string> = new Set(
  getProvidersByCategory("phone")
    .filter((p) => p.connectKind !== "none")
    .map((p) => p.id),
)

export async function userHasConnectedPhoneProviderImpl(
  tx: DbHandle,
  userId: string,
): Promise<boolean> {
  const ids = Array.from(STORABLE_PHONE_PROVIDER_IDS)
  if (ids.length === 0) return false
  const rows = await tx
    .select({ exists: sql<number>`1` })
    .from(telephonyConnections)
    .where(
      and(
        eq(telephonyConnections.userId, userId),
        isNull(telephonyConnections.deletedAt),
        inArray(telephonyConnections.provider, ids),
      ),
    )
    .limit(1)
  return rows.length > 0
}

/**
 * Cheap existence check: does the current user have at least one
 * live phone-category connection in the current org?
 *
 * Implemented as `select 1 ... limit 1` so it never hydrates token
 * expiries, scope, externalUserId, or any other column across the
 * boundary just to answer a boolean.
 */
export async function userHasConnectedPhoneProvider(userId: string): Promise<boolean> {
  return withOrgContext((tx) => userHasConnectedPhoneProviderImpl(tx, userId))
}

/**
 * Bootstrap payload returned by `getDialerBootstrap`; consumed by
 * `app/dialer/page.tsx` (server component) and passed as a prop to
 * `<DialerShell />`.
 *
 * Wire format: every field is JSON-serializable (sipInfo is typed
 * `unknown` to keep the server SDK-agnostic — the client narrows it
 * at the `new WebPhone({ sipInfo })` call boundary).
 *
 * `accessTokenExpiresAt` is for the client's mid-call refresh
 * scheduler — the shell sets a setTimeout for
 * `expiresAt - 10min - now` and calls `refreshAccessTokenForDialer`
 * when it fires.
 *
 * `sipInfo` is the SIP-provisioning grant from RingCentral; consumed
 * by `new WebPhone({ sipInfo })`. RC's docs note it's reusable for a
 * long time — v1 fetches fresh on each boot; a future optimization
 * may cache it in DB.
 *
 * Contains SIP digest credentials (sipInfo) and an OAuth access token.
 * Never log either; never expose to anyone but the dialer popup
 * authenticated as the org member who owns the connection.
 */
export interface DialerBootstrap {
  accessToken: string
  accessTokenExpiresAt: Date
  sipInfo: unknown
  externalUserId: string
}

/**
 * Inner-tx variant of `getDialerBootstrap`. Takes a Drizzle tx that is
 * already inside `withOrgContext` (or an equivalent transactional
 * RLS-context wrapper) — `getValidAccessToken` runs `SELECT FOR
 * UPDATE` against the connection row, which requires the tx and the
 * `app.current_org` GUC to be set.
 *
 * Throws `RingCentralAuthError("no_active_connection")` when the org
 * has no live RingCentral connection (matches the
 * `getValidAccessToken` contract). Throws `RingCentralAuthError` /
 * `RingCentralTransientError` from `fetchSipProvisioning` on
 * RC-side errors. Callers up the stack catch and render inline
 * (no silent self-healing at boot — see module-header note).
 */
export async function getDialerBootstrapImpl(
  tx: DbHandle,
  args: { organizationId: string; userId: string },
): Promise<DialerBootstrap> {
  // 1. Get a usable access token.
  const { token: accessToken } = await getValidAccessToken(
    { organizationId: args.organizationId, userId: args.userId },
    tx,
  )

  // 2. Read the row for the metadata fields + cached sipInfo.
  const [row] = await tx
    .select({
      id: telephonyConnections.id,
      accessTokenExpiresAt: telephonyConnections.accessTokenExpiresAt,
      externalUserId: telephonyConnections.externalUserId,
      sipInfoCached: telephonyConnections.sipInfoCached,
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
    throw new RingCentralAuthError("no_active_connection")
  }

  // 3. SipInfo — cache hit decrypts + parses; cache miss fetches +
  //    encrypts + UPDATEs the row in the same tx so subsequent
  //    bootstraps skip the sip-provision REST call entirely.
  //    Steady-state: 1 RC REST call per layout render (the
  //    extension fetch in step 4); cold-cache: 2 REST calls.
  let sipInfo: unknown = null
  if (row.sipInfoCached) {
    try {
      sipInfo = JSON.parse(decrypt(row.sipInfoCached))
    } catch (e) {
      // Cached value is corrupt (key rotation? bad write?). Fall
      // through to fresh fetch — caching corrupt data forever would
      // be worse than the per-render REST call.
      const detail = e instanceof Error ? e.message : String(e)
      log.warn(
        { feature: "telephony.sip-provision", err: detail },
        "[sip-provision] cached value failed to decrypt/parse; re-fetching",
      )
      sipInfo = null
    }
  }
  if (sipInfo === null) {
    sipInfo = await fetchSipProvisioning(accessToken)
    const cipher = encrypt(JSON.stringify(sipInfo))
    await tx
      .update(telephonyConnections)
      .set({ sipInfoCached: cipher, sipInfoCachedAt: new Date() })
      .where(eq(telephonyConnections.id, row.id))
  }

  return {
    accessToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    sipInfo,
    externalUserId: row.externalUserId,
  }
}

/**
 * Public wrapper for `getDialerBootstrapImpl`. Opens its own org-
 * context tx via `withOrgContext`; the page (`app/dialer/page.tsx`)
 * supplies `organizationId` + `userId` from `withPageOrgContext`'s
 * resolved `OrgContext`.
 */
export async function getDialerBootstrap(args: {
  organizationId: string
  userId: string
}): Promise<DialerBootstrap> {
  return withOrgContext((tx) => getDialerBootstrapImpl(tx, args))
}

export interface ContactPhoneMatch {
  contactId: string
  name: string
}

/**
 * Caller-ID → contact match for the inbound answer UI (3b). Takes a
 * pre-normalized 10-digit string (the action normalizes via
 * `parsePhoneInput`) and matches it against `primary_phone` /
 * `secondary_phone`, digit-normalizing each stored value in SQL and
 * comparing on its last 10 digits so formatted / leading-1 legacy rows
 * still match. Returns the first hit (the banner needs one name).
 *
 * Impl variant (takes a tx) so integration tests can drive the exact
 * matching SQL against a BEGIN/ROLLBACK transaction — same convention
 * as the connection-list queries above.
 */
export async function findContactByPhoneImpl(
  db: DbHandle,
  organizationId: string,
  tenDigits: string,
): Promise<ContactPhoneMatch | null> {
  const [row] = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, organizationId),
        isNull(contacts.deletedAt),
        or(
          sql`right(regexp_replace(coalesce(${contacts.primaryPhone}, ''), '[^0-9]', '', 'g'), 10) = ${tenDigits}`,
          sql`right(regexp_replace(coalesce(${contacts.secondaryPhone}, ''), '[^0-9]', '', 'g'), 10) = ${tenDigits}`,
        ),
      ),
    )
    .limit(1)

  if (!row) return null
  return { contactId: row.id, name: `${row.firstName} ${row.lastName}`.trim() }
}

/**
 * Raw POST to `/restapi/v1.0/client-info/sip-provision` with WSS
 * transport. Same fetch-with-typed-error-mapping pattern as
 * `performRefresh` in token-refresh.ts. No @ringcentral/sdk
 * dependency on the server side — one round-trip, one Bearer header,
 * a structured-clone-safe JSON response we can pass straight through
 * the server→client serialization boundary.
 *
 * NEVER logs the accessToken (input) or the sipInfo response body —
 * the latter contains SIP digest credentials that act as a password
 * for the duration of the session. Only RC's error code + HTTP
 * status hit pino, with `feature: "telephony.sip-provision"`.
 */
async function fetchSipProvisioning(accessToken: string): Promise<unknown> {
  const { RINGCENTRAL_SERVER_URL } = env
  if (!RINGCENTRAL_SERVER_URL) {
    throw new RingCentralOAuthNotConfigured()
  }
  const url = `${RINGCENTRAL_SERVER_URL.replace(/\/$/, "")}/restapi/v1.0/client-info/sip-provision`

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ sipInfo: [{ transport: "WSS" }] }),
      cache: "no-store",
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    log.warn(
      { feature: "telephony.sip-provision", err: detail },
      "[sip-provision] network error reaching RingCentral",
    )
    throw new RingCentralTransientError("network_error", detail)
  }

  if (res.ok) {
    const body = (await res.json()) as { sipInfo?: unknown[] }
    if (!Array.isArray(body.sipInfo) || body.sipInfo.length === 0) {
      log.warn(
        { feature: "telephony.sip-provision", status: res.status },
        "[sip-provision] response missing sipInfo array",
      )
      throw new RingCentralTransientError("malformed_response")
    }
    return body.sipInfo[0]
  }

  let providerCode = "unknown"
  let providerDetail = ""
  try {
    const errBody = (await res.json()) as {
      error?: string
      error_description?: string
      message?: string
    }
    if (typeof errBody.error === "string") providerCode = errBody.error
    if (typeof errBody.error_description === "string") providerDetail = errBody.error_description
    else if (typeof errBody.message === "string") providerDetail = errBody.message
  } catch {
    // Fall through with generic code.
  }

  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    log.warn(
      { feature: "telephony.sip-provision", providerCode, status: res.status },
      "[sip-provision] auth error from RingCentral",
    )
    throw new RingCentralAuthError(providerCode)
  }

  log.warn(
    { feature: "telephony.sip-provision", providerCode, status: res.status },
    "[sip-provision] transient error from RingCentral",
  )
  throw new RingCentralTransientError(providerCode, providerDetail)
}
