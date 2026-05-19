/**
 * Tests for the date primitives — written FIRST. Dates are silent-
 * corruption mode C: the bug pattern is using `new Date(string)` and
 * then calling local-time methods (`.getDate()`, `.toString()`). On
 * the spring-forward boundary in DST-observing zones, a naive
 * `setDate(d.getDate()+1)` can yield the wrong calendar day.
 *
 * Defense: `addDays` parses YYYY-MM-DD as three integers and uses
 * `Date.UTC` for arithmetic (UTC has no DST). String in, string out.
 * NEVER use `new Date(string)` in `dates.ts`.
 */
import { describe, it, expect } from "vitest"
import { addDays, isValidIsoDate } from "@/lib/recompute/dates"

describe("addDays", () => {
  it("adds positive offset within a month", () => {
    expect(addDays("2026-06-10", 5)).toBe("2026-06-15")
  })

  it("subtracts via negative offset", () => {
    expect(addDays("2026-06-10", -3)).toBe("2026-06-07")
  })

  it("crosses month boundary forward", () => {
    expect(addDays("2026-06-28", 5)).toBe("2026-07-03")
  })

  it("crosses month boundary backward", () => {
    expect(addDays("2026-06-02", -5)).toBe("2026-05-28")
  })

  it("crosses year boundary", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04")
    expect(addDays("2027-01-02", -5)).toBe("2026-12-28")
  })

  it("handles leap day correctly (2028 is a leap year)", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29")
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01")
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01") // 2027 is NOT a leap year
  })

  it("DST spring-forward day in US (2026-03-08) — adding 1 day yields 2026-03-09", () => {
    // The bug we're defending against: a Date-based implementation
    // running under TZ=America/Los_Angeles would mis-arithmetic this
    // by one day because the spring-forward day has 23 hours.
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09")
    expect(addDays("2026-03-08", 7)).toBe("2026-03-15")
    expect(addDays("2026-03-09", -1)).toBe("2026-03-08")
  })

  it("DST fall-back day in US (2026-11-01) — adding 1 day yields 2026-11-02", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02")
    expect(addDays("2026-11-01", 7)).toBe("2026-11-08")
  })

  it("zero offset returns the same date", () => {
    expect(addDays("2026-05-19", 0)).toBe("2026-05-19")
  })

  it("rejects non-string input (silent-corruption mode C)", () => {
    // @ts-expect-error — runtime check against accidental Date use
    expect(() => addDays(new Date("2026-05-19"), 1)).toThrow()
  })

  it("rejects malformed date strings", () => {
    expect(() => addDays("2026/05/19", 1)).toThrow(/format|YYYY-MM-DD/i)
    expect(() => addDays("not-a-date", 1)).toThrow(/format|YYYY-MM-DD/i)
    expect(() => addDays("2026-13-01", 1)).toThrow(/invalid|month/i)
    expect(() => addDays("2026-02-30", 1)).toThrow(/invalid|day/i)
  })

  it("rejects non-integer offset", () => {
    expect(() => addDays("2026-05-19", 1.5)).toThrow(/integer/i)
  })

  it("invariant: addDays(addDays(d, n), -n) === d for arbitrary n", () => {
    const cases = [
      ["2026-03-08", 1],
      ["2026-03-08", 90],
      ["2026-03-08", 365],
      ["2026-11-01", -7],
      ["2028-02-29", 1],
    ] as const
    for (const [d, n] of cases) {
      expect(addDays(addDays(d, n), -n)).toBe(d)
    }
  })
})

describe("isValidIsoDate", () => {
  it("accepts canonical YYYY-MM-DD", () => {
    expect(isValidIsoDate("2026-05-19")).toBe(true)
    expect(isValidIsoDate("2028-02-29")).toBe(true) // leap
  })

  it("rejects non-canonical formats", () => {
    expect(isValidIsoDate("2026/05/19")).toBe(false)
    expect(isValidIsoDate("05-19-2026")).toBe(false)
    expect(isValidIsoDate("")).toBe(false)
  })

  it("rejects impossible dates", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false)
    expect(isValidIsoDate("2027-02-29")).toBe(false) // non-leap
    expect(isValidIsoDate("2026-13-01")).toBe(false)
  })
})
