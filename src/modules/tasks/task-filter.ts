import { addDaysCivil } from "@/modules/tasks/task-due-state"
import { resolveMondaySundayWeek, resolveCurrentMonthRange } from "@/lib/format"

/**
 * Pure filter core for the HubSpot-style task filter strip (contact Tasks
 * pane, Mike-locked 2026-06-20). No React, no server-only, no DOM — so it
 * imports anywhere and unit-tests directly.
 *
 * REUSE (memory #12): the URL parse/serialize helpers, the date-range
 * resolver, the active-filter-pill descriptor, and the option constants are
 * deliberately decoupled from any task type so the upcoming contact Activity
 * feed filter strip can reuse the same shape. The matching function
 * (`applyTaskFilters`) is task-specific by nature (it reads task fields) and
 * takes a minimal structural `FilterableTask`, so it stays decoupled from the
 * full UI `ContactTaskItem`.
 *
 * Filter semantics (decision #8): OR within a single filter type (a value
 * list), AND across filter types. A task must satisfy every active type.
 *
 * Date comparison is lexicographic on YYYY-MM-DD strings (same discipline as
 * task-due-state / src/lib/format) — no Date parsing of stored values.
 */

// ─── Value vocabularies ────────────────────────────────────────────────

export type DuePreset =
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_week"
  | "this_month"
  | "last_month"
  | "custom"

const DUE_PRESETS: DuePreset[] = [
  "today",
  "tomorrow",
  "this_week",
  "next_week",
  "this_month",
  "last_month",
  "custom",
]

/** The "All time" dropdown's presets, in display order, with plain-English
 *  labels (per memory rule #2). "Custom" reveals the inline calendar. */
export const DUE_PRESET_OPTIONS: { value: DuePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "this_week", label: "This Week" },
  { value: "next_week", label: "Next Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "custom", label: "Custom" },
]

/** Display-label status values stored in the URL. The superset mapping to the
 *  backend enum (decision #5) lives in STATUS_LABEL_TO_BACKEND below. */
export type StatusFilterValue = "not_started" | "in_progress" | "done"

const STATUS_FILTER_VALUES: StatusFilterValue[] = ["not_started", "in_progress", "done"]

export const STATUS_FILTER_OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Completed" },
]

/**
 * Decision #5 (Mike-locked SUPERSET): from the user's perspective a task that
 * is blocked by dependencies, or unblocked-but-not-yet-started (`ready`), has
 * not been "started" — same bucket as `not_started`. `in_progress` and `done`
 * map literally. This only READS status for filtering; the dependency engine
 * and the enum are untouched.
 */
const STATUS_LABEL_TO_BACKEND: Record<StatusFilterValue, string[]> = {
  not_started: ["not_started", "blocked", "ready"],
  in_progress: ["in_progress"],
  done: ["done"],
}

/** Priority filter values — the three levels plus the "none" sentinel
 *  (priority IS NULL). The UI renders a divider before "none". */
export const PRIORITY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
]

/** Sentinel for the Event filter — tasks not linked to any event. */
export const EVENT_GENERAL = "general"
/** Sentinel for the Assigned-to filter — tasks with no assignee. */
export const ASSIGNEE_UNASSIGNED = "unassigned"

// ─── Filter state ──────────────────────────────────────────────────────

export interface TaskFilterState {
  /** Title search text (raw; matching trims + lowercases). */
  search: string
  /** Active "All time" preset, or null when the date filter is off. */
  due: DuePreset | null
  /** Custom range bounds — only meaningful when `due === "custom"`. */
  dueFrom: string | null
  dueTo: string | null
  /** projectIds + EVENT_GENERAL. */
  events: string[]
  /** Display-label statuses (mapped to backend via the superset table). */
  statuses: StatusFilterValue[]
  /** "high" | "medium" | "low" + "none". */
  priorities: string[]
  /** userIds + ASSIGNEE_UNASSIGNED. */
  assignees: string[]
  /** PM enhancement A — sort by priority instead of due date. */
  sortByPriority: boolean
}

export function emptyTaskFilterState(): TaskFilterState {
  return {
    search: "",
    due: null,
    dueFrom: null,
    dueTo: null,
    events: [],
    statuses: [],
    priorities: [],
    assignees: [],
    sortByPriority: false,
  }
}

/**
 * Whether any *filter* is active (decision #10 — if so, the pane switches to a
 * flat list). NOTE: `sortByPriority` is a SORT, not a filter — it reorders but
 * never collapses the Open/Completed sections, so it's excluded here.
 */
export function hasActiveFilters(s: TaskFilterState): boolean {
  return (
    s.search.trim() !== "" ||
    s.due !== null ||
    s.events.length > 0 ||
    s.statuses.length > 0 ||
    s.priorities.length > 0 ||
    s.assignees.length > 0
  )
}

// ─── URL parse / serialize ─────────────────────────────────────────────

// Minimal structural type so parse accepts both URLSearchParams and Next's
// ReadonlyURLSearchParams (from useSearchParams).
interface ParamsLike {
  get(name: string): string | null
}

function splitCsv(raw: string | null): string[] {
  return (raw ?? "").split(",").filter(Boolean)
}

function nullIfEmpty(raw: string | null): string | null {
  return raw !== null && raw !== "" ? raw : null
}

export function parseTaskFilters(params: ParamsLike): TaskFilterState {
  const dueRaw = params.get("due")
  const due = dueRaw && (DUE_PRESETS as string[]).includes(dueRaw) ? (dueRaw as DuePreset) : null
  const statuses = splitCsv(params.get("status")).filter((v): v is StatusFilterValue =>
    (STATUS_FILTER_VALUES as string[]).includes(v),
  )
  return {
    search: params.get("tq") ?? "",
    due,
    dueFrom: due === "custom" ? nullIfEmpty(params.get("dueFrom")) : null,
    dueTo: due === "custom" ? nullIfEmpty(params.get("dueTo")) : null,
    events: splitCsv(params.get("event")),
    statuses,
    priorities: splitCsv(params.get("priority")),
    assignees: splitCsv(params.get("assignee")),
    sortByPriority: params.get("sortByPri") === "1",
  }
}

/**
 * Clone `base` (preserving non-task params like `tab`) and set/delete the task
 * filter keys to reflect `state`. Empty values delete their key so the URL
 * stays clean and shareable.
 */
export function applyTaskFiltersToParams(
  base: URLSearchParams,
  state: TaskFilterState,
): URLSearchParams {
  const next = new URLSearchParams(base.toString())
  const setOrDelete = (key: string, value: string) => {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  setOrDelete("tq", state.search.trim())
  setOrDelete("due", state.due ?? "")
  // Custom bounds only persist while the custom preset is selected.
  setOrDelete("dueFrom", state.due === "custom" ? (state.dueFrom ?? "") : "")
  setOrDelete("dueTo", state.due === "custom" ? (state.dueTo ?? "") : "")
  setOrDelete("event", state.events.join(","))
  setOrDelete("status", state.statuses.join(","))
  setOrDelete("priority", state.priorities.join(","))
  setOrDelete("assignee", state.assignees.join(","))
  setOrDelete("sortByPri", state.sortByPriority ? "1" : "")
  return next
}

// ─── Date-range resolution ─────────────────────────────────────────────

export interface DueRange {
  /** Inclusive lower bound YYYY-MM-DD, or null for open-ended. */
  from: string | null
  /** Inclusive upper bound YYYY-MM-DD, or null for open-ended. */
  to: string | null
}

/**
 * Resolve a preset (+ custom bounds) into an inclusive [from, to] window
 * against the viewer's `today` (YYYY-MM-DD). "This Week"/"Next Week" use the
 * Mon–Sun ISO week (resolveMondaySundayWeek); months use
 * resolveCurrentMonthRange. Returns null bounds when unresolvable (e.g. a
 * custom range with no dates set → matches nothing date-wise; the caller
 * treats a fully-open custom range as "no date constraint").
 */
export function resolveDueRange(
  preset: DuePreset,
  custom: { dueFrom: string | null; dueTo: string | null },
  today: string,
): DueRange {
  switch (preset) {
    case "today":
      return { from: today, to: today }
    case "tomorrow": {
      const t = addDaysCivil(today, 1)
      return { from: t, to: t }
    }
    case "this_week": {
      const w = resolveMondaySundayWeek(today)
      return { from: w.startISO, to: w.endISO }
    }
    case "next_week": {
      const w = resolveMondaySundayWeek(addDaysCivil(today, 7))
      return { from: w.startISO, to: w.endISO }
    }
    case "this_month": {
      const m = resolveCurrentMonthRange(today)
      return { from: m.startISO, to: m.endISO }
    }
    case "last_month": {
      // First day of this month, minus one day, lands in the previous month;
      // resolveCurrentMonthRange then snaps to that month's first/last day.
      const firstOfThisMonth = `${today.slice(0, 7)}-01`
      const lastMonthAnchor = addDaysCivil(firstOfThisMonth, -1)
      const m = resolveCurrentMonthRange(lastMonthAnchor)
      return { from: m.startISO, to: m.endISO }
    }
    case "custom":
      return { from: custom.dueFrom, to: custom.dueTo }
  }
}

// ─── Matching ──────────────────────────────────────────────────────────

/** Minimal task shape the matcher needs — `ContactTaskItem` satisfies it. */
export interface FilterableTask {
  title: string
  dueDate: string | null
  status: string
  projectId: string | null
  priority: string | null
  assigneeUserId: string | null
}

function matchesDue(task: FilterableTask, state: TaskFilterState, today: string): boolean {
  if (!state.due) return true
  // Viewer's local date not resolved yet (pre-hydration) — don't constrain by
  // date this render; the client re-renders with the real `today`.
  if (!today) return true
  const range = resolveDueRange(state.due, state, today)
  // A fully-open custom range imposes no date constraint.
  if (!range.from && !range.to) return true
  // A task with no due date can't fall inside a date window.
  const d = task.dueDate?.slice(0, 10) ?? null
  if (!d) return false
  if (range.from && d < range.from) return false
  if (range.to && d > range.to) return false
  return true
}

export function applyTaskFilters<T extends FilterableTask>(
  tasks: T[],
  state: TaskFilterState,
  today: string,
): T[] {
  const search = state.search.trim().toLowerCase()
  const statusBackend = new Set(state.statuses.flatMap((s) => STATUS_LABEL_TO_BACKEND[s]))
  return tasks.filter((t) => {
    if (search && !t.title.toLowerCase().includes(search)) return false
    if (!matchesDue(t, state, today)) return false
    if (
      state.events.length > 0 &&
      !state.events.some((e) => (e === EVENT_GENERAL ? t.projectId === null : t.projectId === e))
    ) {
      return false
    }
    if (state.statuses.length > 0 && !statusBackend.has(t.status)) return false
    if (
      state.priorities.length > 0 &&
      !state.priorities.some((p) => (p === "none" ? t.priority === null : t.priority === p))
    ) {
      return false
    }
    if (
      state.assignees.length > 0 &&
      !state.assignees.some((a) =>
        a === ASSIGNEE_UNASSIGNED ? t.assigneeUserId === null : t.assigneeUserId === a,
      )
    ) {
      return false
    }
    return true
  })
}

// ─── Sorting (PM enhancement A) ────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

function priorityRank(priority: string | null): number {
  // No priority (or any unexpected value) sorts last.
  const rank = priority !== null ? PRIORITY_RANK[priority] : undefined
  return rank ?? 3
}

/** Due date ascending, nulls last. Lexicographic on YYYY-MM-DD. */
function compareDueAsc(a: FilterableTask, b: FilterableTask): number {
  const ad = a.dueDate?.slice(0, 10) ?? null
  const bd = b.dueDate?.slice(0, 10) ?? null
  if (ad === bd) return 0
  if (ad === null) return 1
  if (bd === null) return -1
  return ad < bd ? -1 : 1
}

/** Sort a copy of the open tasks: by priority (High→…→none, due as tie-break)
 *  when `sortByPriority`, else by due date. */
export function sortOpenTasks<T extends FilterableTask>(tasks: T[], sortByPriority: boolean): T[] {
  const copy = [...tasks]
  if (!sortByPriority) {
    copy.sort(compareDueAsc)
    return copy
  }
  copy.sort((a, b) => {
    const r = priorityRank(a.priority) - priorityRank(b.priority)
    return r !== 0 ? r : compareDueAsc(a, b)
  })
  return copy
}

interface CompletableTask extends FilterableTask {
  completedAt: string | null
}

/** Sort a copy of the completed tasks: by completion date (most recent first)
 *  when `sortByPriority` (priority is irrelevant for done work, per decision
 *  #12A), else by due date. */
export function sortCompletedTasks<T extends CompletableTask>(
  tasks: T[],
  sortByPriority: boolean,
): T[] {
  const copy = [...tasks]
  if (!sortByPriority) {
    copy.sort(compareDueAsc)
    return copy
  }
  copy.sort((a, b) => {
    const ac = a.completedAt
    const bc = b.completedAt
    if (ac === bc) return 0
    if (ac === null) return 1
    if (bc === null) return -1
    return ac < bc ? 1 : -1 // desc — most recent first
  })
  return copy
}

// ─── Active-filter pills (PM enhancement B) ────────────────────────────

export type PillFilterType = "due" | "event" | "status" | "priority" | "assignee"

export interface FilterPill {
  /** Which filter type this pill belongs to. */
  filterType: PillFilterType
  /** The value to remove from that filter type (for `due`, the preset). */
  value: string
  /** Plain-English pill text, e.g. "All time: This Week". */
  label: string
}

/** Display prefixes per dropdown (decision #12B pill format). */
const PILL_PREFIX: Record<PillFilterType, string> = {
  due: "All time",
  event: "Event",
  status: "Task status",
  priority: "Priority",
  assignee: "Assigned to",
}

export interface PillLookups {
  /** Resolve a projectId to its event name (EVENT_GENERAL → "General"). */
  eventLabel: (value: string) => string
  /** Resolve a userId to a member name (ASSIGNEE_UNASSIGNED → "Unassigned"). */
  assigneeLabel: (value: string) => string
  /** Format a YYYY-MM-DD date for the custom-range pill (existing formatDate). */
  formatDate: (ymd: string) => string
}

function duePillLabel(state: TaskFilterState, lookups: PillLookups): string {
  if (state.due === "custom") {
    const from = state.dueFrom ? lookups.formatDate(state.dueFrom) : "…"
    const to = state.dueTo ? lookups.formatDate(state.dueTo) : "…"
    return `${PILL_PREFIX.due}: ${from}–${to}`
  }
  const opt = DUE_PRESET_OPTIONS.find((o) => o.value === state.due)
  return `${PILL_PREFIX.due}: ${opt?.label ?? String(state.due)}`
}

/**
 * One pill per removable unit (one per selected value in multi-selects, one
 * for the whole date filter). Search is NOT a pill — it has its own clearable
 * input (HubSpot pattern). Order matches the dropdown order.
 */
export function activeFilterPills(state: TaskFilterState, lookups: PillLookups): FilterPill[] {
  const pills: FilterPill[] = []
  if (state.due) {
    pills.push({ filterType: "due", value: state.due, label: duePillLabel(state, lookups) })
  }
  for (const e of state.events) {
    pills.push({
      filterType: "event",
      value: e,
      label: `${PILL_PREFIX.event}: ${lookups.eventLabel(e)}`,
    })
  }
  for (const s of state.statuses) {
    const opt = STATUS_FILTER_OPTIONS.find((o) => o.value === s)
    pills.push({
      filterType: "status",
      value: s,
      label: `${PILL_PREFIX.status}: ${opt?.label ?? s}`,
    })
  }
  for (const p of state.priorities) {
    const opt = PRIORITY_FILTER_OPTIONS.find((o) => o.value === p)
    pills.push({
      filterType: "priority",
      value: p,
      label: `${PILL_PREFIX.priority}: ${opt?.label ?? p}`,
    })
  }
  for (const a of state.assignees) {
    pills.push({
      filterType: "assignee",
      value: a,
      label: `${PILL_PREFIX.assignee}: ${lookups.assigneeLabel(a)}`,
    })
  }
  return pills
}

/** Remove a single value from a filter type (pill ✕). For `due` this clears
 *  the whole date filter (preset + custom bounds). Returns a new state. */
export function removeFilterValue(
  state: TaskFilterState,
  filterType: PillFilterType,
  value: string,
): TaskFilterState {
  switch (filterType) {
    case "due":
      return { ...state, due: null, dueFrom: null, dueTo: null }
    case "event":
      return { ...state, events: state.events.filter((v) => v !== value) }
    case "status":
      return { ...state, statuses: state.statuses.filter((v) => v !== value) }
    case "priority":
      return { ...state, priorities: state.priorities.filter((v) => v !== value) }
    case "assignee":
      return { ...state, assignees: state.assignees.filter((v) => v !== value) }
  }
}

/** Clear all FILTERS (decision #12C) but preserve the sort toggle — Clear all
 *  returns to the default sectioned view; it isn't a sort reset. */
export function clearAllFilters(state: TaskFilterState): TaskFilterState {
  return { ...emptyTaskFilterState(), sortByPriority: state.sortByPriority }
}
