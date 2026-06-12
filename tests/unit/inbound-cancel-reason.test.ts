/**
 * Unit tests for `isAnsweredElsewhere` — the answered-on-another-device
 * classifier for inbound call teardown (3b).
 *
 * RC rings all of a user's devices at once. When the call is answered on
 * the cell / mobile app, RC cancels Pathway's leg with an RFC 3326
 * Reason header `SIP;cause=200;text="Call completed elsewhere"`. We must
 * recognize that and write NO no_answer row (it was answered, just not in
 * Pathway). A genuine caller-abandon CANCEL carries no cause=200.
 */
import { describe, it, expect } from "vitest"
import { isAnsweredElsewhere } from "@/modules/telephony/inbound-cancel-reason"

describe("isAnsweredElsewhere", () => {
  it("matches the exact RC 'completed elsewhere' Reason header", () => {
    expect(isAnsweredElsewhere('SIP;cause=200;text="Call completed elsewhere"')).toBe(true)
  })

  it("matches on cause=200 even without the text clause", () => {
    expect(isAnsweredElsewhere("SIP;cause=200")).toBe(true)
  })

  it("matches on the text clause even if the cause token is formatted oddly", () => {
    expect(isAnsweredElsewhere('SIP;text="Call Completed Elsewhere"')).toBe(true)
  })

  it("tolerates case + spacing variance", () => {
    expect(isAnsweredElsewhere('sip ; CAUSE = 200 ; text="call completed elsewhere"')).toBe(true)
  })

  it("does NOT match a genuine caller abandonment (cause=487)", () => {
    expect(isAnsweredElsewhere('SIP;cause=487;text="Request Terminated"')).toBe(false)
  })

  it("does NOT match normal clearing (cause=16)", () => {
    expect(isAnsweredElsewhere('SIP;cause=16;text="Normal call clearing"')).toBe(false)
  })

  it("does NOT false-match cause=2000 as cause=200 (word boundary)", () => {
    expect(isAnsweredElsewhere("SIP;cause=2000")).toBe(false)
  })

  it("returns false for a missing / empty Reason header", () => {
    expect(isAnsweredElsewhere(undefined)).toBe(false)
    expect(isAnsweredElsewhere(null)).toBe(false)
    expect(isAnsweredElsewhere("")).toBe(false)
  })
})
