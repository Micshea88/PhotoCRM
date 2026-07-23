/**
 * Outbound gateway — step 6, throttle visibility. Asserts the OBSERVABLE signal:
 * the gateway fires onThrottle for delayed sends (and NOT for sent/failed), and
 * the ThrottleLog read-side reports "catching up" within its window, bounded and
 * time-scoped. Injected clock, no real timers.
 */
import { describe, it, expect, vi } from "vitest"
import { InMemoryStore } from "@/lib/outbound/store"
import { OutboundGateway } from "@/lib/outbound/gateway"
import { ThrottleLog, type ThrottleEvent } from "@/lib/outbound/throttle-signal"

const NOW = 1_000_000
const noopSleep = (): Promise<void> => Promise.resolve()

describe("gateway onThrottle emit", () => {
  it("fires onThrottle when a bulk send is throttled, with provider/org/status", async () => {
    const events: ThrottleEvent[] = []
    const gw = new OutboundGateway({
      store: new InMemoryStore(),
      providers: {
        resend: {
          budget: { floorCapacity: 1, floorPerSec: 1, burstCapacity: 1, burstPerSec: 1 },
          breaker: { failureThreshold: 5, cooldownMs: 1000 },
        },
      },
      sleep: noopSleep,
      now: () => NOW,
      onThrottle: (e) => events.push(e),
    })
    await gw.execute("resend", "orgA", "bulk", () => Promise.resolve("ok")) // drains burst
    const throttled = await gw.execute("resend", "orgA", "bulk", () => Promise.resolve("ok"))
    expect(throttled.status).toBe("throttled")
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      provider: "resend",
      orgId: "orgA",
      status: "throttled",
      at: NOW,
    })
    expect(events[0]?.retryAfterMs).toBeGreaterThan(0)
  })

  it("does NOT fire onThrottle for a successful send", async () => {
    const onThrottle = vi.fn()
    const gw = new OutboundGateway({
      store: new InMemoryStore(),
      providers: {
        resend: {
          budget: { floorCapacity: 5, floorPerSec: 5, burstCapacity: 5, burstPerSec: 5 },
          breaker: { failureThreshold: 5, cooldownMs: 1000 },
        },
      },
      sleep: noopSleep,
      now: () => NOW,
      onThrottle,
    })
    await gw.execute("resend", "orgA", "interactive", () => Promise.resolve("ok"))
    expect(onThrottle).not.toHaveBeenCalled()
  })
})

describe("ThrottleLog", () => {
  const ev = (orgId: string, at: number): ThrottleEvent => ({
    provider: "resend",
    orgId,
    status: "throttled",
    retryAfterMs: 500,
    at,
  })

  it("reports catching-up within the window and clears after it", () => {
    const tl = new ThrottleLog(20, 60_000)
    tl.record(ev("orgA", NOW))
    expect(tl.isCatchingUp("orgA", NOW + 1000)).toBe(true) // within 60s
    expect(tl.isCatchingUp("orgA", NOW + 61_000)).toBe(false) // stale
    expect(tl.isCatchingUp("orgB", NOW)).toBe(false) // isolated per org
  })

  it("is bounded per org (ring)", () => {
    const tl = new ThrottleLog(3, 60_000)
    for (let i = 0; i < 10; i++) tl.record(ev("orgA", NOW + i))
    expect(tl.recent("orgA", NOW + 10)).toHaveLength(3) // only the last 3 kept
  })
})
