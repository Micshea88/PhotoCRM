import "server-only"
import type { RateLimitStore, TakeResult } from "@/lib/outbound/store"

/**
 * Per-provider budget for the floor+burst fairness model. Each org is guaranteed
 * `floor` (so one noisy studio can't starve another); anything above the floor
 * draws from a shared burst pool (first-come). NOT equal per-org slices.
 */
export interface ProviderBudget {
  /** Per-org guaranteed floor: bucket size + refill rate (tokens/sec). */
  floorCapacity: number
  floorPerSec: number
  /** Shared burst pool: bucket size + refill rate (tokens/sec). */
  burstCapacity: number
  burstPerSec: number
}

/**
 * Which lane a send belongs to (step 3). `interactive` = a human is waiting
 * (composer "Send"); `bulk` = a workflow batch or import. Interactive reserves the
 * per-org floor; bulk draws only from the shared burst, so a batch can never eat
 * the capacity a human send is guaranteed.
 */
export type Lane = "interactive" | "bulk"

/**
 * Admission control for the outbound gateway (step 1 of the gateway build). Tries
 * the org's guaranteed floor first, then the shared burst pool. Lanes
 * (interactive vs bulk), circuit breaker, and requeue-on-throttle are layered on
 * in later steps — this is the fairness core.
 */
export class RateLimiter {
  constructor(private readonly store: RateLimitStore) {}

  async admit(
    provider: string,
    orgId: string,
    budget: ProviderBudget,
    lane: Lane = "interactive",
    now?: number,
  ): Promise<TakeResult> {
    // Interactive gets first crack at the org's guaranteed floor. Bulk skips it —
    // the floor is reserved for human-waiting sends — and competes only for the
    // shared burst pool.
    if (lane === "interactive") {
      const floor = await this.store.take(
        `${provider}:${orgId}`,
        1,
        budget.floorCapacity,
        budget.floorPerSec,
        now,
      )
      if (floor.ok) return floor

      const burst = await this.store.take(
        `${provider}:_burst`,
        1,
        budget.burstCapacity,
        budget.burstPerSec,
        now,
      )
      if (burst.ok) return burst

      // Neither had room — report the sooner of the two refills.
      return { ok: false, retryAfterMs: Math.min(floor.retryAfterMs, burst.retryAfterMs) }
    }

    // Bulk: shared burst only.
    return this.store.take(`${provider}:_burst`, 1, budget.burstCapacity, budget.burstPerSec, now)
  }
}

/**
 * Full-jitter backoff (AWS "Exponential Backoff and Jitter"): a uniform random
 * delay in `[0, min(cap, base·2^attempt))`. Full jitter (not "equal" or
 * "decorrelated") spreads retries out best, avoiding synchronized thundering
 * herds when many callers back off together. `attempt` is 0-indexed.
 */
export function fullJitterBackoffMs(attempt: number, baseMs = 250, capMs = 30_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt)
  return Math.floor(Math.random() * ceiling)
}
