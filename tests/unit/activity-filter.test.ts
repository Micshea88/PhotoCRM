/**
 * Unit tests for the pure Activity-feed filter core (Mike-locked 2026-06-21):
 * a-prefix URL round-trips, the Past/Present/Future date presets (Mon–Sun
 * weeks + month rollover), tab-as-type matching, search (incl. subject),
 * event/owner sentinels, direction/outcome, and pills/remove/clear.
 */
import { describe, it, expect } from "vitest"
import {
  parseActivityFilters,
  applyActivityFiltersToParams,
  emptyActivityFilterState,
  hasActiveFilters,
  resolveActivityDateRange,
  applyActivityFilters,
  activeFilterPills,
  removeFilterValue,
  clearAllFilters,
  EVENT_NONE,
  OWNER_UNASSIGNED,
  type ActivityFilterState,
  type FilterableActivity,
} from "@/modules/contacts/ui/activity-filter"

const TODAY = "2026-06-20" // Saturday

function entry(overrides: Partial<FilterableActivity> = {}): FilterableActivity {
  return {
    kind: "note",
    title: "Activity",
    subject: null,
    body: null,
    actor: null,
    actorUserId: null,
    direction: null,
    outcome: null,
    projectId: null,
    timestamp: new Date(2026, 5, 20, 12, 0, 0), // local 2026-06-20 noon
    ...overrides,
  }
}

describe("parse / serialize round-trip", () => {
  it("empty params → empty state", () => {
    expect(parseActivityFilters(new URLSearchParams())).toEqual(emptyActivityFilterState())
  })

  it("round-trips a fully-populated state", () => {
    const state: ActivityFilterState = {
      tab: "call",
      search: "venue",
      due: "custom",
      dueFrom: "2026-06-01",
      dueTo: "2026-06-30",
      events: ["proj_a", EVENT_NONE],
      owners: ["u1", OWNER_UNASSIGNED],
      directions: ["incoming", "outgoing"],
      outcomes: ["completed"],
      thread: true,
    }
    const params = applyActivityFiltersToParams(new URLSearchParams(), state)
    expect(parseActivityFilters(params)).toEqual(state)
  })

  it("omits the default 'all' tab from the URL but preserves other tabs", () => {
    const allParams = applyActivityFiltersToParams(
      new URLSearchParams(),
      emptyActivityFilterState(),
    )
    expect(allParams.get("atab")).toBeNull()
    const callParams = applyActivityFiltersToParams(new URLSearchParams(), {
      ...emptyActivityFilterState(),
      tab: "call",
    })
    expect(callParams.get("atab")).toBe("call")
  })

  it("preserves unrelated params (contact tab + task filters)", () => {
    const base = new URLSearchParams("tab=activity&status=done")
    const params = applyActivityFiltersToParams(base, {
      ...emptyActivityFilterState(),
      search: "x",
    })
    expect(params.get("tab")).toBe("activity")
    expect(params.get("status")).toBe("done")
    expect(params.get("aq")).toBe("x")
  })

  it("ignores unknown tab + date values", () => {
    const s = parseActivityFilters(new URLSearchParams("atab=bogus&adate=fortnight"))
    expect(s.tab).toBe("all")
    expect(s.due).toBeNull()
  })
})

describe("hasActiveFilters", () => {
  it("false for empty, tab-only, and thread-only", () => {
    expect(hasActiveFilters(emptyActivityFilterState())).toBe(false)
    expect(hasActiveFilters({ ...emptyActivityFilterState(), tab: "call" })).toBe(false)
    expect(hasActiveFilters({ ...emptyActivityFilterState(), thread: true })).toBe(false)
  })
  it("true when any row filter is set", () => {
    expect(hasActiveFilters({ ...emptyActivityFilterState(), owners: ["u1"] })).toBe(true)
    expect(hasActiveFilters({ ...emptyActivityFilterState(), directions: ["inbound"] })).toBe(true)
  })
})

describe("resolveActivityDateRange", () => {
  const noCustom = { dueFrom: null, dueTo: null }
  it("past presets", () => {
    expect(resolveActivityDateRange("yesterday", noCustom, TODAY)).toEqual({
      from: "2026-06-19",
      to: "2026-06-19",
    })
    expect(resolveActivityDateRange("last_week", noCustom, TODAY)).toEqual({
      from: "2026-06-08",
      to: "2026-06-14",
    })
    expect(resolveActivityDateRange("last_month", noCustom, TODAY)).toEqual({
      from: "2026-05-01",
      to: "2026-05-31",
    })
  })
  it("present presets", () => {
    expect(resolveActivityDateRange("today", noCustom, TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(resolveActivityDateRange("this_week", noCustom, TODAY)).toEqual({
      from: "2026-06-15",
      to: "2026-06-21",
    })
    expect(resolveActivityDateRange("this_month", noCustom, TODAY)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    })
  })
  it("future presets", () => {
    expect(resolveActivityDateRange("tomorrow", noCustom, TODAY)).toEqual({
      from: "2026-06-21",
      to: "2026-06-21",
    })
    expect(resolveActivityDateRange("next_week", noCustom, TODAY)).toEqual({
      from: "2026-06-22",
      to: "2026-06-28",
    })
  })
  it("custom passes bounds through", () => {
    expect(
      resolveActivityDateRange("custom", { dueFrom: "2026-01-01", dueTo: "2026-01-31" }, TODAY),
    ).toEqual({ from: "2026-01-01", to: "2026-01-31" })
  })
})

describe("applyActivityFilters", () => {
  it("tab acts as the type filter; 'all' shows everything", () => {
    const entries = [entry({ kind: "note" }), entry({ kind: "call" }), entry({ kind: "email" })]
    expect(applyActivityFilters(entries, emptyActivityFilterState(), TODAY)).toHaveLength(3)
    expect(
      applyActivityFilters(entries, { ...emptyActivityFilterState(), tab: "call" }, TODAY),
    ).toHaveLength(1)
  })

  it("search matches title, subject, body, and actor (case-insensitive)", () => {
    const entries = [
      entry({ title: "Email", subject: "Wedding contract" }),
      entry({ title: "Note added", body: "called the florist" }),
      entry({ title: "Note added", actor: "Kelly Stone" }),
      entry({ title: "Note added" }),
    ]
    expect(
      applyActivityFilters(entries, { ...emptyActivityFilterState(), search: "contract" }, TODAY),
    ).toHaveLength(1)
    expect(
      applyActivityFilters(entries, { ...emptyActivityFilterState(), search: "florist" }, TODAY),
    ).toHaveLength(1)
    expect(
      applyActivityFilters(entries, { ...emptyActivityFilterState(), search: "kelly" }, TODAY),
    ).toHaveLength(1)
  })

  it("date filter buckets by the entry's local day; pre-hydration empty today is inactive", () => {
    const entries = [
      entry({ timestamp: new Date(2026, 5, 20, 9) }), // today
      entry({ timestamp: new Date(2026, 5, 18, 9) }), // earlier this week
    ]
    expect(
      applyActivityFilters(entries, { ...emptyActivityFilterState(), due: "today" }, TODAY),
    ).toHaveLength(1)
    expect(
      applyActivityFilters(entries, { ...emptyActivityFilterState(), due: "today" }, ""),
    ).toHaveLength(2)
  })

  it("event filter: NONE sentinel matches no-event; ids match exactly (OR within)", () => {
    const entries = [
      entry({ projectId: null }),
      entry({ projectId: "p1" }),
      entry({ projectId: "p2" }),
    ]
    expect(
      applyActivityFilters(entries, { ...emptyActivityFilterState(), events: [EVENT_NONE] }, TODAY),
    ).toHaveLength(1)
    expect(
      applyActivityFilters(
        entries,
        { ...emptyActivityFilterState(), events: [EVENT_NONE, "p1"] },
        TODAY,
      ),
    ).toHaveLength(2)
  })

  it("owner filter: UNASSIGNED sentinel matches null actor", () => {
    const entries = [entry({ actorUserId: "u1" }), entry({ actorUserId: null })]
    expect(
      applyActivityFilters(
        entries,
        { ...emptyActivityFilterState(), owners: [OWNER_UNASSIGNED] },
        TODAY,
      ),
    ).toHaveLength(1)
    expect(
      applyActivityFilters(entries, { ...emptyActivityFilterState(), owners: ["u1"] }, TODAY),
    ).toHaveLength(1)
  })

  it("direction + outcome filter, and exclude entries lacking the field when active", () => {
    const entries = [
      entry({ kind: "call", direction: "incoming", outcome: "completed" }),
      entry({ kind: "call", direction: "outgoing", outcome: "no_answer" }),
      entry({ kind: "note", direction: null, outcome: null }),
    ]
    expect(
      applyActivityFilters(
        entries,
        { ...emptyActivityFilterState(), directions: ["incoming"] },
        TODAY,
      ),
    ).toHaveLength(1)
    expect(
      applyActivityFilters(
        entries,
        { ...emptyActivityFilterState(), outcomes: ["no_answer"] },
        TODAY,
      ),
    ).toHaveLength(1)
    // a directionless note is excluded while a direction filter is active
    expect(
      applyActivityFilters(
        entries,
        { ...emptyActivityFilterState(), directions: ["incoming", "outgoing"] },
        TODAY,
      ),
    ).toHaveLength(2)
  })

  it("AND across filter types", () => {
    const entries = [
      entry({ kind: "call", direction: "incoming", actorUserId: "u1" }),
      entry({ kind: "call", direction: "incoming", actorUserId: "u2" }),
    ]
    expect(
      applyActivityFilters(
        entries,
        { ...emptyActivityFilterState(), tab: "call", directions: ["incoming"], owners: ["u1"] },
        TODAY,
      ),
    ).toHaveLength(1)
  })
})

describe("pills / remove / clear", () => {
  const lookups = {
    eventLabel: (v: string) => (v === EVENT_NONE ? "No event" : `Event ${v}`),
    ownerLabel: (v: string) => (v === OWNER_UNASSIGNED ? "Unassigned" : `User ${v}`),
    directionLabel: (v: string) => v,
    outcomeLabel: (v: string) => v,
    formatDate: (ymd: string) => ymd,
  }

  it("one pill per removable value; search + thread excluded", () => {
    const state: ActivityFilterState = {
      ...emptyActivityFilterState(),
      search: "ignored",
      thread: true,
      due: "this_week",
      events: ["p1"],
      owners: [OWNER_UNASSIGNED],
      directions: ["inbound"],
      outcomes: ["completed"],
    }
    expect(activeFilterPills(state, lookups).map((p) => p.label)).toEqual([
      "All time: This Week",
      "Event: Event p1",
      "Assigned to: Unassigned",
      "Direction: inbound",
      "Outcome: completed",
    ])
  })

  it("removeFilterValue removes one; due clears the whole date filter", () => {
    const s = { ...emptyActivityFilterState(), owners: ["u1", "u2"] }
    expect(removeFilterValue(s, "owner", "u1").owners).toEqual(["u2"])
    const ds = {
      ...emptyActivityFilterState(),
      due: "custom" as const,
      dueFrom: "2026-06-01",
      dueTo: "2026-06-30",
    }
    const cleared = removeFilterValue(ds, "due", "custom")
    expect(cleared.due).toBeNull()
    expect(cleared.dueFrom).toBeNull()
  })

  it("clearAllFilters clears filters but preserves tab + thread", () => {
    const state: ActivityFilterState = {
      ...emptyActivityFilterState(),
      tab: "email",
      thread: true,
      search: "x",
      directions: ["inbound"],
    }
    const cleared = clearAllFilters(state)
    expect(hasActiveFilters(cleared)).toBe(false)
    expect(cleared.tab).toBe("email")
    expect(cleared.thread).toBe(true)
  })
})
