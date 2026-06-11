/**
 * Unit tests for `classifyDisposition`.
 *
 * **Major contract shift 2026-06-11 (afternoon):** the no-reason
 * path is now duration-only — previousKind is ignored on that
 * branch because the RC WebPhone SDK fires `answered` ~42ms after
 * `ringing` regardless of whether the remote picked up. Verified
 * via [TELEPHONY-DIAG] console logs. Three duration brackets:
 *   - < 3s    → cancelled
 *   - 3s-20s  → no_answer
 *   - ≥ 20s   → completed
 *
 * The reason-present path is unchanged: SIP 486 → busy, 408/480 →
 * no_answer, 487 with duration heuristic for cancelled vs no_answer,
 * other 4xx-5xx → failed.
 */
import { describe, it, expect } from "vitest"
import {
  classifyDisposition,
  parseSipResponseCode,
  CANCELLED_RING_TIME_MS,
  COMPLETED_DURATION_MS,
} from "@/modules/telephony/classify-disposition"

describe("classifyDisposition", () => {
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

  describe("no reason — duration-only heuristic (the actual production path)", () => {
    // The SDK's `answered` event is unreliable (fires ~42ms after
    // ringing regardless of actual pickup), so every call lands as
    // previousKind="connected". The tests below assert duration is
    // what drives classification — previousKind values are still
    // passed (signature requires them) but should NOT affect
    // outcome on the no-reason path.

    it("duration < 3s → cancelled (rapid hangup; previousKind irrelevant)", () => {
      expect(
        classifyDisposition({
          previousKind: "connected", // SDK bug — would be "connected" in reality
          reason: undefined,
          durationMs: 2000,
        }),
      ).toBe("cancelled")
    })

    it("duration at the 3s boundary → no_answer", () => {
      expect(
        classifyDisposition({
          previousKind: "connected",
          reason: undefined,
          durationMs: CANCELLED_RING_TIME_MS,
        }),
      ).toBe("no_answer")
    })

    it("duration in mid-band (10s) → no_answer", () => {
      expect(
        classifyDisposition({
          previousKind: "connected",
          reason: undefined,
          durationMs: 10_000,
        }),
      ).toBe("no_answer")
    })

    it("duration just below the 20s boundary → no_answer (19.999s)", () => {
      expect(
        classifyDisposition({
          previousKind: "connected",
          reason: undefined,
          durationMs: COMPLETED_DURATION_MS - 1,
        }),
      ).toBe("no_answer")
    })

    it("duration at the 20s boundary → completed", () => {
      expect(
        classifyDisposition({
          previousKind: "connected",
          reason: undefined,
          durationMs: COMPLETED_DURATION_MS,
        }),
      ).toBe("completed")
    })

    it("duration well above 20s → completed (45s real conversation)", () => {
      expect(
        classifyDisposition({
          previousKind: "connected",
          reason: undefined,
          durationMs: 45_000,
        }),
      ).toBe("completed")
    })

    it("previousKind does NOT influence outcome on the no-reason path", () => {
      // Same duration, three different previousKind values → all
      // classify identically. Proves the duration-only contract.
      const durations = [2000, 10_000, 30_000]
      const expectedByDuration = ["cancelled", "no_answer", "completed"] as const

      for (let i = 0; i < durations.length; i++) {
        for (const prev of ["starting", "ringing", "connected"] as const) {
          expect(
            classifyDisposition({
              previousKind: prev,
              reason: undefined,
              durationMs: durations[i]!,
            }),
          ).toBe(expectedByDuration[i])
        }
      }
    })

    it("starting + 0ms → cancelled (under the V1 contract)", () => {
      // The previous spec classified starting → failed, but with the
      // duration-only heuristic this lands in the cancelled bracket.
      // Acceptable per the explicit Mike-approved tradeoff: starting
      // with no reason effectively never happens in practice (the
      // phone.call().catch() path always provides a reason), so this
      // case is theoretical.
      expect(
        classifyDisposition({
          previousKind: "starting",
          reason: undefined,
          durationMs: 0,
        }),
      ).toBe("cancelled")
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
