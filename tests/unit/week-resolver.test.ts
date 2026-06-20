/**
 * Unit tests for the Monday-Sunday (ISO 8601) week resolver + current-
 * month-range helper. Mike-locked 2026-06-20: Sunday is the END of the
 * current week, not day 1 of the next. Pure UTC arithmetic; no timezone
 * library; no DST math. Per Module 14b discipline, the functions take and
 * return YYYY-MM-DD strings — never Date objects.
 */
import { describe, it, expect } from "vitest"
import { resolveMondaySundayWeek, resolveCurrentMonthRange } from "@/lib/format"

describe("resolveMondaySundayWeek", () => {
  it("a Wednesday returns the previous Monday + following Sunday", () => {
    // 2026-05-20 is a Wednesday — week is May 18 (Mon) through May 24 (Sun).
    expect(resolveMondaySundayWeek("2026-05-20")).toEqual({
      startISO: "2026-05-18",
      endISO: "2026-05-24",
    })
  })

  it("a Monday returns itself as start and the following Sunday as end", () => {
    // 2026-05-18 is a Monday.
    expect(resolveMondaySundayWeek("2026-05-18")).toEqual({
      startISO: "2026-05-18",
      endISO: "2026-05-24",
    })
  })

  it("a Sunday returns the previous Monday as start and itself as end", () => {
    // 2026-05-24 is a Sunday — the END of the Mon–Sun week.
    expect(resolveMondaySundayWeek("2026-05-24")).toEqual({
      startISO: "2026-05-18",
      endISO: "2026-05-24",
    })
  })

  it("works across month boundaries", () => {
    // 2026-06-01 is a Monday — week is June 1 (Mon) through June 7 (Sun).
    expect(resolveMondaySundayWeek("2026-06-01")).toEqual({
      startISO: "2026-06-01",
      endISO: "2026-06-07",
    })
  })

  it("works across year boundaries", () => {
    // 2027-01-01 is a Friday — week is Dec 28 2026 (Mon) through Jan 3 2027 (Sun).
    expect(resolveMondaySundayWeek("2027-01-01")).toEqual({
      startISO: "2026-12-28",
      endISO: "2027-01-03",
    })
  })

  it("works on a leap-year edge case (Feb 29, 2024 was a Thursday)", () => {
    // Week is Feb 26 (Mon) through Mar 3 (Sun).
    expect(resolveMondaySundayWeek("2024-02-29")).toEqual({
      startISO: "2024-02-26",
      endISO: "2024-03-03",
    })
  })

  it("throws on a malformed input", () => {
    expect(() => resolveMondaySundayWeek("05/20/2026")).toThrow()
    expect(() => resolveMondaySundayWeek("not a date")).toThrow()
  })
})

describe("resolveCurrentMonthRange", () => {
  it("returns first and last day of a 31-day month", () => {
    expect(resolveCurrentMonthRange("2026-05-20")).toEqual({
      startISO: "2026-05-01",
      endISO: "2026-05-31",
    })
  })

  it("returns first and last day of a 30-day month", () => {
    expect(resolveCurrentMonthRange("2026-04-15")).toEqual({
      startISO: "2026-04-01",
      endISO: "2026-04-30",
    })
  })

  it("returns Feb 28 for a non-leap February", () => {
    expect(resolveCurrentMonthRange("2026-02-15")).toEqual({
      startISO: "2026-02-01",
      endISO: "2026-02-28",
    })
  })

  it("returns Feb 29 for a leap-year February (2024)", () => {
    expect(resolveCurrentMonthRange("2024-02-15")).toEqual({
      startISO: "2024-02-01",
      endISO: "2024-02-29",
    })
  })

  it("returns Feb 29 for divisible-by-400 century leap (2000)", () => {
    expect(resolveCurrentMonthRange("2000-02-15")).toEqual({
      startISO: "2000-02-01",
      endISO: "2000-02-29",
    })
  })

  it("returns Feb 28 for divisible-by-100-not-400 century (1900)", () => {
    expect(resolveCurrentMonthRange("1900-02-15")).toEqual({
      startISO: "1900-02-01",
      endISO: "1900-02-28",
    })
  })

  it("throws on a malformed input", () => {
    expect(() => resolveCurrentMonthRange("not a date")).toThrow()
  })
})
