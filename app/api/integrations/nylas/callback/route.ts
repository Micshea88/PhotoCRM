import "server-only"
import { cookies, headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { log } from "@/lib/log"
import { runWithOrgContext, withOrgContext } from "@/lib/org-context"
import { audit } from "@/modules/audit/audit"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { verifyState } from "@/lib/oauth-pkce"
import {
  exchangeNylasCode,
  NylasNotConfigured,
  NylasTokenExchangeError,
} from "@/modules/email-connections/nylas-oauth"
import { upsertNylasConnection } from "@/modules/email-connections/upsert"
import { getEmailProvider } from "@/modules/email-connections/providers"

/**
 * Nylas hosted-auth callback (Commit 4). PER-PHOTOGRAPHER — any member connects
 * their OWN mailbox, so there is no owner/admin gate. The state cookie is
 * path-scoped to /api/integrations/nylas and userId-bound (HMAC).
 *
 * Redirect targets (to the existing integrations Email page):
 *   - Success            : ?connected=1
 *   - User denied / error: ?error=denied
 *   - State missing/bad  : ?error=state
 *   - Exchange failed    : ?error=exchange_failed
 *   - No session/org     : ?error=session
 *   - Nylas not configured: ?error=not_configured
 */

const RETURN_PATH = "/settings/integrations/email"
const COOKIE_PATH = "/api/integrations/nylas"
const STATE_COOKIE = "nylas_oauth_state"
const PROVIDER_COOKIE = "nylas_oauth_provider"

function redirectWithStatus(request: NextRequest, query: Record<string, string>): NextResponse {
  const url = new URL(RETURN_PATH, request.nextUrl.origin)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

async function clearCookie(): Promise<void> {
  const store = await cookies()
  store.delete({ name: STATE_COOKIE, path: COOKIE_PATH })
  store.delete({ name: PROVIDER_COOKIE, path: COOKIE_PATH })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    await clearCookie()
    return redirectWithStatus(request, { error: "session" })
  }
  const userId = session.user.id
  const orgId = session.session.activeOrganizationId
  if (!orgId) {
    await clearCookie()
    return redirectWithStatus(request, { error: "session" })
  }

  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const providerError = request.nextUrl.searchParams.get("error")
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(STATE_COOKIE)?.value ?? ""
  // Source label from the SELECTED provider (icloud/yahoo/aol/…), not a blanket
  // "imap". Falls back to the grant's provider mapping if the cookie is missing.
  const selectedProviderId = cookieStore.get(PROVIDER_COOKIE)?.value ?? ""

  if (providerError) {
    log.info({ feature: "email.nylas", providerError, userId, orgId }, "[nylas-oauth] denied/error")
    await clearCookie()
    return redirectWithStatus(request, { error: "denied" })
  }
  if (!state || !stateCookie || state !== stateCookie || !verifyState(state, userId)) {
    log.warn({ feature: "email.nylas", userId, orgId }, "[nylas-oauth] state mismatch")
    await clearCookie()
    return redirectWithStatus(request, { error: "state" })
  }
  if (!code) {
    await clearCookie()
    return redirectWithStatus(request, { error: "state" })
  }

  const member = await getCurrentMember(orgId, userId)
  if (!member) {
    await clearCookie()
    return redirectWithStatus(request, { error: "session" })
  }
  const tentativeRole = extendedFromBetterAuth(member.role as BetterAuthRole)
  const extendedRole =
    (await runWithOrgContext({ orgId, role: tentativeRole, userId }, async () =>
      getExtendedMemberRole(userId),
    )) ?? tentativeRole

  let grant
  try {
    grant = await exchangeNylasCode({ code })
  } catch (e) {
    if (e instanceof NylasNotConfigured) {
      await clearCookie()
      return redirectWithStatus(request, { error: "not_configured" })
    }
    if (e instanceof NylasTokenExchangeError) {
      log.error(
        {
          feature: "email.nylas",
          userId,
          orgId,
          providerCode: e.code,
          providerDetail: e.providerDetail,
        },
        "[nylas-oauth] token exchange failed",
      )
      await clearCookie()
      return redirectWithStatus(request, { error: "exchange_failed" })
    }
    log.error(
      { feature: "email.nylas", userId, orgId, err: e instanceof Error ? e.message : String(e) },
      "[nylas-oauth] unexpected error during exchange",
    )
    await clearCookie()
    return redirectWithStatus(request, { error: "exchange_failed" })
  }

  try {
    await runWithOrgContext({ orgId, role: extendedRole, userId }, async () => {
      return withOrgContext(async (tx) => {
        const selected = getEmailProvider(selectedProviderId)
        const sourceValue =
          selected?.sourceValue ??
          (grant.provider === "google"
            ? "gmail"
            : grant.provider === "microsoft"
              ? "outlook"
              : "imap")
        const r = await upsertNylasConnection(tx, {
          organizationId: orgId,
          userId,
          grant,
          sourceValue,
        })
        await audit(
          {
            db: tx,
            organizationId: orgId,
            actorUserId: userId,
            ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: request.headers.get("user-agent") ?? null,
          },
          r.reactivated ? "email_connections.reconnected" : "email_connections.connected",
          {
            resourceType: "email_connection",
            resourceId: r.id,
            metadata: { provider: grant.provider },
          },
        )
        return r
      })
    })
  } catch (e) {
    log.error(
      { feature: "email.nylas", userId, orgId, err: e instanceof Error ? e.message : String(e) },
      "[nylas-oauth] failed to persist connection",
    )
    await clearCookie()
    return redirectWithStatus(request, { error: "exchange_failed" })
  }

  await clearCookie()
  return redirectWithStatus(request, { connected: "1" })
}
