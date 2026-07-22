import "server-only"

/**
 * Per-provider circuit breaker for the outbound gateway (step 2). Stops us from
 * hammering a provider that's already failing (which just piles up timeouts and
 * makes things worse):
 *
 *   - CLOSED: normal — calls flow; consecutive failures are counted.
 *   - OPEN: after `failureThreshold` consecutive failures, fail FAST for
 *     `cooldownMs` (don't even attempt the call).
 *   - HALF-OPEN: after the cooldown, let ONE probe through. Success → CLOSED
 *     (recovered); failure → OPEN again (still down).
 *
 * `now` is injectable so tests are deterministic. One instance per provider
 * (the gateway owns them). State is in-process — correct for a single region;
 * the shared-store version arrives with Upstash (step 5).
 */
export type BreakerState = "closed" | "open" | "half-open"

export interface BreakerOptions {
  /** Consecutive failures that trip CLOSED → OPEN. */
  failureThreshold: number
  /** How long to stay OPEN before allowing a HALF-OPEN probe. */
  cooldownMs: number
}

export class CircuitBreaker {
  private failures = 0
  private openedAt = 0
  private state: BreakerState = "closed"

  constructor(private readonly opts: BreakerOptions) {}

  /** May a call proceed now? Transitions OPEN → HALF-OPEN once the cooldown has
   *  elapsed (letting a single probe through). */
  canProceed(now: number = Date.now()): boolean {
    if (this.state === "open") {
      if (now - this.openedAt >= this.opts.cooldownMs) {
        this.state = "half-open"
        return true
      }
      return false
    }
    return true // closed or half-open
  }

  /** Record a successful call — clears failures and closes the breaker. */
  onSuccess(): void {
    this.failures = 0
    this.state = "closed"
  }

  /** Record a failed call — opens the breaker on a half-open probe or once the
   *  consecutive-failure threshold is reached. */
  onFailure(now: number = Date.now()): void {
    this.failures += 1
    if (this.state === "half-open" || this.failures >= this.opts.failureThreshold) {
      this.state = "open"
      this.openedAt = now
      this.failures = 0
    }
  }

  currentState(): BreakerState {
    return this.state
  }
}
