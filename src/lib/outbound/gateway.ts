import "server-only"
import {
  RateLimiter,
  fullJitterBackoffMs,
  type ProviderBudget,
  type Lane,
} from "@/lib/outbound/rate-limiter"
import {
  CircuitBreaker,
  type BreakerOptions,
  type BreakerState,
} from "@/lib/outbound/circuit-breaker"
import type { RateLimitStore } from "@/lib/outbound/store"
import type { ThrottleListener } from "@/lib/outbound/throttle-signal"

/**
 * The outbound gateway (step 3) — composes admission control (fairness + lanes),
 * the per-provider circuit breaker, and full-jitter backoff into ONE `execute`
 * call every outbound provider send goes through.
 *
 * Two lanes:
 *   - `interactive` (a human clicked "Send"): reserves the org floor, and if
 *     throttled does a SHORT bounded retry with full-jitter backoff (the person is
 *     right there) before surfacing a result.
 *   - `bulk` (a workflow batch / import): shared-burst only, and NEVER sleeps a
 *     serverless function. On throttle/breaker-open it returns a signal telling
 *     the caller to REQUEUE via the A3 durable queue (wired in the adapters, step 4).
 *
 * `execute` returns a discriminated result rather than throwing, so the caller can
 * branch: send it, requeue it (bulk), or surface an error (interactive). `sleep`
 * and `now` are injectable so tests are deterministic (no real timers/clock).
 */
export type GatewayResult<T> =
  | { status: "sent"; value: T }
  /** Admission refused (rate limit). Bulk → requeue; interactive → exhausted retries. */
  | { status: "throttled"; retryAfterMs: number }
  /** Provider breaker is open (provider looks down). Bulk → requeue after cooldown. */
  | { status: "circuit_open"; retryAfterMs: number }
  /** The provider call itself failed (and retries, if any, were exhausted). */
  | { status: "failed"; error: unknown }

export interface ProviderConfig {
  budget: ProviderBudget
  breaker: BreakerOptions
}

export interface GatewayOptions {
  store: RateLimitStore
  /** Per-provider budget + breaker config, keyed by provider name. */
  providers: Record<string, ProviderConfig>
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Interactive lane: admission/retry attempts before giving up. */
  interactiveMaxAttempts?: number
  /** Fired whenever a send is delayed (throttled / breaker-open) — the throttle
   *  visibility signal (step 6). Wired in config to log + feed the ThrottleLog. */
  onThrottle?: ThrottleListener
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export class OutboundGateway {
  private readonly providers: Record<string, ProviderConfig>
  private readonly rateLimiter: RateLimiter
  private readonly breakers = new Map<string, CircuitBreaker>()
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly interactiveMaxAttempts: number
  private readonly onThrottle?: ThrottleListener

  constructor(opts: GatewayOptions) {
    this.providers = opts.providers
    this.rateLimiter = new RateLimiter(opts.store)
    this.sleep = opts.sleep ?? defaultSleep
    this.now = opts.now ?? Date.now
    this.interactiveMaxAttempts = opts.interactiveMaxAttempts ?? 3
    this.onThrottle = opts.onThrottle
  }

  private breakerFor(provider: string, opts: BreakerOptions): CircuitBreaker {
    let breaker = this.breakers.get(provider)
    if (!breaker) {
      breaker = new CircuitBreaker(opts)
      this.breakers.set(provider, breaker)
    }
    return breaker
  }

  /** Current breaker state for a provider (for throttle visibility, step 6). */
  breakerState(provider: string): BreakerState | undefined {
    return this.breakers.get(provider)?.currentState()
  }

  async execute<T>(
    provider: string,
    orgId: string,
    lane: Lane,
    doCall: () => Promise<T>,
  ): Promise<GatewayResult<T>> {
    const result = await this.attempt(provider, orgId, lane, doCall)
    // Single emit point for throttle visibility (step 6): any delayed send —
    // rate-limited or breaker-open — signals the studio's "catching up" state.
    if (result.status === "throttled" || result.status === "circuit_open") {
      this.onThrottle?.({
        provider,
        orgId,
        status: result.status,
        retryAfterMs: result.retryAfterMs,
        at: this.now(),
      })
    }
    return result
  }

  private async attempt<T>(
    provider: string,
    orgId: string,
    lane: Lane,
    doCall: () => Promise<T>,
  ): Promise<GatewayResult<T>> {
    const cfg = this.providers[provider]
    if (!cfg) {
      return { status: "failed", error: new Error(`outbound: unknown provider "${provider}"`) }
    }
    const breaker = this.breakerFor(provider, cfg.breaker)
    const maxAttempts = lane === "interactive" ? this.interactiveMaxAttempts : 1

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const isLast = attempt === maxAttempts - 1

      // 1. Circuit breaker — is the provider considered down right now?
      if (!breaker.canProceed(this.now())) {
        if (lane === "bulk" || isLast) {
          return { status: "circuit_open", retryAfterMs: cfg.breaker.cooldownMs }
        }
        await this.sleep(fullJitterBackoffMs(attempt))
        continue
      }

      // 2. Admission control (fairness + lane priority).
      const admit = await this.rateLimiter.admit(provider, orgId, cfg.budget, lane, this.now())
      if (!admit.ok) {
        if (lane === "bulk" || isLast) {
          return { status: "throttled", retryAfterMs: admit.retryAfterMs }
        }
        await this.sleep(fullJitterBackoffMs(attempt))
        continue
      }

      // 3. Admitted — make the real provider call. A provider FAILURE fails fast
      // (no inline retry): a definitive send error won't fix itself on an
      // immediate re-send, and the caller (or, for bulk, the enclosing durable
      // job) owns retry. The inline retry loop is ONLY for admission throttle /
      // breaker-not-ready above, where a short wait genuinely helps.
      try {
        const value = await doCall()
        breaker.onSuccess()
        return { status: "sent", value }
      } catch (error) {
        breaker.onFailure(this.now())
        return { status: "failed", error }
      }
    }

    // Interactive attempts exhausted without a send (kept throttled throughout).
    return { status: "throttled", retryAfterMs: 0 }
  }
}
