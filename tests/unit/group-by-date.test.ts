/**
 * Unit tests for E6 — dated day-grouping in group-by-date.ts.
 *
 * All tests use a FIXED injected `now` so the output is deterministic and
 * never depends on the real clock.
 *
 * Fixed anchor: 2026-07-09T15:00:00 local time (a Thursday).
 *   - Day 0 (Jul 9)  → "Today"
 *   - Day 1 (Jul 8)  → "Yesterday"
 *   - Day 2 (Jul 7)  → "Tuesday"
 *   - Day 3 (Jul 6)  → "Monday"
 *   - Day 4 (Jul 5)  → "Sunday"
 *   - Day 5 (Jul 4)  → "Saturday"
 *   - Day 6 (Jul 3)  → "Friday"
 *   - Day 7+ (Jul 2) → "Jul 2" (same year)
 *   - Prior year (Dec 14, 2025) → "Dec 14, 2025"
 */
import { describe, it, expect } from "vitest"
import { groupByDate } from "@/modules/notifications/ui/group-by-date"
import type { NotificationWithContact } from "@/modules/notifications/queries"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fixed "now": Thursday 2026-07-09T15:00:00 local time. */
const NOW = new Date(2026, 6, 9, 15, 0, 0) // month is 0-indexed

function makeNotif(createdAt: Date): NotificationWithContact {
  return {
    id: crypto.randomUUID(),
    organizationId: "org1",
    recipientUserId: "user1",
    type: "email.bounced",
    category: "messages_email",
    tier: "critical",
    title: "Test",
    body: null,
    linkPath: null,
    contactId: null,
    payload: null,
    sourceModule: "email",
    readAt: null,
    archivedAt: null,
    snoozedUntil: null,
    scheduledFor: null,
    emailSentAt: null,
    createdAt,
    updatedAt: createdAt,
    contactName: null,
  }
}

/** A notification created at a specific day offset from NOW (hours = noon to be unambiguous). */
function notifDaysAgo(daysAgo: number, hours = 12): NotificationWithContact {
  const d = new Date(NOW)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hours, 0, 0, 0)
  return makeNotif(d)
}

// ---------------------------------------------------------------------------
// Bucket label tests
// ---------------------------------------------------------------------------

describe("groupByDate — bucket labels", () => {
  it("items from today land in 'Today'", () => {
    const n = notifDaysAgo(0)
    const groups = groupByDate([n], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe("Today")
  })

  it("items from yesterday land in 'Yesterday'", () => {
    const n = notifDaysAgo(1)
    const groups = groupByDate([n], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe("Yesterday")
  })

  it("day 2 ago lands in the weekday name (Tuesday for 2026-07-07)", () => {
    const n = notifDaysAgo(2)
    const groups = groupByDate([n], NOW)
    expect(groups[0]!.label).toBe("Tuesday")
  })

  it("day 3 ago lands in the weekday name (Monday for 2026-07-06)", () => {
    const n = notifDaysAgo(3)
    const groups = groupByDate([n], NOW)
    expect(groups[0]!.label).toBe("Monday")
  })

  it("day 4 ago lands in the weekday name (Sunday for 2026-07-05)", () => {
    const n = notifDaysAgo(4)
    const groups = groupByDate([n], NOW)
    expect(groups[0]!.label).toBe("Sunday")
  })

  it("day 5 ago lands in the weekday name (Saturday for 2026-07-04)", () => {
    const n = notifDaysAgo(5)
    const groups = groupByDate([n], NOW)
    expect(groups[0]!.label).toBe("Saturday")
  })

  it("day 6 ago lands in the weekday name (Friday for 2026-07-03)", () => {
    const n = notifDaysAgo(6)
    const groups = groupByDate([n], NOW)
    expect(groups[0]!.label).toBe("Friday")
  })

  it("day 7 ago (Jul 2, same year) lands in 'Jul 2'", () => {
    const n = notifDaysAgo(7)
    const groups = groupByDate([n], NOW)
    expect(groups[0]!.label).toBe("Jul 2")
  })

  it("30 days ago (same year, Jun 9) lands in 'Jun 9'", () => {
    const n = notifDaysAgo(30)
    const groups = groupByDate([n], NOW)
    expect(groups[0]!.label).toBe("Jun 9")
  })

  it("prior-year item lands in 'MMM D, YYYY' format", () => {
    const d = new Date(2025, 11, 14, 12, 0, 0) // Dec 14, 2025
    const n = makeNotif(d)
    const groups = groupByDate([n], NOW)
    expect(groups[0]!.label).toBe("Dec 14, 2025")
  })

  it("empty input returns empty groups array", () => {
    const groups = groupByDate([], NOW)
    expect(groups).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Ordering — newest group first
// ---------------------------------------------------------------------------

describe("groupByDate — group ordering", () => {
  it("groups are ordered newest first (Today before Yesterday before older)", () => {
    const todayNotif = notifDaysAgo(0)
    const yesterdayNotif = notifDaysAgo(1)
    const tuesdayNotif = notifDaysAgo(2)
    const olderNotif = notifDaysAgo(7)

    // Input is already newest-first (mirrors query order)
    const groups = groupByDate([todayNotif, yesterdayNotif, tuesdayNotif, olderNotif], NOW)
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Tuesday", "Jul 2"])
  })

  it("items within a group maintain their input order", () => {
    const n1 = notifDaysAgo(0)
    const n2 = notifDaysAgo(0)
    const groups = groupByDate([n1, n2], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items[0]!.id).toBe(n1.id)
    expect(groups[0]!.items[1]!.id).toBe(n2.id)
  })

  it("multiple items on the same day land in the same group", () => {
    const a = notifDaysAgo(7, 10)
    const b = notifDaysAgo(7, 14)
    const groups = groupByDate([a, b], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe("Jul 2")
    expect(groups[0]!.items).toHaveLength(2)
  })

  it("prior-year group appears last when mixed with current-year items", () => {
    const today = notifDaysAgo(0)
    const old = makeNotif(new Date(2025, 11, 14, 12, 0, 0)) // Dec 14, 2025
    const groups = groupByDate([today, old], NOW)
    expect(groups[0]!.label).toBe("Today")
    expect(groups[1]!.label).toBe("Dec 14, 2025")
  })
})

// ---------------------------------------------------------------------------
// Return shape unchanged (backward-compat with callers)
// ---------------------------------------------------------------------------

describe("groupByDate — return shape", () => {
  it("returns { label: string, items: NotificationWithContact[] }[]", () => {
    const n = notifDaysAgo(0)
    const groups = groupByDate([n], NOW)
    expect(typeof groups[0]!.label).toBe("string")
    expect(Array.isArray(groups[0]!.items)).toBe(true)
    expect(groups[0]!.items[0]!.id).toBe(n.id)
  })

  it("no longer emits an 'Earlier this week' or 'Older' label", () => {
    const earlier = notifDaysAgo(4) // inside 7-day window but not today/yesterday
    const older = notifDaysAgo(30) // beyond 7 days
    const groups = groupByDate([earlier, older], NOW)
    const labels = groups.map((g) => g.label)
    expect(labels).not.toContain("Earlier this week")
    expect(labels).not.toContain("Older")
  })

  it("groupByDate with no injected `now` still runs (uses real clock, smoke test)", () => {
    // Just checking the default parameter doesn't throw
    const n = makeNotif(new Date())
    expect(() => groupByDate([n])).not.toThrow()
  })
})
