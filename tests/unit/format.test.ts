/**
 * Unit tests for the US-only display formatters (LOC1, PIVOTS_LEDGER §1).
 *
 * These formatters land in P4-prep ahead of the P4.1 dashboard work,
 * so every Phase 4 UI surface has a single shared display path for
 * money and dates.
 */
import { describe, it, expect } from "vitest"
import { formatCents, formatDate } from "@/lib/format"

describe("formatCents", () => {
  it("renders zero", () => {
    expect(formatCents(0)).toBe("$0.00")
  })

  it("renders one cent", () => {
    expect(formatCents(1)).toBe("$0.01")
  })

  it("renders a typical positive value with US thousands separators", () => {
    expect(formatCents(226667)).toBe("$2,266.67")
  })

  it("renders a negative value (refund / credit) with leading minus", () => {
    expect(formatCents(-100)).toBe("-$1.00")
    expect(formatCents(-226667)).toBe("-$2,266.67")
  })

  it("renders a large value without scientific notation", () => {
    // 99 billion cents = $999,999,999.99 — well past the threshold
    // where naive (cents / 100).toString() can drift to exponential.
    expect(formatCents(99_999_999_999)).toBe("$999,999,999.99")
  })

  it("renders an extremely large value cleanly", () => {
    expect(formatCents(1_000_000_000_000)).toBe("$10,000,000,000.00")
  })

  it("throws on a non-integer (float input is a caller bug)", () => {
    expect(() => formatCents(1.5)).toThrow(/integer/)
    expect(() => formatCents(0.1)).toThrow(/integer/)
  })

  it("throws on NaN", () => {
    expect(() => formatCents(Number.NaN)).toThrow(/integer/)
  })

  it("throws on Infinity", () => {
    expect(() => formatCents(Number.POSITIVE_INFINITY)).toThrow(/integer/)
  })
})

describe("formatDate", () => {
  it("renders a date-only ISO string as MM/DD/YYYY", () => {
    expect(formatDate("2026-05-20")).toBe("05/20/2026")
  })

  it("zero-pads month and day", () => {
    expect(formatDate("2026-01-01")).toBe("01/01/2026")
    expect(formatDate("2026-03-09")).toBe("03/09/2026")
  })

  it("renders a full ISO datetime (ignoring everything after the date)", () => {
    expect(formatDate("2026-12-31T15:00:00Z")).toBe("12/31/2026")
    expect(formatDate("2026-12-31T15:00:00.123+05:00")).toBe("12/31/2026")
  })

  it("does NOT shift for timezone — slices the calendar date as written", () => {
    // A Date constructor would parse "2026-01-01T00:00:00Z" and render
    // local-time MM/DD/YYYY (potentially "12/31/2025" in PST). This
    // function avoids the Date constructor entirely.
    expect(formatDate("2026-01-01T00:00:00Z")).toBe("01/01/2026")
  })

  it("throws on a string that doesn't start with YYYY-MM-DD", () => {
    expect(() => formatDate("05/20/2026")).toThrow()
    expect(() => formatDate("not a date")).toThrow()
    expect(() => formatDate("")).toThrow()
  })

  it("throws on a malformed prefix (wrong delimiter / wrong digit count)", () => {
    expect(() => formatDate("2026/05/20")).toThrow()
    expect(() => formatDate("26-05-20")).toThrow()
  })
})
