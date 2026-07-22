import "server-only"

/**
 * The pluggable rate-limit store — the ONLY thing that changes between
 * single-region (in-memory) and multi-region (Upstash Redis, later — TODO H9).
 * A token bucket: `take` refills based on elapsed time, then tries to spend
 * `cost` tokens.
 */
export interface TakeResult {
  /** Whether the tokens were granted. */
  ok: boolean
  /** If not ok, roughly how long until enough tokens refill. */
  retryAfterMs: number
}

export interface RateLimitStore {
  /**
   * Refill `key`'s bucket to `capacity` at `refillPerSec`, then spend `cost`.
   * `now` is injectable so tests are deterministic (no wall-clock flakiness).
   */
  take(
    key: string,
    cost: number,
    capacity: number,
    refillPerSec: number,
    now?: number,
  ): Promise<TakeResult>
}

/**
 * In-process token bucket. Correct for a SINGLE Vercel region (where we are
 * today). Multi-region needs the shared Upstash implementation so limits hold
 * across instances — same interface, swapped by env at gateway construction.
 */
export class InMemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { tokens: number; last: number }>()

  take(
    key: string,
    cost: number,
    capacity: number,
    refillPerSec: number,
    now: number = Date.now(),
  ): Promise<TakeResult> {
    const prior = this.buckets.get(key) ?? { tokens: capacity, last: now }
    const refilled = Math.min(capacity, prior.tokens + ((now - prior.last) / 1000) * refillPerSec)
    if (refilled >= cost) {
      this.buckets.set(key, { tokens: refilled - cost, last: now })
      return Promise.resolve({ ok: true, retryAfterMs: 0 })
    }
    this.buckets.set(key, { tokens: refilled, last: now })
    const deficit = cost - refilled
    return Promise.resolve({
      ok: false,
      retryAfterMs: Math.ceil((deficit / refillPerSec) * 1000),
    })
  }
}
