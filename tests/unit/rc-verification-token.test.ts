/**
 * Unit tests for RingCentral webhook auth helpers (Build 1).
 */
import { describe, it, expect } from "vitest"
import {
  getValidationToken,
  verifyVerificationToken,
  isVerifiedWebhookRequest,
} from "@/lib/ringcentral/verification-token"

describe("verifyVerificationToken", () => {
  it("accepts an exact match", () => {
    expect(verifyVerificationToken("s3cret-token", "s3cret-token")).toBe(true)
  })
  it("rejects a mismatch of equal length", () => {
    expect(verifyVerificationToken("s3cret-tokenA", "s3cret-tokenB")).toBe(false)
  })
  it("rejects a length mismatch", () => {
    expect(verifyVerificationToken("short", "longer-token")).toBe(false)
  })
  it("rejects when received is missing", () => {
    expect(verifyVerificationToken(null, "expected")).toBe(false)
    expect(verifyVerificationToken(undefined, "expected")).toBe(false)
    expect(verifyVerificationToken("", "expected")).toBe(false)
  })
  it("rejects when the expected secret is unset (fails closed)", () => {
    expect(verifyVerificationToken("anything", null)).toBe(false)
    expect(verifyVerificationToken("anything", undefined)).toBe(false)
  })
})

describe("getValidationToken / isVerifiedWebhookRequest", () => {
  it("reads the one-time Validation-Token handshake header", () => {
    const h = new Headers({ "Validation-Token": "abc123" })
    expect(getValidationToken(h)).toBe("abc123")
    expect(getValidationToken(new Headers())).toBeNull()
  })
  it("verifies a request's per-event Verification Token header", () => {
    const ok = new Headers({ "Verification-Token": "secret" })
    const bad = new Headers({ "Verification-Token": "nope" })
    expect(isVerifiedWebhookRequest(ok, "secret")).toBe(true)
    expect(isVerifiedWebhookRequest(bad, "secret")).toBe(false)
    expect(isVerifiedWebhookRequest(new Headers(), "secret")).toBe(false)
  })
})
