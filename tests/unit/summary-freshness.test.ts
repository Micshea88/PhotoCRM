import { describe, it, expect } from "vitest"
import { isSummaryStale, SUMMARY_MAX_AGE_MS } from "@/modules/contacts/ai/summary-freshness"

const NOW = 1_800_000_000_000 // fixed "now" for deterministic comparisons

describe("isSummaryStale", () => {
  it("is stale when the summary was never generated", () => {
    expect(isSummaryStale(null, null, NOW)).toBe(true)
    expect(isSummaryStale(null, new Date(NOW), NOW)).toBe(true)
  })

  it("is stale when activity is newer than the summary", () => {
    const generatedAt = new Date(NOW - 5 * 60 * 1000) // 5m ago
    const lastActivityAt = new Date(NOW - 1 * 60 * 1000) // 1m ago (newer)
    expect(isSummaryStale(generatedAt, lastActivityAt, NOW)).toBe(true)
  })

  it("is stale when 1 hour has elapsed since generation (no new activity)", () => {
    const generatedAt = new Date(NOW - SUMMARY_MAX_AGE_MS - 1000) // just over 1h
    expect(isSummaryStale(generatedAt, null, NOW)).toBe(true)
    // activity older than the summary doesn't matter — time trigger still fires
    expect(isSummaryStale(generatedAt, new Date(NOW - 2 * SUMMARY_MAX_AGE_MS), NOW)).toBe(true)
  })

  it("is FRESH when recently generated and no newer activity", () => {
    const generatedAt = new Date(NOW - 5 * 60 * 1000) // 5m ago
    expect(isSummaryStale(generatedAt, null, NOW)).toBe(false)
    // activity older than the summary → not stale
    expect(isSummaryStale(generatedAt, new Date(NOW - 10 * 60 * 1000), NOW)).toBe(false)
  })

  it("treats activity exactly equal to generation as fresh (strictly newer triggers)", () => {
    const t = new Date(NOW - 5 * 60 * 1000)
    expect(isSummaryStale(t, new Date(t.getTime()), NOW)).toBe(false)
  })
})
