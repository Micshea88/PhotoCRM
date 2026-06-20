/**
 * Unit tests for the pure task filter core (Mike-locked 2026-06-20). Covers
 * URL parse/serialize round-trips, date-range resolution (Mon–Sun weeks +
 * month rollover), matching (OR within / AND across, status superset, null
 * sentinels), sorting (PM-A), and the pill/remove/clear helpers (PM-B/C).
 */
import { describe, it, expect } from "vitest"
import {
  parseTaskFilters,
  applyTaskFiltersToParams,
  emptyTaskFilterState,
  hasActiveFilters,
  resolveDueRange,
  applyTaskFilters,
  sortOpenTasks,
  sortCompletedTasks,
  activeFilterPills,
  removeFilterValue,
  clearAllFilters,
  EVENT_GENERAL,
  ASSIGNEE_UNASSIGNED,
  type TaskFilterState,
  type FilterableTask,
} from "@/modules/tasks/task-filter"

const TODAY = "2026-06-20" // a Saturday

function task(overrides: Partial<FilterableTask & { completedAt: string | null }> = {}) {
  return {
    title: "Task",
    dueDate: null,
    status: "not_started",
    projectId: null,
    priority: null,
    assigneeUserId: null,
    completedAt: null,
    ...overrides,
  }
}

describe("parseTaskFilters / applyTaskFiltersToParams round-trip", () => {
  it("parses an empty param set to the empty state", () => {
    expect(parseTaskFilters(new URLSearchParams())).toEqual(emptyTaskFilterState())
  })

  it("round-trips a fully-populated state", () => {
    const state: TaskFilterState = {
      search: "contract",
      due: "custom",
      dueFrom: "2026-06-15",
      dueTo: "2026-06-30",
      events: ["proj_a", EVENT_GENERAL],
      statuses: ["in_progress", "done"],
      priorities: ["high", "none"],
      assignees: ["usr_1", ASSIGNEE_UNASSIGNED],
      sortByPriority: true,
    }
    const params = applyTaskFiltersToParams(new URLSearchParams(), state)
    expect(parseTaskFilters(params)).toEqual(state)
  })

  it("preserves unrelated params like tab", () => {
    const base = new URLSearchParams("tab=tasks")
    const params = applyTaskFiltersToParams(base, { ...emptyTaskFilterState(), search: "x" })
    expect(params.get("tab")).toBe("tasks")
    expect(params.get("tq")).toBe("x")
  })

  it("deletes empty keys (clean shareable URL)", () => {
    const params = applyTaskFiltersToParams(
      new URLSearchParams("tq=old&status=done&sortByPri=1"),
      emptyTaskFilterState(),
    )
    expect(params.toString()).toBe("")
  })

  it("drops custom bounds when preset is not custom", () => {
    const params = applyTaskFiltersToParams(new URLSearchParams(), {
      ...emptyTaskFilterState(),
      due: "this_week",
      dueFrom: "2026-06-15",
      dueTo: "2026-06-30",
    })
    expect(params.get("dueFrom")).toBeNull()
    expect(params.get("dueTo")).toBeNull()
    expect(params.get("due")).toBe("this_week")
  })

  it("ignores unknown due + status values", () => {
    const s = parseTaskFilters(new URLSearchParams("due=fortnight&status=done,bogus"))
    expect(s.due).toBeNull()
    expect(s.statuses).toEqual(["done"])
  })
})

describe("hasActiveFilters", () => {
  it("is false for empty state and for sort-only", () => {
    expect(hasActiveFilters(emptyTaskFilterState())).toBe(false)
    expect(hasActiveFilters({ ...emptyTaskFilterState(), sortByPriority: true })).toBe(false)
  })

  it("is true when any filter type is set", () => {
    expect(hasActiveFilters({ ...emptyTaskFilterState(), search: "a" })).toBe(true)
    expect(hasActiveFilters({ ...emptyTaskFilterState(), due: "today" })).toBe(true)
    expect(hasActiveFilters({ ...emptyTaskFilterState(), statuses: ["done"] })).toBe(true)
  })
})

describe("resolveDueRange", () => {
  const noCustom = { dueFrom: null, dueTo: null }

  it("today / tomorrow", () => {
    expect(resolveDueRange("today", noCustom, TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(resolveDueRange("tomorrow", noCustom, TODAY)).toEqual({
      from: "2026-06-21",
      to: "2026-06-21",
    })
  })

  it("this week is the Mon–Sun ISO week containing today", () => {
    // 2026-06-20 is a Saturday → week is Mon 06-15 … Sun 06-21.
    expect(resolveDueRange("this_week", noCustom, TODAY)).toEqual({
      from: "2026-06-15",
      to: "2026-06-21",
    })
  })

  it("next week is the following Mon–Sun", () => {
    expect(resolveDueRange("next_week", noCustom, TODAY)).toEqual({
      from: "2026-06-22",
      to: "2026-06-28",
    })
  })

  it("this month / last month (with rollover)", () => {
    expect(resolveDueRange("this_month", noCustom, TODAY)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    })
    expect(resolveDueRange("last_month", noCustom, TODAY)).toEqual({
      from: "2026-05-01",
      to: "2026-05-31",
    })
  })

  it("last month handles a January→December year rollover", () => {
    expect(resolveDueRange("last_month", noCustom, "2026-01-10")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    })
  })

  it("custom passes the bounds through", () => {
    expect(
      resolveDueRange("custom", { dueFrom: "2026-06-01", dueTo: "2026-06-10" }, TODAY),
    ).toEqual({ from: "2026-06-01", to: "2026-06-10" })
  })
})

describe("applyTaskFilters — matching", () => {
  it("search matches title case-insensitively", () => {
    const tasks = [task({ title: "Send Contract" }), task({ title: "Edit photos" })]
    const out = applyTaskFilters(tasks, { ...emptyTaskFilterState(), search: "contract" }, TODAY)
    expect(out).toHaveLength(1)
    expect(out[0]?.title).toBe("Send Contract")
  })

  it("status superset: 'Not started' matches not_started + blocked + ready", () => {
    const tasks = [
      task({ status: "not_started" }),
      task({ status: "blocked" }),
      task({ status: "ready" }),
      task({ status: "in_progress" }),
      task({ status: "done" }),
    ]
    const out = applyTaskFilters(
      tasks,
      { ...emptyTaskFilterState(), statuses: ["not_started"] },
      TODAY,
    )
    expect(out.map((t) => t.status)).toEqual(["not_started", "blocked", "ready"])
  })

  it("status 'In progress' and 'Completed' map literally", () => {
    const tasks = [
      task({ status: "in_progress" }),
      task({ status: "ready" }),
      task({ status: "done" }),
    ]
    expect(
      applyTaskFilters(tasks, { ...emptyTaskFilterState(), statuses: ["in_progress"] }, TODAY),
    ).toHaveLength(1)
    expect(
      applyTaskFilters(tasks, { ...emptyTaskFilterState(), statuses: ["done"] }, TODAY),
    ).toHaveLength(1)
  })

  it("event filter: General sentinel matches null projectId; ids match exactly", () => {
    const tasks = [task({ projectId: null }), task({ projectId: "p1" }), task({ projectId: "p2" })]
    expect(
      applyTaskFilters(tasks, { ...emptyTaskFilterState(), events: [EVENT_GENERAL] }, TODAY),
    ).toHaveLength(1)
    const both = applyTaskFilters(
      tasks,
      { ...emptyTaskFilterState(), events: [EVENT_GENERAL, "p1"] },
      TODAY,
    )
    expect(both).toHaveLength(2) // OR within the filter
  })

  it("priority 'none' sentinel matches null priority", () => {
    const tasks = [task({ priority: "high" }), task({ priority: null })]
    expect(
      applyTaskFilters(tasks, { ...emptyTaskFilterState(), priorities: ["none"] }, TODAY),
    ).toHaveLength(1)
  })

  it("assignee 'unassigned' sentinel matches null assignee", () => {
    const tasks = [task({ assigneeUserId: "u1" }), task({ assigneeUserId: null })]
    expect(
      applyTaskFilters(
        tasks,
        { ...emptyTaskFilterState(), assignees: [ASSIGNEE_UNASSIGNED] },
        TODAY,
      ),
    ).toHaveLength(1)
  })

  it("a due filter excludes tasks with no due date", () => {
    const tasks = [task({ dueDate: "2026-06-20" }), task({ dueDate: null })]
    expect(
      applyTaskFilters(tasks, { ...emptyTaskFilterState(), due: "today" }, TODAY),
    ).toHaveLength(1)
  })

  it("AND across filter types", () => {
    const tasks = [
      task({ title: "A", priority: "high", assigneeUserId: "u1" }),
      task({ title: "B", priority: "high", assigneeUserId: "u2" }),
      task({ title: "C", priority: "low", assigneeUserId: "u1" }),
    ]
    const out = applyTaskFilters(
      tasks,
      { ...emptyTaskFilterState(), priorities: ["high"], assignees: ["u1"] },
      TODAY,
    )
    expect(out.map((t) => t.title)).toEqual(["A"])
  })

  it("a date filter is inactive until today is known (pre-hydration empty today)", () => {
    const tasks = [task({ dueDate: "2020-01-01" }), task({ dueDate: null })]
    const out = applyTaskFilters(tasks, { ...emptyTaskFilterState(), due: "this_week" }, "")
    expect(out).toHaveLength(2) // no date constraint applied yet
  })

  it("a fully-open custom range imposes no date constraint", () => {
    const tasks = [task({ dueDate: null }), task({ dueDate: "2026-06-20" })]
    const out = applyTaskFilters(
      tasks,
      { ...emptyTaskFilterState(), due: "custom", dueFrom: null, dueTo: null },
      TODAY,
    )
    expect(out).toHaveLength(2)
  })
})

describe("sorting (PM enhancement A)", () => {
  it("open: due-date ascending (nulls last) when sort off", () => {
    const tasks = [
      task({ title: "late", dueDate: "2026-06-25" }),
      task({ title: "none", dueDate: null }),
      task({ title: "soon", dueDate: "2026-06-21" }),
    ]
    expect(sortOpenTasks(tasks, false).map((t) => t.title)).toEqual(["soon", "late", "none"])
  })

  it("open: priority High→Med→Low→none (due tie-break) when sort on", () => {
    const tasks = [
      task({ title: "lowOld", priority: "low", dueDate: "2026-06-21" }),
      task({ title: "none", priority: null, dueDate: "2026-06-21" }),
      task({ title: "highLate", priority: "high", dueDate: "2026-06-30" }),
      task({ title: "highSoon", priority: "high", dueDate: "2026-06-22" }),
      task({ title: "med", priority: "medium", dueDate: "2026-06-21" }),
    ]
    expect(sortOpenTasks(tasks, true).map((t) => t.title)).toEqual([
      "highSoon",
      "highLate",
      "med",
      "lowOld",
      "none",
    ])
  })

  it("completed: completion date desc when sort on, due asc when off", () => {
    const tasks = [
      task({ title: "old", completedAt: "2026-06-01T10:00:00Z", dueDate: "2026-06-02" }),
      task({ title: "new", completedAt: "2026-06-10T10:00:00Z", dueDate: "2026-06-01" }),
    ]
    expect(sortCompletedTasks(tasks, true).map((t) => t.title)).toEqual(["new", "old"])
    expect(sortCompletedTasks(tasks, false).map((t) => t.title)).toEqual(["new", "old"]) // due: 06-01 then 06-02
  })

  it("sorting does not mutate the input array", () => {
    const tasks = [
      task({ title: "b", dueDate: "2026-06-25" }),
      task({ title: "a", dueDate: "2026-06-21" }),
    ]
    const snapshot = tasks.map((t) => t.title)
    sortOpenTasks(tasks, false)
    expect(tasks.map((t) => t.title)).toEqual(snapshot)
  })
})

describe("pills / remove / clear (PM enhancements B + C)", () => {
  const lookups = {
    eventLabel: (v: string) => (v === EVENT_GENERAL ? "General" : `Event ${v}`),
    assigneeLabel: (v: string) => (v === ASSIGNEE_UNASSIGNED ? "Unassigned" : `User ${v}`),
    formatDate: (ymd: string) => ymd, // identity for test
  }

  it("builds one pill per removable unit, search excluded", () => {
    const state: TaskFilterState = {
      ...emptyTaskFilterState(),
      search: "ignored",
      due: "this_week",
      events: [EVENT_GENERAL, "p1"],
      statuses: ["in_progress"],
      priorities: ["none"],
      assignees: ["u1"],
    }
    const pills = activeFilterPills(state, lookups)
    expect(pills.map((p) => p.label)).toEqual([
      "All time: This Week",
      "Event: General",
      "Event: Event p1",
      "Task status: In progress",
      "Priority: No priority",
      "Assigned to: User u1",
    ])
  })

  it("custom-range pill shows the formatted bounds", () => {
    const state = {
      ...emptyTaskFilterState(),
      due: "custom" as const,
      dueFrom: "2026-06-15",
      dueTo: "2026-06-30",
    }
    expect(activeFilterPills(state, lookups)[0]?.label).toBe("All time: 2026-06-15–2026-06-30")
  })

  it("removeFilterValue removes one value; due clears the whole date filter", () => {
    const state = { ...emptyTaskFilterState(), events: ["p1", "p2"] }
    expect(removeFilterValue(state, "event", "p1").events).toEqual(["p2"])

    const dueState = {
      ...emptyTaskFilterState(),
      due: "custom" as const,
      dueFrom: "2026-06-15",
      dueTo: "2026-06-30",
    }
    const cleared = removeFilterValue(dueState, "due", "custom")
    expect(cleared.due).toBeNull()
    expect(cleared.dueFrom).toBeNull()
    expect(cleared.dueTo).toBeNull()
  })

  it("clearAllFilters clears filters but preserves the sort toggle", () => {
    const state: TaskFilterState = {
      ...emptyTaskFilterState(),
      search: "x",
      statuses: ["done"],
      sortByPriority: true,
    }
    const cleared = clearAllFilters(state)
    expect(hasActiveFilters(cleared)).toBe(false)
    expect(cleared.sortByPriority).toBe(true)
  })
})
