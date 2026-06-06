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
import {
  exchangeCode,
  RingCentralOAuthNotConfigured,
  RingCentralTokenExchangeError,
} from "@/modules/telephony/ringcentral-oauth"
import { upsertRingCentralConnection } from "@/modules/telephony/upsert"
import { verifyState } from "@/lib/oauth-pkce"

/**
 * RingCentral OAuth callback. Path-scoped cookies (set by the
 * begin-connect server action) are carried back here automatically:
 *
 *   - rc_oauth_state    : HMAC-signed (BETTER_AUTH_SECRET + userId)
 *   - rc_pkce_verifier  : 32-byte base64url string (the PKCE secret)
 *
 * Both are httpOnly + secure (prod) + path-scoped to
 * /api/telephony/ringcentral, so unrelated routes never see them and
 * the page JS can't read them.
 *
 * Security posture:
 *   - Session required.
 *   - State validated in constant time (signed HMAC), bound to userId.
 *   - State + verifier cookies cleared on EVERY exit (success or error).
 *   - Provider error_description NEVER surfaced to the client. Logged
 *     with pino; user sees a short error code only.
 *   - Tokens encrypted via src/lib/crypto.ts before they touch the DB.
 *   - Owner/admin re-check inside the handler (defense-in-depth — the
 *     wizard's render-gate is the primary check; this catches a role
 *     change that happens mid-flow).
 *
 * Caller redirect targets:
 *   - Success                : ?connected=1
 *   - User denied at RC      : ?error=denied
 *   - State/verifier missing : ?error=state
 *   - State HMAC mismatch    : ?error=state
 *   - Exchange failed        : ?error=exchange_failed
 *   - No active session/org  : ?error=session
 *   - Not owner/admin        : ?error=role
 *   - RC env not configured  : ?error=not_configured
 */

const WIZARD_PATH = "/settings/integrations/phone/ringcentral"
const COOKIE_PATH = "/api/telephony/ringcentral"
const STATE_COOKIE = "rc_oauth_state"
const VERIFIER_COOKIE = "rc_pkce_verifier"

function redirectWithStatus(request: NextRequest, query: Record<string, string>): NextResponse {
  const url = new URL(WIZARD_PATH, request.nextUrl.origin)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

async function clearCookies(): Promise<void> {
  const store = await cookies()
  store.delete({ name: STATE_COOKIE, path: COOKIE_PATH })
  store.delete({ name: VERIFIER_COOKIE, path: COOKIE_PATH })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    await clearCookies()
    return redirectWithStatus(request, { error: "session" })
  }
  const userId = session.user.id
  const orgId = session.session.activeOrganizationId
  if (!orgId) {
    await clearCookies()
    return redirectWithStatus(request, { error: "session" })
  }

  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const providerError = request.nextUrl.searchParams.get("error")
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(STATE_COOKIE)?.value ?? ""
  const verifierCookie = cookieStore.get(VERIFIER_COOKIE)?.value ?? ""

  if (providerError) {
    log.info(
      { feature: "telephony.ringcentral", providerError, userId, orgId },
      "[ringcentral-oauth] user denied or RC returned error pre-exchange",
    )
    await clearCookies()
    return redirectWithStatus(request, { error: "denied" })
  }

  if (!state || !stateCookie || !verifierCookie) {
    log.warn(
      {
        feature: "telephony.ringcentral",
        userId,
        orgId,
        missing: { state: !state, stateCookie: !stateCookie, verifierCookie: !verifierCookie },
      },
      "[ringcentral-oauth] callback missing state or verifier",
    )
    await clearCookies()
    return redirectWithStatus(request, { error: "state" })
  }

  if (state !== stateCookie || !verifyState(state, userId)) {
    log.warn(
      { feature: "telephony.ringcentral", userId, orgId },
      "[ringcentral-oauth] state mismatch — rejecting callback",
    )
    await clearCookies()
    return redirectWithStatus(request, { error: "state" })
  }

  if (!code) {
    await clearCookies()
    return redirectWithStatus(request, { error: "state" })
  }

  const member = await getCurrentMember(orgId, userId)
  if (!member) {
    await clearCookies()
    return redirectWithStatus(request, { error: "role" })
  }
  const baRole = member.role as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)
  const extendedRole =
    (await runWithOrgContext({ orgId, role: tentativeRole, userId }, async () =>
      getExtendedMemberRole(userId),
    )) ?? tentativeRole
  if (extendedRole !== "owner" && extendedRole !== "admin") {
    await clearCookies()
    return redirectWithStatus(request, { error: "role" })
  }

  let tokens
  try {
    tokens = await exchangeCode({ code, codeVerifier: verifierCookie })
  } catch (e) {
    if (e instanceof RingCentralOAuthNotConfigured) {
      log.error(
        { feature: "telephony.ringcentral", userId, orgId },
        "[ringcentral-oauth] RC env not configured",
      )
      await clearCookies()
      return redirectWithStatus(request, { error: "not_configured" })
    }
    if (e instanceof RingCentralTokenExchangeError) {
      log.error(
        {
          feature: "telephony.ringcentral",
          userId,
          orgId,
          providerCode: e.code,
          providerDetail: e.providerDetail,
        },
        "[ringcentral-oauth] token exchange failed",
      )
      await clearCookies()
      return redirectWithStatus(request, { error: "exchange_failed" })
    }
    log.error(
      {
        feature: "telephony.ringcentral",
        userId,
        orgId,
        err: e instanceof Error ? e.message : String(e),
      },
      "[ringcentral-oauth] unexpected error during token exchange",
    )
    await clearCookies()
    return redirectWithStatus(request, { error: "exchange_failed" })
  }

  let result: { id: string; reactivated: boolean }
  try {
    result = await runWithOrgContext({ orgId, role: extendedRole, userId }, async () => {
      return withOrgContext(async (tx) => {
        const r = await upsertRingCentralConnection(tx, {
          organizationId: orgId,
          userId,
          tokens,
        })
        await audit(
          {
            db: tx,
            organizationId: orgId,
            actorUserId: userId,
            ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: request.headers.get("user-agent") ?? null,
          },
          r.reactivated ? "telephony.reconnected" : "telephony.connected",
          {
            resourceType: "telephony_connection",
            resourceId: r.id,
            metadata: { provider: "ringcentral" },
          },
        )
        return r
      })
    })
  } catch (e) {
    log.error(
      {
        feature: "telephony.ringcentral",
        userId,
        orgId,
        err: e instanceof Error ? e.message : String(e),
      },
      "[ringcentral-oauth] failed to persist connection",
    )
    await clearCookies()
    return redirectWithStatus(request, { error: "exchange_failed" })
  }

  log.info(
    { feature: "telephony.ringcentral", userId, orgId, reactivated: result.reactivated },
    "[ringcentral-oauth] connection persisted",
  )
  await clearCookies()
  return redirectWithStatus(request, { connected: "1" })
}
