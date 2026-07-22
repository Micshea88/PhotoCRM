/**
 * Outbound gateway — step 2, per-provider circuit breaker. Asserts the full state
 * machine's OBSERVABLE behavior (fail-fast when open, probe-and-recover), with an
 * injected clock so there's no timing flakiness.
 */
import { describe, it, expect } from "vitest"
import { CircuitBreaker } from "@/lib/outbound/circuit-breaker"

const opts = { failureThreshold: 3, cooldownMs: 1000 }

describe("CircuitBreaker", () => {
  it("stays closed and lets calls through until the failure threshold", () => {
    const cb = new CircuitBreaker(opts)
    const t = 1_000_000
    expect(cb.canProceed(t)).toBe(true)
    cb.onFailure(t)
    cb.onFailure(t)
    expect(cb.currentState()).toBe("closed") // 2 < 3
    expect(cb.canProceed(t)).toBe(true)
  })

  it("opens after threshold consecutive failures and fails fast during cooldown", () => {
    const cb = new CircuitBreaker(opts)
    const t = 1_000_000
    cb.onFailure(t)
    cb.onFailure(t)
    cb.onFailure(t) // 3rd → open
    expect(cb.currentState()).toBe("open")
    expect(cb.canProceed(t)).toBe(false) // fail fast
    expect(cb.canProceed(t + 999)).toBe(false) // still within cooldown
  })

  it("half-opens after cooldown; a successful probe closes it", () => {
    const cb = new CircuitBreaker(opts)
    const t = 1_000_000
    cb.onFailure(t)
    cb.onFailure(t)
    cb.onFailure(t) // open
    expect(cb.canProceed(t + 1000)).toBe(true) // cooldown elapsed → half-open probe
    expect(cb.currentState()).toBe("half-open")
    cb.onSuccess() // probe worked
    expect(cb.currentState()).toBe("closed")
    expect(cb.canProceed(t + 1000)).toBe(true)
  })

  it("re-opens if the half-open probe fails", () => {
    const cb = new CircuitBreaker(opts)
    const t = 1_000_000
    cb.onFailure(t)
    cb.onFailure(t)
    cb.onFailure(t) // open
    cb.canProceed(t + 1000) // → half-open
    cb.onFailure(t + 1000) // probe failed
    expect(cb.currentState()).toBe("open")
    expect(cb.canProceed(t + 1000)).toBe(false) // cooldown restarts
  })

  it("a success resets the failure count (only CONSECUTIVE failures trip it)", () => {
    const cb = new CircuitBreaker(opts)
    const t = 1_000_000
    cb.onFailure(t)
    cb.onFailure(t)
    cb.onSuccess() // resets
    cb.onFailure(t)
    cb.onFailure(t)
    expect(cb.currentState()).toBe("closed") // only 2 in a row since the success
  })
})
