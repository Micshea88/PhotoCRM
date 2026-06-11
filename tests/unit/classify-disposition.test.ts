/**
 * Unit tests for `classifyDisposition` — the pure function that
 * derives a RecordedCallDisposition from the reducer's previousKind
 * + the SIP-response reason payload from the SDK's `failed` event.
 *
 * Anchors the locked taxonomy + 3s heuristic from the 2026-06-11
 * disposition push. Covers the decision tree in the JSDoc:
 *   1. Explicit "transferred" reason wins.
 *   2. SIP code 486 → busy; 408/480 → no_answer; 487 → cancelled or
 *      no_answer based on previousKind + duration; other 4xx-5xx → failed.
 *   3. No reason + previousKind=connected → completed.
 *   4. Defensive default: failed.
 */
import { describe, it, expect } from "vitest"
import {
  classifyDisposition,
  parseSipResponseCode,
  CANCELLED_RING_TIME_MS,
} from "@/modules/telephony/classify-disposition"

describe("classifyDisposition", () => {
  describe("transferred (explicit reason)", () => {
    it("returns transferred when reason === 'transferred', regardless of state", () => {
      expect(
        classifyDisposition({
          previousKind: "connected",
          reason: "transferred",
          durationMs: 60_000,
        }),
      ).toBe("transferred")
    })
  })

  describe("SIP response code mapping", () => {
    it("486 Busy Here → busy", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: "SIP/2.0 486 Busy Here",
          durationMs: 5000,
        }),
      ).toBe("busy")
    })

    it("408 Request Timeout → no_answer", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: "SIP/2.0 408 Request Timeout",
          durationMs: 30_000,
        }),
      ).toBe("no_answer")
    })

    it("480 Temporarily Unavailable → no_answer", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: "SIP/2.0 480 Temporarily Unavailable",
          durationMs: 20_000,
        }),
      ).toBe("no_answer")
    })

    it("487 Request Terminated + ring < 3s + previousKind=ringing → cancelled", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: "SIP/2.0 487 Request Terminated",
          durationMs: 1500,
        }),
      ).toBe("cancelled")
    })

    it("487 Request Terminated + ring exactly at 3s threshold → no_answer (boundary)", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: "SIP/2.0 487 Request Terminated",
          durationMs: CANCELLED_RING_TIME_MS,
        }),
      ).toBe("no_answer")
    })

    it("487 Request Terminated + ring > 3s → no_answer", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: "SIP/2.0 487 Request Terminated",
          durationMs: 10_000,
        }),
      ).toBe("no_answer")
    })

    it("487 Request Terminated + previousKind=connected → no_answer (rare path)", () => {
      // Defensive: if a 487 surfaces after a connected call, it
      // shouldn't be classified as cancelled — that's the rapid-
      // hangup-during-ring path only.
      expect(
        classifyDisposition({
          previousKind: "connected",
          reason: "SIP/2.0 487 Request Terminated",
          durationMs: 1000,
        }),
      ).toBe("no_answer")
    })

    it("503 Service Unavailable → failed", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: "SIP/2.0 503 Service Unavailable",
          durationMs: 500,
        }),
      ).toBe("failed")
    })

    it("404 Not Found → failed", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: "SIP/2.0 404 Not Found",
          durationMs: 800,
        }),
      ).toBe("failed")
    })

    it("488 Not Acceptable Here → failed", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: "SIP/2.0 488 Not Acceptable Here",
          durationMs: 700,
        }),
      ).toBe("failed")
    })

    it("non-SIP reason string (network error) → failed", () => {
      expect(
        classifyDisposition({
          previousKind: "starting",
          reason: "ECONNREFUSED",
          durationMs: 0,
        }),
      ).toBe("failed")
    })
  })

  describe("no reason — state + duration heuristic (the actual production path)", () => {
    it("previousKind=connected → completed (normal hangup after answered call)", () => {
      expect(
        classifyDisposition({
          previousKind: "connected",
          reason: undefined,
          durationMs: 45_000,
        }),
      ).toBe("completed")
    })

    it("previousKind=ringing + duration < 3s → cancelled (rapid hangup mid-ring)", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: undefined,
          durationMs: 2000,
        }),
      ).toBe("cancelled")
    })

    it("previousKind=ringing + duration exactly 3s (boundary) → no_answer", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: undefined,
          durationMs: CANCELLED_RING_TIME_MS,
        }),
      ).toBe("no_answer")
    })

    it("previousKind=ringing + duration ≥ 3s → no_answer (rang then gave up)", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: undefined,
          durationMs: 10_000,
        }),
      ).toBe("no_answer")
    })

    it("previousKind=ringing + duration > 30s → no_answer (long ring with no pickup)", () => {
      expect(
        classifyDisposition({
          previousKind: "ringing",
          reason: undefined,
          durationMs: 35_000,
        }),
      ).toBe("no_answer")
    })

    it("previousKind=starting → failed (call never even reached ringing)", () => {
      expect(
        classifyDisposition({
          previousKind: "starting",
          reason: undefined,
          durationMs: 0,
        }),
      ).toBe("failed")
    })
  })
})

describe("parseSipResponseCode", () => {
  it("extracts numeric code from a SIP/2.0 line", () => {
    expect(parseSipResponseCode("SIP/2.0 486 Busy Here")).toBe(486)
  })

  it("handles different codes", () => {
    expect(parseSipResponseCode("SIP/2.0 408 Request Timeout")).toBe(408)
    expect(parseSipResponseCode("SIP/2.0 487 Request Terminated")).toBe(487)
    expect(parseSipResponseCode("SIP/2.0 503 Service Unavailable")).toBe(503)
  })

  it("returns null for non-SIP strings", () => {
    expect(parseSipResponseCode("ECONNREFUSED")).toBeNull()
    expect(parseSipResponseCode("failed")).toBeNull()
    expect(parseSipResponseCode("")).toBeNull()
  })

  it("returns null for SIP-like strings that don't match the exact prefix", () => {
    expect(parseSipResponseCode("SIP/1.0 486 Busy Here")).toBeNull()
    expect(parseSipResponseCode("HTTP/2.0 486 Busy")).toBeNull()
  })
})
