import "server-only"
import { env } from "@/lib/env"
import { getValidAccessToken } from "@/modules/telephony/token-refresh"
import type { RcCallLogRecord, RcCallLogListResponse, RcSubscriptionResponse } from "./types"

/**
 * Single seam for every RingCentral REST call in the rc-sync layer.
 *
 * Auth is DELEGATED to `getValidAccessToken` (the existing transactional,
 * locked OAuth refresh in token-refresh.ts) — this class does NOT reimplement
 * token handling. It owns only: base URL, a Bearer-authed `fetch`, JSON
 * parsing, typed errors, and 429 rate-limit-aware retry.
 *
 * Constructed with injected deps (token getter + fetch + sleep) so it
 * unit-tests without a DB or network; `ringCentralClientForUser()` is the
 * production factory that wires the real OAuth.
 *
 * RC rate limits: 10 Heavy / 40 Medium / 50 Light / 5 Auth per extension per
 * minute; a 429 carries a 60s penalty. We honor `Retry-After` and back off.
 */

export class RingCentralApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly rateLimited = false,
  ) {
    super(`RingCentral API error ${String(status)}${rateLimited ? " (rate-limited)" : ""}`)
    this.name = "RingCentralApiError"
  }
}

export interface RingCentralClientDeps {
  baseUrl: string
  getAccessToken: () => Promise<string>
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Injectable for tests so backoff doesn't actually wait. */
  sleep?: (ms: number) => Promise<void>
  /** Max retries on 429 before throwing. */
  maxRetries?: number
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ""
  }
}

export class RingCentralClient {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRetries: number

  constructor(private readonly deps: RingCentralClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.sleep =
      deps.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        }))
    this.maxRetries = deps.maxRetries ?? 2
  }

  /**
   * Authed JSON request with 429-aware retry. `path` may be an absolute URL
   * (e.g. a recording contentUri) or a `/restapi/...` path joined to baseUrl.
   */
  async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const token = await this.deps.getAccessToken()
    const url = path.startsWith("http") ? path : `${this.deps.baseUrl}${path}`
    // Build via Headers so any HeadersInit form (object / entries / Headers)
    // from the caller merges cleanly, then layer on auth.
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${token}`)
    headers.set("Accept", "application/json")
    const res = await this.fetchImpl(url, { ...init, headers })

    if (res.status === 429) {
      if (attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "0")
        // Honor Retry-After; otherwise exponential backoff (1s, 2s, …) + jitter.
        const backoffMs = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000
        const jitterMs = Math.floor(Math.random() * 250)
        await this.sleep(backoffMs + jitterMs)
        return this.request<T>(path, init, attempt + 1)
      }
      throw new RingCentralApiError(429, await safeText(res), true)
    }
    if (!res.ok) {
      throw new RingCentralApiError(res.status, await safeText(res), false)
    }
    return (await res.json()) as T
  }

  /** Fetch one authoritative call-log record by RC call id (the `rc_call_id`). */
  async getCall(rcCallId: string): Promise<RcCallLogRecord> {
    return this.request<RcCallLogRecord>(
      `/restapi/v1.0/account/~/call-log/${encodeURIComponent(rcCallId)}?view=Detailed`,
    )
  }

  /**
   * Resolve the authoritative call-log record for a telephony session id — the
   * Layer-2 precise lookup. Returns the first matching record, or null if RC
   * hasn't populated the call log yet (the worker then re-defers + retries).
   * ⚠️ VERIFY the `telephonySessionId` query param against RC docs at build;
   * if unsupported, fall back to a recent-window list + client-side filter.
   */
  async getCallBySessionId(telephonySessionId: string): Promise<RcCallLogRecord | null> {
    const res = await this.request<RcCallLogListResponse>(
      `/restapi/v1.0/account/~/call-log?view=Detailed&telephonySessionId=${encodeURIComponent(telephonySessionId)}`,
    )
    return res.records?.[0] ?? null
  }

  /** Create an account-level telephony/sessions webhook subscription. Used in
   *  Build 3 (not Build 1). Endpoint re-verified against RC docs at that build. */
  async subscribeWebhook(args: {
    eventFilters: string[]
    address: string
    expiresIn: number
    verificationToken: string
  }): Promise<RcSubscriptionResponse> {
    return this.request<RcSubscriptionResponse>("/restapi/v1.0/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventFilters: args.eventFilters,
        deliveryMode: {
          transportType: "WebHook",
          address: args.address,
          verificationToken: args.verificationToken,
        },
        expiresIn: args.expiresIn,
      }),
    })
  }

  /** Renew an existing subscription before it expires (~7 days). Build 3. */
  async renewWebhook(subscriptionId: string, expiresIn: number): Promise<RcSubscriptionResponse> {
    return this.request<RcSubscriptionResponse>(
      `/restapi/v1.0/subscription/${encodeURIComponent(subscriptionId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      },
    )
  }
}

function rcServerUrl(): string {
  const url = env.RINGCENTRAL_SERVER_URL
  if (!url) throw new Error("RINGCENTRAL_SERVER_URL is not configured")
  return url.replace(/\/$/, "")
}

/**
 * Production factory: a client authed as a specific (org, user) RingCentral
 * connection. Wraps `getValidAccessToken` — which opens its own transactional
 * org-context + handles rotation — so callers just `await client.getCall(...)`.
 */
export function ringCentralClientForUser(args: {
  organizationId: string
  userId: string
}): RingCentralClient {
  return new RingCentralClient({
    baseUrl: rcServerUrl(),
    getAccessToken: async () => (await getValidAccessToken(args)).token,
  })
}
