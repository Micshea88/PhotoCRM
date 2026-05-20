/**
 * Unit tests for the Sunday-Saturday week resolver + current-month-
 * range helper. Per LOC1, US conventions; pure UTC arithmetic; no
 * timezone library; no DST math. Per Module 14b discipline, the
 * functions take and return YYYY-MM-DD strings — never Date objects.
 */
import { describe, it, expect } from "vitest"
import { resolveSundaySaturdayWeek, resolveCurrentMonthRange } from "@/lib/format"

describe("resolveSundaySaturdayWeek", () => {
  it("a Wednesday returns previous Sunday + following Saturday", () => {
    // 2026-05-20 is a Wednesday (verified: dayofweek lookup).
    expect(resolveSundaySaturdayWeek("2026-05-20")).toEqual({
      startISO: "2026-05-17",
      endISO: "2026-05-23",
    })
  })

  it("a Sunday returns itself as start and the following Saturday as end", () => {
    // 2026-05-17 is a Sunday.
    expect(resolveSundaySaturdayWeek("2026-05-17")).toEqual({
      startISO: "2026-05-17",
      endISO: "2026-05-23",
    })
  })

  it("a Saturday returns the previous Sunday as start and itself as end", () => {
    // 2026-05-23 is a Saturday.
    expect(resolveSundaySaturdayWeek("2026-05-23")).toEqual({
      startISO: "2026-05-17",
      endISO: "2026-05-23",
    })
  })

  it("works across month boundaries", () => {
    // 2026-06-01 is a Monday — week is May 31 (Sun) through June 6 (Sat).
    expect(resolveSundaySaturdayWeek("2026-06-01")).toEqual({
      startISO: "2026-05-31",
      endISO: "2026-06-06",
    })
  })

  it("works across year boundaries", () => {
    // 2027-01-01 is a Friday — week is Dec 27 2026 (Sun) through Jan 2 2027 (Sat).
    expect(resolveSundaySaturdayWeek("2027-01-01")).toEqual({
      startISO: "2026-12-27",
      endISO: "2027-01-02",
    })
  })

  it("works on a leap-year edge case (Feb 29, 2024 was a Thursday)", () => {
    // Week is Feb 25 (Sun) through Mar 2 (Sat).
    expect(resolveSundaySaturdayWeek("2024-02-29")).toEqual({
      startISO: "2024-02-25",
      endISO: "2024-03-02",
    })
  })

  it("throws on a malformed input", () => {
    expect(() => resolveSundaySaturdayWeek("05/20/2026")).toThrow()
    expect(() => resolveSundaySaturdayWeek("not a date")).toThrow()
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
