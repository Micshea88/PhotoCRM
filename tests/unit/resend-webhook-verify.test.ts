/**
 * Unit tests for verifyResendWebhook (Task 5 — shared Svix verifier extraction).
 *
 * Tests OUR wrapper's behaviour, not Svix crypto. The seam is
 * `resend().webhooks.verify` — mocked here to control what it returns or throws.
 *
 * Three scenarios:
 *   1. verify returns a payload object → wrapper returns it.
 *   2. verify throws (bad signature)   → wrapper returns null (does not throw).
 *   3. RESEND_WEBHOOK_SECRET unset     → wrapper returns null without calling verify.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted: runs before vi.mock factories (and before imports), so these
// refs are available inside the factory closures below.
const mockVerify = vi.hoisted(() => vi.fn())
const mockEnv = vi.hoisted((): { RESEND_API_KEY: string; RESEND_WEBHOOK_SECRET?: string } => ({
  RESEND_API_KEY: "re_test_key",
  RESEND_WEBHOOK_SECRET: "whsec_test_secret_for_unit_tests",
}))

// Mock the resend SDK: Resend constructor returns an object with a mocked
// webhooks.verify so we never touch real Svix crypto.
// Use a class (not vi.fn arrow) so `new Resend(...)` works correctly as a
// constructor (vi.fn with an arrow implementation produces a Vitest warning
// and may not return the expected instance).
vi.mock("resend", () => ({
  Resend: class {
    webhooks = { verify: mockVerify }
  },
}))

// Mock @/lib/env (t3-env's server-guard refuses server vars in jsdom).
vi.mock("@/lib/env", () => ({ env: mockEnv }))

// Mock DB to prevent any connection attempt on module load.
vi.mock("@/lib/db", () => ({ db: {} }))

// Silence pino output in test runs.
vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { verifyResendWebhook } from "@/modules/email-log/inbound"

const sampleHeaders = {
  "svix-id": "msg_test_123",
  "svix-timestamp": "1704067200",
  "svix-signature": "v1,test_sig_abc",
}

describe("verifyResendWebhook", () => {
  beforeEach(() => {
    mockVerify.mockReset()
    mockEnv.RESEND_WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests"
  })

  it("returns the verified payload object when webhooks.verify succeeds", () => {
    const payload = { type: "email.delivered", data: { emailId: "abc123" } }
    mockVerify.mockReturnValue(payload)

    const result = verifyResendWebhook('{"type":"email.delivered"}', sampleHeaders)

    expect(result).toBe(payload)
    expect(mockVerify).toHaveBeenCalledOnce()
  })

  it("returns null when webhooks.verify throws (invalid signature)", () => {
    mockVerify.mockImplementation(() => {
      throw new Error("Invalid signature")
    })

    const result = verifyResendWebhook("tampered_body", sampleHeaders)

    expect(result).toBeNull()
  })

  it("returns null without calling verify when RESEND_WEBHOOK_SECRET is unset", () => {
    mockEnv.RESEND_WEBHOOK_SECRET = undefined

    const result = verifyResendWebhook('{"type":"email.received"}', sampleHeaders)

    expect(result).toBeNull()
    expect(mockVerify).not.toHaveBeenCalled()
  })
})
