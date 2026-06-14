import "server-only"
import { env } from "@/lib/env"

/**
 * RingCentral OAuth 2.0 — Authorization Code + PKCE (S256) flow,
 * server-side, WITH client secret.
 *
 * The client secret never crosses the server boundary. It's baked
 * into the Basic auth header on the token exchange POST and never
 * appears anywhere else (not in cookies, not in logs, not in the
 * authorize URL).
 *
 * Reference: https://developers.ringcentral.com/api-reference/Authorization
 */

const REDIRECT_PATH = "/api/telephony/ringcentral/callback"

/**
 * Scopes we request from RingCentral.
 *
 *   - ReadCallLog   : read call history (3a — call history surfaced
 *     on the contact detail page).
 *   - ReadMessages  : read SMS history (3a — SMS history surfacing).
 *   - SMS           : send SMS (3a — outbound SMS from the contact
 *     activity feed; 3b will surface this in the UI).
 *   - VoipCalling   : SIP-provision (`/restapi/v1.0/client-info/sip-
 *     provision`) + WebPhone SDK calling (3a — the docked dialer).
 *   - ReadAccounts  : read extension/account metadata under
 *     `/restapi/v1.0/account/~/extension/~/*` — required for the
 *     `/extension/~/phone-number` endpoint that DirectNumber
 *     discovery (Transfer-to-phone) hits. Added 2026-06-09 after Mike
 *     enabled the permission on the app's RC Developer Console
 *     config.
 *
 * **Operational gate — RC's double-permission model.** RC validates
 * the `scope=` param against TWO independent layers: (a) the app's
 * Console config (developer-side enablement) and (b) the user's
 * OAuth consent grant. Both must include a permission for it to be
 * requestable. Adding a scope to this string WITHOUT first enabling
 * it on the app's Console config caused RC to return
 * `error=invalid_request "Parameter [scope] value is invalid"` and
 * broke ALL reconnects (incident 2026-06-08, reverted in cad853b,
 * re-landed here once Console enablement was confirmed). Before
 * adding any new scope, follow the audit checklist in
 * memory:ringcentral-oauth-scopes — Console enablement is the gate
 * that bit us.
 *
 * Authorize URL also passes `prompt=login consent` (the RC-specific
 * required value for external apps; `prompt=consent` alone is
 * rejected). Forces RC to re-display the login + consent screen
 * every authorize call — critical when SCOPES changes, otherwise RC
 * silently re-grants the user's PRIOR scope set (missing newly-added
 * ones) and the new feature stays broken until manual revoke. See
 * memory:ringcentral-oauth-scopes for the full prompt + double-
 * permission discussion.
 */
// RC-sync (Build 1) adds two scopes:
//   - ReadCallRecording: download recording content for the transcript pipeline.
//   - CallControl: REQUIRED to subscribe to account-level telephony/sessions
//     webhooks (RC errors "Required application permission [CallControl] is
//     missing" otherwise). Used in Build 3.
// Both must be enabled on the app in the RC Developer Console BEFORE they can
// be requested, and the user must RECONNECT (prompt=consent) — RC silently
// re-grants the prior scope set otherwise. See memory:ringcentral-oauth-scopes.
// (RingSense / `ai` speech-to-text scope is deliberately NOT added here — it's
// a by-request beta scope, added in Build 4.)
const SCOPES = "ReadCallLog ReadMessages SMS VoipCalling ReadAccounts ReadCallRecording CallControl"

export class RingCentralOAuthNotConfigured extends Error {
  constructor() {
    super("RingCentral OAuth is not configured for this environment.")
    this.name = "RingCentralOAuthNotConfigured"
  }
}

function requireConfig(): {
  clientId: string
  clientSecret: string
  serverUrl: string
  redirectUri: string
} {
  const { RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_SERVER_URL } = env
  if (!RINGCENTRAL_CLIENT_ID || !RINGCENTRAL_CLIENT_SECRET || !RINGCENTRAL_SERVER_URL) {
    throw new RingCentralOAuthNotConfigured()
  }
  return {
    clientId: RINGCENTRAL_CLIENT_ID,
    clientSecret: RINGCENTRAL_CLIENT_SECRET,
    serverUrl: RINGCENTRAL_SERVER_URL.replace(/\/$/, ""),
    redirectUri: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${REDIRECT_PATH}`,
  }
}

/** Build the authorize URL the user is redirected to. */
export function buildAuthorizeUrl(args: { state: string; codeChallenge: string }): string {
  const { clientId, serverUrl, redirectUri } = requireConfig()
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    scope: SCOPES,
    // Force RC to re-display BOTH the login page AND the consent
    // screen on every authorize call. Critical when SCOPES changes:
    // without prompt, RC may silently re-grant the user's PRIOR scope
    // set (missing newly-added ones) — the new feature would stay
    // broken for existing users until they manually revoke at RC's
    // side.
    //
    // IMPORTANT: RC's authorize endpoint requires the RC-specific
    // value `"login consent"` for external apps. The OIDC-standard
    // `prompt=consent` alone returns "Parameter [prompt] value is
    // invalid" and RC redirects back to the callback with an
    // error=invalid_request param (bug introduced 2026-06-08, fixed
    // same day). RC's permission docs and OIDC docs are NOT
    // interchangeable for this parameter; always check RC's
    // authorize-endpoint docs specifically. See
    // memory:ringcentral-oauth-scopes.
    //
    // URLSearchParams URL-encodes the space; RC accepts both `+` and
    // `%20`. Net friction for first-time users: zero (RC always
    // shows login+consent on first connect anyway).
    prompt: "login consent",
  })
  return `${serverUrl}/restapi/oauth/authorize?${params.toString()}`
}

/**
 * Successful token-exchange response shape. RC also returns
 * `token_type` and `endpoint_id` — we don't use them so they aren't
 * typed here.
 */
export interface RingCentralTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  refresh_token_expires_in: number
  scope: string
  /** RC extension id — used as `externalUserId`. */
  owner_id: string
}

export class RingCentralTokenExchangeError extends Error {
  constructor(
    public readonly code: string,
    /** Provider's `error_description` — DO NOT surface to the client. */
    public readonly providerDetail: string,
  ) {
    super(`RingCentral token exchange failed (${code})`)
    this.name = "RingCentralTokenExchangeError"
  }
}

/**
 * Exchange an authorization code for tokens. Server-side fetch with
 * Basic auth. Never accepts plaintext secrets from the caller — the
 * client_id/client_secret are read from env inside this function.
 *
 * On non-2xx, throws RingCentralTokenExchangeError. The provider's
 * `error_description` is captured for logs but the public message is
 * generic — the callback handler turns this into a redirect with a
 * short error code only.
 */
export async function exchangeCode(args: {
  code: string
  codeVerifier: string
}): Promise<RingCentralTokenResponse> {
  const { clientId, clientSecret, serverUrl, redirectUri } = requireConfig()
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: redirectUri,
    code_verifier: args.codeVerifier,
  })
  const res = await fetch(`${serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    cache: "no-store",
  })
  if (!res.ok) {
    let code = "exchange_failed"
    let detail = ""
    try {
      const errBody = (await res.json()) as { error?: string; error_description?: string }
      if (typeof errBody.error === "string") code = errBody.error
      if (typeof errBody.error_description === "string") detail = errBody.error_description
    } catch {
      // fall through with generic code
    }
    throw new RingCentralTokenExchangeError(code, detail)
  }
  const json = (await res.json()) as RingCentralTokenResponse
  return json
}
