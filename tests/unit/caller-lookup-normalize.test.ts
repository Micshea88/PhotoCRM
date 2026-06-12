/**
 * Unit tests for inbound caller-ID normalization (3b).
 *
 * The `lookupContactByPhone` action normalizes the inbound number via
 * `parsePhoneInput` (the same helper the contact edit form uses) before
 * the SQL match: strip non-digits, drop a leading 1, require exactly 10
 * digits. This guards the normalization contract that determines whether
 * a caller matches a stored contact — the failure mode the research
 * flagged (format mismatch → call logs to "unknown contact").
 */
import { describe, it, expect } from "vitest"
import { parsePhoneInput } from "@/lib/format/phone"

describe("inbound caller-ID normalization (parsePhoneInput)", () => {
  it("normalizes the RC SIP form (+1 E.164) to 10 digits", () => {
    expect(parsePhoneInput("+15551234567")).toBe("5551234567")
  })

  it("normalizes a bare leading-1 11-digit number", () => {
    expect(parsePhoneInput("15551234567")).toBe("5551234567")
  })

  it("normalizes a fully formatted display number", () => {
    expect(parsePhoneInput("(555) 123-4567")).toBe("5551234567")
  })

  it("normalizes mixed separators (dots, spaces, dashes, +1)", () => {
    expect(parsePhoneInput("+1 (555) 123.4567")).toBe("5551234567")
    expect(parsePhoneInput("555-123-4567")).toBe("5551234567")
  })

  it("passes through a clean 10-digit number unchanged", () => {
    expect(parsePhoneInput("5551234567")).toBe("5551234567")
  })

  it("returns null for too-short input (no false match)", () => {
    expect(parsePhoneInput("123")).toBeNull()
    expect(parsePhoneInput("5551234")).toBeNull()
  })

  it("returns null for empty / blocked caller-ID", () => {
    expect(parsePhoneInput("")).toBeNull()
    expect(parsePhoneInput(null)).toBeNull()
    expect(parsePhoneInput(undefined)).toBeNull()
  })
})
