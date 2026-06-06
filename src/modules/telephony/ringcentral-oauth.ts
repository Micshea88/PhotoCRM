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

/** Scopes we request from RingCentral. Mirrors Step 1's scope spec. */
const SCOPES = "ReadCallLog ReadMessages SMS VoipCalling"

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
