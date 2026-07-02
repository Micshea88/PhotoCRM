import "server-only"
import { env } from "@/lib/env"
import { getEmailProvider } from "./providers"

/**
 * Nylas v3 hosted authentication (Commit 4).
 *
 * Flow (grant-based, WITH the application API key as client_secret):
 *   1. Redirect the photographer to `${NYLAS_API_URI}/v3/connect/auth` with our
 *      client_id + redirect_uri + response_type=code + provider. Scopes are set
 *      at the CONNECTOR level in the Nylas dashboard (Mike, answer #1), so no
 *      scope param is sent here — Nylas applies the connector's configured
 *      email read+send scopes. For "other" (IMAP), Nylas's HOSTED screen
 *      collects the mailbox credentials / app-password + any host/port — Pathway
 *      never sees or stores them.
 *   2. On callback, exchange the code at `/v3/connect/token` with
 *      client_secret = NYLAS_API_KEY (server-side only). The response carries a
 *      long-lived `grant_id` we store (encrypted).
 *
 * Reference: https://developer.nylas.com/docs/v3/auth/hosted-oauth-apikey/
 */

const REDIRECT_PATH = "/api/integrations/nylas/callback"

export class NylasNotConfigured extends Error {
  constructor() {
    super("Nylas is not configured for this environment.")
    this.name = "NylasNotConfigured"
  }
}

function requireConfig(): {
  apiUri: string
  apiKey: string
  clientId: string
  redirectUri: string
} {
  const { NYLAS_API_URI, NYLAS_API_KEY, NYLAS_CLIENT_ID } = env
  if (!NYLAS_API_URI || !NYLAS_API_KEY || !NYLAS_CLIENT_ID) {
    throw new NylasNotConfigured()
  }
  return {
    apiUri: NYLAS_API_URI.replace(/\/$/, ""),
    apiKey: NYLAS_API_KEY,
    clientId: NYLAS_CLIENT_ID,
    redirectUri: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${REDIRECT_PATH}`,
  }
}

/**
 * Build the Nylas hosted-auth URL the photographer is redirected to.
 *
 * The `provider` param comes from the catalog. For IMAP-based providers we add
 * `options=smtp_required` so Nylas's hosted screen forces the user to enter SMTP
 * (send) settings — otherwise the grant could receive but silently fail to SEND.
 * Confirmed in Nylas v3 docs (docs/v3/auth/imap).
 */
export function buildNylasAuthUrl(args: { state: string; providerId: string }): string {
  const def = getEmailProvider(args.providerId)
  if (!def) throw new NylasNotConfigured()
  const { apiUri, clientId, redirectUri } = requireConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    provider: def.nylasProvider,
    state: args.state,
  })
  if (def.kind === "imap") params.set("options", "smtp_required")
  return `${apiUri}/v3/connect/auth?${params.toString()}`
}

/** Successful token-exchange (grant creation) response. Nylas returns more
 *  fields (access_token, id_token, etc.) — we only use the grant identity. */
export interface NylasGrantResponse {
  grant_id: string
  email: string
  provider: string
  scope?: string
}

export class NylasTokenExchangeError extends Error {
  constructor(
    public readonly code: string,
    /** Provider detail — DO NOT surface to the client. */
    public readonly providerDetail: string,
  ) {
    super(`Nylas token exchange failed (${code})`)
    this.name = "NylasTokenExchangeError"
  }
}

/**
 * Exchange an authorization code for a Nylas grant. Server-side; the API key
 * (client_secret) never crosses the server boundary. On non-2xx, throws
 * NylasTokenExchangeError with a generic public code.
 */
export async function exchangeNylasCode(args: { code: string }): Promise<NylasGrantResponse> {
  const { apiUri, apiKey, clientId, redirectUri } = requireConfig()
  const res = await fetch(`${apiUri}/v3/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: apiKey,
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: redirectUri,
    }),
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
    throw new NylasTokenExchangeError(code, detail)
  }
  const json = (await res.json()) as NylasGrantResponse
  return json
}
