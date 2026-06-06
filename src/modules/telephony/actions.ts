"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { env } from "@/lib/env"
import { generateVerifier, signState, verifierToChallenge } from "@/lib/oauth-pkce"
import { ActionError, orgAction } from "@/lib/safe-action"
import { disconnectTelephonyImpl } from "@/modules/telephony/disconnect"
import {
  buildAuthorizeUrl,
  RingCentralOAuthNotConfigured,
} from "@/modules/telephony/ringcentral-oauth"

/**
 * Telephony server actions — connect initiation + disconnect.
 *
 * Owner/admin only. The wizard's render-gate is the primary check;
 * each action also re-checks `ctx.activeOrg.role` (defense-in-depth
 * — matches the inviteMember pattern in rbac/actions.ts).
 *
 * Cookie scope for the PKCE handshake:
 *   - httpOnly + sameSite=lax (must be lax to survive the cross-site
 *     redirect back from RingCentral)
 *   - secure when not explicitly running in development (test +
 *     production both get secure=true; default-deny)
 *   - path-scoped to /api/telephony/ringcentral so the cookies are
 *     sent ONLY to the callback route and not exposed to any other
 *     surface in the app
 *   - 10-minute TTL — the OAuth handshake is sub-second under normal
 *     conditions; 10 minutes is comfortably above flaky-network worst
 *     case while keeping the verifier short-lived.
 */

const COOKIE_PATH = "/api/telephony/ringcentral"
const STATE_COOKIE = "rc_oauth_state"
const VERIFIER_COOKIE = "rc_pkce_verifier"
const COOKIE_MAX_AGE_SECONDS = 600

const beginRingCentralConnectInput = z.object({})

/**
 * Initiate the RingCentral OAuth flow:
 *   1. Owner/admin check.
 *   2. Generate PKCE verifier + S256 challenge.
 *   3. HMAC-sign the state (BETTER_AUTH_SECRET + userId-bound).
 *   4. Set the two path-scoped, httpOnly, sameSite=lax cookies.
 *   5. Return the authorize URL — client navigates the browser to it.
 *
 * The client secret never appears here (it's used only on the
 * callback's server-side token exchange).
 *
 * No DB write — that's why the upstream tx is unused. The orgAction
 * wrapper is still the right tool because it gives us
 * ctx.activeOrg.role pre-resolved without re-implementing the
 * member lookup.
 */
export const beginRingCentralConnect = orgAction
  .metadata({ actionName: "telephony.begin_ringcentral_connect" })
  .inputSchema(beginRingCentralConnectInput)
  .action(async ({ ctx }) => {
    if (ctx.activeOrg.role !== "owner" && ctx.activeOrg.role !== "admin") {
      throw new ActionError(
        "FORBIDDEN",
        "Only owners and admins can connect integrations for this workspace.",
      )
    }

    const verifier = generateVerifier()
    const codeChallenge = verifierToChallenge(verifier)
    const state = signState(ctx.session.user.id)

    let authorizeUrl: string
    try {
      authorizeUrl = buildAuthorizeUrl({ state, codeChallenge })
    } catch (e) {
      if (e instanceof RingCentralOAuthNotConfigured) {
        throw new ActionError("VALIDATION", "RingCentral is not configured for this workspace.")
      }
      throw e
    }

    const cookieStore = await cookies()
    // Default-deny on the secure flag: anything that isn't explicitly
    // "development" gets secure=true. A typo in NODE_ENV, a missing
    // value, or a future env tier ("staging", "preview", etc.) all
    // default to secure-on rather than silently dropping the flag.
    // Local dev is the only HTTP context — and env.ts pins NODE_ENV's
    // enum to development | test | production, so test + production
    // both land on secure=true.
    const secure = env.NODE_ENV !== "development"
    cookieStore.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE_SECONDS,
    })
    cookieStore.set(VERIFIER_COOKIE, verifier, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE_SECONDS,
    })

    return { authorizeUrl }
  })

const disconnectTelephonyInput = z.object({
  provider: z.string().min(1),
})

/**
 * Soft-delete the current user's live (org, user, provider) row.
 *
 * Owner/admin only. Never hard-deletes — the soft-deleted row is
 * preserved for audit/forensics and the partial-unique index lets
 * a future re-connect reactivate it via `upsertRingCentralConnection`.
 */
export const disconnectTelephony = orgAction
  .metadata({ actionName: "telephony.disconnect" })
  .inputSchema(disconnectTelephonyInput)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.activeOrg.role !== "owner" && ctx.activeOrg.role !== "admin") {
      throw new ActionError(
        "FORBIDDEN",
        "Only owners and admins can disconnect integrations for this workspace.",
      )
    }
    // SQL + audit body lives in src/modules/telephony/disconnect.ts so
    // integration tests can drive the exact same path without
    // hand-copying it. This action stays the thin wrapper that adds
    // the auth/role/RLS context + revalidatePath.
    await disconnectTelephonyImpl(ctx.db, {
      organizationId: ctx.activeOrg.id,
      userId: ctx.session.user.id,
      provider: parsedInput.provider,
      actorUserId: ctx.session.user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    revalidatePath("/settings/integrations")
    revalidatePath(`/settings/integrations/phone/${parsedInput.provider}`)
    return { ok: true }
  })
