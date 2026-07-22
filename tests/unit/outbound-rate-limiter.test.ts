/**
 * Outbound gateway — step 1 core engine. Asserts the observable behavior:
 * the token bucket admits/refuses/refills, and the floor+burst model is FAIR
 * (one org exhausting its floor + the shared burst does NOT starve another org's
 * guaranteed floor). `now` is injected so there's no wall-clock flakiness.
 */
import { describe, it, expect } from "vitest"
import { InMemoryStore } from "@/lib/outbound/store"
import { RateLimiter, fullJitterBackoffMs, type ProviderBudget } from "@/lib/outbound/rate-limiter"

describe("InMemoryStore token bucket", () => {
  it("admits up to capacity, then refuses with a retryAfter", async () => {
    const s = new InMemoryStore()
    const t0 = 1_000_000
    expect((await s.take("k", 1, 2, 1, t0)).ok).toBe(true) // 2 -> 1
    expect((await s.take("k", 1, 2, 1, t0)).ok).toBe(true) // 1 -> 0
    const refused = await s.take("k", 1, 2, 1, t0) // empty
    expect(refused.ok).toBe(false)
    expect(refused.retryAfterMs).toBe(1000) // 1 token / 1 per-sec
  })

  it("refills over elapsed time", async () => {
    const s = new InMemoryStore()
    const t0 = 1_000_000
    await s.take("k", 1, 2, 1, t0)
    await s.take("k", 1, 2, 1, t0) // now empty
    expect((await s.take("k", 1, 2, 1, t0 + 1000)).ok).toBe(true) // +1s → 1 token back
  })
})

describe("RateLimiter floor + shared burst", () => {
  const budget: ProviderBudget = {
    floorCapacity: 1,
    floorPerSec: 1,
    burstCapacity: 1,
    burstPerSec: 1,
  }

  it("uses the org floor, then the shared burst, then refuses", async () => {
    const rl = new RateLimiter(new InMemoryStore())
    const t = 1_000_000
    expect((await rl.admit("resend", "orgA", budget, t)).ok).toBe(true) // floor
    expect((await rl.admit("resend", "orgA", budget, t)).ok).toBe(true) // burst
    expect((await rl.admit("resend", "orgA", budget, t)).ok).toBe(false) // both empty
  })

  it("FAIRNESS: one org draining floor+burst does not starve another org's floor", async () => {
    const rl = new RateLimiter(new InMemoryStore())
    const t = 1_000_000
    await rl.admit("resend", "orgA", budget, t) // orgA floor
    await rl.admit("resend", "orgA", budget, t) // shared burst (now gone)
    await rl.admit("resend", "orgA", budget, t) // refused
    // orgB still has its OWN guaranteed floor untouched.
    expect((await rl.admit("resend", "orgB", budget, t)).ok).toBe(true)
  })
})

describe("fullJitterBackoffMs", () => {
  it("stays within [0, min(cap, base*2^attempt))", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ceiling = Math.min(30_000, 250 * 2 ** attempt)
      for (let i = 0; i < 50; i++) {
        const d = fullJitterBackoffMs(attempt)
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThan(ceiling)
      }
    }
  })

  it("caps the ceiling for large attempts", () => {
    for (let i = 0; i < 50; i++) expect(fullJitterBackoffMs(40)).toBeLessThan(30_000)
  })
})
