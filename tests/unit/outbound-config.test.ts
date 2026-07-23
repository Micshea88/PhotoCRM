/**
 * Outbound gateway — step 4a, assembled config. Smoke-tests that the singleton
 * wires the real per-provider budgets into a working gateway: a configured
 * provider admits a send, and an unconfigured one fails fast. Not a limits test
 * (those live in the engine tests) — this proves the wiring, per LAW 7.
 */
import { describe, it, expect, vi } from "vitest"

// config → upstash-store → @/lib/log all read `env`; t3-env forbids server-var
// access in the jsdom unit context, so mock env (Upstash unset → in-memory store).
vi.mock("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
  },
}))

import { getOutboundGateway, OUTBOUND_PROVIDERS } from "@/lib/outbound/config"

describe("getOutboundGateway", () => {
  it("returns a stable singleton", () => {
    expect(getOutboundGateway()).toBe(getOutboundGateway())
  })

  it("has the three real providers configured", () => {
    expect(Object.keys(OUTBOUND_PROVIDERS).sort()).toEqual(["nylas", "resend", "ringcentral"])
  })

  it("admits a send through a configured provider", async () => {
    const gw = getOutboundGateway()
    const r = await gw.execute("resend", "org-smoke", "interactive", () => Promise.resolve("ok"))
    expect(r.status).toBe("sent")
  })

  it("fails fast for a provider that isn't configured", async () => {
    const gw = getOutboundGateway()
    const r = await gw.execute("pigeon", "org-smoke", "interactive", () => Promise.resolve("ok"))
    expect(r.status).toBe("failed")
  })
})
