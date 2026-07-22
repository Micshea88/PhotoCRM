/**
 * Outbound gateway — step 3, two-lane scheduler + requeue-not-sleep. Asserts the
 * OBSERVABLE behavior of `execute`: it sends when there's room, requeues bulk
 * (never sleeps) when throttled or the breaker is open, retries interactive across
 * a transient failure, and surfaces circuit_open once a provider trips. `sleep` is
 * a no-op and `now` is a fixed constant so there are no real timers or clock flakiness.
 */
import { describe, it, expect } from "vitest"
import { InMemoryStore } from "@/lib/outbound/store"
import { OutboundGateway, type GatewayOptions } from "@/lib/outbound/gateway"

const NOW = 1_000_000
const noopSleep = (): Promise<void> => Promise.resolve()

function makeGateway(overrides: Partial<GatewayOptions> = {}): OutboundGateway {
  return new OutboundGateway({
    store: new InMemoryStore(),
    providers: {
      resend: {
        budget: { floorCapacity: 2, floorPerSec: 1, burstCapacity: 1, burstPerSec: 1 },
        breaker: { failureThreshold: 2, cooldownMs: 1000 },
      },
    },
    sleep: noopSleep,
    now: () => NOW,
    ...overrides,
  })
}

describe("OutboundGateway.execute", () => {
  it("sends when there is capacity", async () => {
    const gw = makeGateway()
    const r = await gw.execute("resend", "orgA", "interactive", () => Promise.resolve("id-1"))
    expect(r).toEqual({ status: "sent", value: "id-1" })
  })

  it("fails fast on an unknown provider", async () => {
    const gw = makeGateway()
    const r = await gw.execute("nope", "orgA", "bulk", () => Promise.resolve("x"))
    expect(r.status).toBe("failed")
  })

  it("bulk that is throttled returns a REQUEUE signal (never sends, never sleeps)", async () => {
    // Burst capacity is 1; drain it, then the next bulk send must be throttled.
    const gw = makeGateway()
    let calls = 0
    const send = () => {
      calls += 1
      return Promise.resolve("ok")
    }
    const first = await gw.execute("resend", "orgA", "bulk", send)
    expect(first.status).toBe("sent") // used the shared burst
    const second = await gw.execute("resend", "orgA", "bulk", send)
    expect(second.status).toBe("throttled")
    if (second.status === "throttled") expect(second.retryAfterMs).toBeGreaterThan(0)
    expect(calls).toBe(1) // the throttled bulk send never called the provider
  })

  it("interactive retries across a transient failure and then succeeds", async () => {
    const gw = makeGateway()
    let calls = 0
    const flaky = () => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error("transient"))
      return Promise.resolve("id-2")
    }
    const r = await gw.execute("resend", "orgA", "interactive", flaky)
    expect(r).toEqual({ status: "sent", value: "id-2" })
    expect(calls).toBe(2)
  })

  it("opens the breaker after repeated failures and then reports circuit_open", async () => {
    // Generous budget so admission never blocks — the failures must reach the
    // provider to count toward the breaker threshold of 2. One attempt per call (bulk).
    const gw = makeGateway({
      providers: {
        resend: {
          budget: { floorCapacity: 100, floorPerSec: 100, burstCapacity: 100, burstPerSec: 100 },
          breaker: { failureThreshold: 2, cooldownMs: 1000 },
        },
      },
    })
    const boom = () => Promise.reject(new Error("provider down"))
    const a = await gw.execute("resend", "orgA", "bulk", boom)
    expect(a.status).toBe("failed")
    const b = await gw.execute("resend", "orgA", "bulk", boom)
    expect(b.status).toBe("failed") // 2nd failure trips the breaker open
    // Now the breaker is open: the next call fails fast WITHOUT touching the provider.
    let touched = false
    const c = await gw.execute("resend", "orgA", "bulk", () => {
      touched = true
      return Promise.resolve("x")
    })
    expect(c.status).toBe("circuit_open")
    expect(touched).toBe(false)
    expect(gw.breakerState("resend")).toBe("open")
  })

  it("interactive that stays throttled through all attempts returns throttled", async () => {
    // burstCapacity 1, floorCapacity 1 here so the org can be fully drained.
    const gw = makeGateway({
      providers: {
        resend: {
          budget: { floorCapacity: 1, floorPerSec: 1, burstCapacity: 1, burstPerSec: 1 },
          breaker: { failureThreshold: 5, cooldownMs: 1000 },
        },
      },
    })
    let calls = 0
    const send = () => {
      calls += 1
      return Promise.resolve("ok")
    }
    await gw.execute("resend", "orgA", "interactive", send) // floor
    await gw.execute("resend", "orgA", "interactive", send) // burst
    const drained = await gw.execute("resend", "orgA", "interactive", send) // nothing left, clock frozen
    expect(drained.status).toBe("throttled")
    expect(calls).toBe(2) // the drained call never reached the provider
  })
})
