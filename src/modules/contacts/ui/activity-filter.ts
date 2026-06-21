import { addDaysCivil } from "@/modules/tasks/task-due-state"
import { resolveMondaySundayWeek, resolveCurrentMonthRange } from "@/lib/format"

/**
 * Pure filter core for the contact Activity-feed filter strip (memory #12,
 * Mike-locked 2026-06-21). No React / no server-only / no DOM — imports
 * anywhere and unit-tests directly. Sibling to `task-filter.ts`; reuses the
 * same generic UI primitives at the component layer (Commit 2).
 *
 * TABS ARE THE TYPE FILTER (Mike's explicit correction) — there is NO Type
 * dropdown. `state.tab` ("all" shows every kind; otherwise one kind).
 *
 * Per-tab dropdowns: All time (date) + Event + Activity-assigned-to on every
 * tab; Direction on Call/Email/SMS; Outcome on Call/Meeting; a "Thread
 * replies" view toggle on Email (grouping, Commit 3 — not a row filter).
 *
 * Semantics match Tasks: OR within a filter type, AND across types. Date
 * comparison is lexicographic on YYYY-MM-DD (timestamps converted to the
 * viewer's LOCAL civil date so buckets line up with `useToday`).
 */

// ─── Vocabularies ──────────────────────────────────────────────────────

export type ActivityTab = "all" | "note" | "call" | "email" | "sms" | "meeting"
const ACTIVITY_TABS: ActivityTab[] = ["all", "note", "call", "email", "sms", "meeting"]

export type ActivityDuePreset =
  | "yesterday"
  | "last_week"
  | "last_month"
  | "today"
  | "this_week"
  | "this_month"
  | "tomorrow"
  | "next_week"
  | "custom"

const ACTIVITY_DUE_PRESETS: ActivityDuePreset[] = [
  "yesterday",
  "last_week",
  "last_month",
  "today",
  "this_week",
  "this_month",
  "tomorrow",
  "next_week",
  "custom",
]

/** "All time" dropdown options, grouped Past / Present / Future / Custom with a
 *  divider before each group after the first (Mike-locked order). */
export const ACTIVITY_DUE_PRESET_OPTIONS: {
  value: ActivityDuePreset
  label: string
  dividerBefore?: boolean
}[] = [
  { value: "yesterday", label: "Yesterday" },
  { value: "last_week", label: "Last Week" },
  { value: "last_month", label: "Last Month" },
  { value: "today", label: "Today", dividerBefore: true },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "tomorrow", label: "Tomorrow", dividerBefore: true },
  { value: "next_week", label: "Next Week" },
  { value: "custom", label: "Custom", dividerBefore: true },
]

/** Event filter sentinel — activities not linked to any event. */
export const EVENT_NONE = "none"
/** Owner filter sentinel — activities with no internal owner (e.g. inbound
 *  calls/SMS/email with no team member attributed). */
export const OWNER_UNASSIGNED = "unassigned"

// ─── Filter state ──────────────────────────────────────────────────────

export interface ActivityFilterState {
  /** Active tab — the type filter. */
  tab: ActivityTab
  /** Title/subject/body/actor search text. */
  search: string
  due: ActivityDuePreset | null
  dueFrom: string | null
  dueTo: string | null
  /** projectIds + EVENT_NONE. */
  events: string[]
  /** actor userIds + OWNER_UNASSIGNED. */
  owners: string[]
  /** Direction values (call: incoming/outgoing/missed; email/sms: inbound/outbound). */
  directions: string[]
  /** Outcome values (call disposition / meeting outcome). */
  outcomes: string[]
  /** "Thread replies" grouping toggle (Email tab) — a view pref, NOT a row
   *  filter; excluded from hasActiveFilters + pills. */
  thread: boolean
}

export function emptyActivityFilterState(): ActivityFilterState {
  return {
    tab: "all",
    search: "",
    due: null,
    dueFrom: null,
    dueTo: null,
    events: [],
    owners: [],
    directions: [],
    outcomes: [],
    thread: false,
  }
}

/** Whether any row FILTER is active (drives the pill row + the X/Y count).
 *  Excludes `tab` (always set) and `thread` (a view toggle). */
export function hasActiveFilters(s: ActivityFilterState): boolean {
  return (
    s.search.trim() !== "" ||
    s.due !== null ||
    s.events.length > 0 ||
    s.owners.length > 0 ||
    s.directions.length > 0 ||
    s.outcomes.length > 0
  )
}

// ─── URL parse / serialize (a-prefix) ──────────────────────────────────

interface ParamsLike {
  get(name: string): string | null
}

function splitCsv(raw: string | null): string[] {
  return (raw ?? "").split(",").filter(Boolean)
}

function nullIfEmpty(raw: string | null): string | null {
  return raw !== null && raw !== "" ? raw : null
}

export function parseActivityFilters(params: ParamsLike): ActivityFilterState {
  const tabRaw = params.get("atab")
  const tab =
    tabRaw && (ACTIVITY_TABS as string[]).includes(tabRaw) ? (tabRaw as ActivityTab) : "all"
  const dueRaw = params.get("adate")
  const due =
    dueRaw && (ACTIVITY_DUE_PRESETS as string[]).includes(dueRaw)
      ? (dueRaw as ActivityDuePreset)
      : null
  return {
    tab,
    search: params.get("aq") ?? "",
    due,
    dueFrom: due === "custom" ? nullIfEmpty(params.get("adateFrom")) : null,
    dueTo: due === "custom" ? nullIfEmpty(params.get("adateTo")) : null,
    events: splitCsv(params.get("aevent")),
    owners: splitCsv(params.get("aowner")),
    directions: splitCsv(params.get("adir")),
    outcomes: splitCsv(params.get("aoutcome")),
    thread: params.get("athread") === "1",
  }
}

/** Clone `base` (preserving non-activity params like `tab=`, task filters) and
 *  set/delete the a-prefixed activity keys. Empty values delete their key. */
export function applyActivityFiltersToParams(
  base: URLSearchParams,
  state: ActivityFilterState,
): URLSearchParams {
  const next = new URLSearchParams(base.toString())
  const setOrDelete = (key: string, value: string) => {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  // "all" is the default tab — omit it from the URL for cleanliness.
  setOrDelete("atab", state.tab === "all" ? "" : state.tab)
  setOrDelete("aq", state.search.trim())
  setOrDelete("adate", state.due ?? "")
  setOrDelete("adateFrom", state.due === "custom" ? (state.dueFrom ?? "") : "")
  setOrDelete("adateTo", state.due === "custom" ? (state.dueTo ?? "") : "")
  setOrDelete("aevent", state.events.join(","))
  setOrDelete("aowner", state.owners.join(","))
  setOrDelete("adir", state.directions.join(","))
  setOrDelete("aoutcome", state.outcomes.join(","))
  setOrDelete("athread", state.thread ? "1" : "")
  return next
}

// ─── Date-range resolution ─────────────────────────────────────────────

export interface DueRange {
  from: string | null
  to: string | null
}

export function resolveActivityDateRange(
  preset: ActivityDuePreset,
  custom: { dueFrom: string | null; dueTo: string | null },
  today: string,
): DueRange {
  switch (preset) {
    case "yesterday": {
      const d = addDaysCivil(today, -1)
      return { from: d, to: d }
    }
    case "today":
      return { from: today, to: today }
    case "tomorrow": {
      const d = addDaysCivil(today, 1)
      return { from: d, to: d }
    }
    case "last_week": {
      const w = resolveMondaySundayWeek(addDaysCivil(today, -7))
      return { from: w.startISO, to: w.endISO }
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
      const firstOfThisMonth = `${today.slice(0, 7)}-01`
      const m = resolveCurrentMonthRange(addDaysCivil(firstOfThisMonth, -1))
      return { from: m.startISO, to: m.endISO }
    }
    case "custom":
      return { from: custom.dueFrom, to: custom.dueTo }
  }
}

// ─── Matching ──────────────────────────────────────────────────────────

export interface FilterableActivity {
  kind: string
  title: string
  subject?: string | null
  body?: string | null
  actor?: string | null
  actorUserId?: string | null
  direction?: string | null
  outcome?: string | null
  projectId?: string | null
  timestamp: Date
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}
/** A Date's LOCAL civil date as YYYY-MM-DD (matches useToday's local bucket). */
function localYmd(d: Date): string {
  return `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function matchesDate(
  entry: FilterableActivity,
  state: ActivityFilterState,
  today: string,
): boolean {
  if (!state.due) return true
  if (!today) return true // pre-hydration — don't constrain yet
  const range = resolveActivityDateRange(state.due, state, today)
  if (!range.from && !range.to) return true
  const d = localYmd(entry.timestamp)
  if (range.from && d < range.from) return false
  if (range.to && d > range.to) return false
  return true
}

export function applyActivityFilters<T extends FilterableActivity>(
  entries: T[],
  state: ActivityFilterState,
  today: string,
): T[] {
  const search = state.search.trim().toLowerCase()
  return entries.filter((e) => {
    if (state.tab !== "all" && e.kind !== state.tab) return false
    if (search) {
      const haystack =
        `${e.title} ${e.subject ?? ""} ${e.body ?? ""} ${e.actor ?? ""}`.toLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (!matchesDate(e, state, today)) return false
    if (
      state.events.length > 0 &&
      !state.events.some((v) => (v === EVENT_NONE ? !e.projectId : e.projectId === v))
    ) {
      return false
    }
    if (
      state.owners.length > 0 &&
      !state.owners.some((v) => (v === OWNER_UNASSIGNED ? !e.actorUserId : e.actorUserId === v))
    ) {
      return false
    }
    if (state.directions.length > 0 && !(e.direction && state.directions.includes(e.direction))) {
      return false
    }
    if (state.outcomes.length > 0 && !(e.outcome && state.outcomes.includes(e.outcome))) {
      return false
    }
    return true
  })
}

// ─── Active-filter pills ───────────────────────────────────────────────

export type PillFilterType = "due" | "event" | "owner" | "direction" | "outcome"

export interface FilterPill {
  filterType: PillFilterType
  value: string
  label: string
}

const PILL_PREFIX: Record<PillFilterType, string> = {
  due: "All time",
  event: "Event",
  owner: "Assigned to",
  direction: "Direction",
  outcome: "Outcome",
}

export interface PillLookups {
  eventLabel: (value: string) => string
  ownerLabel: (value: string) => string
  directionLabel: (value: string) => string
  outcomeLabel: (value: string) => string
  formatDate: (ymd: string) => string
}

function duePillLabel(state: ActivityFilterState, lookups: PillLookups): string {
  if (state.due === "custom") {
    const from = state.dueFrom ? lookups.formatDate(state.dueFrom) : "…"
    const to = state.dueTo ? lookups.formatDate(state.dueTo) : "…"
    return `${PILL_PREFIX.due}: ${from}–${to}`
  }
  const opt = ACTIVITY_DUE_PRESET_OPTIONS.find((o) => o.value === state.due)
  return `${PILL_PREFIX.due}: ${opt?.label ?? String(state.due)}`
}

export function activeFilterPills(state: ActivityFilterState, lookups: PillLookups): FilterPill[] {
  const pills: FilterPill[] = []
  if (state.due) {
    pills.push({ filterType: "due", value: state.due, label: duePillLabel(state, lookups) })
  }
  for (const v of state.events) {
    pills.push({
      filterType: "event",
      value: v,
      label: `${PILL_PREFIX.event}: ${lookups.eventLabel(v)}`,
    })
  }
  for (const v of state.owners) {
    pills.push({
      filterType: "owner",
      value: v,
      label: `${PILL_PREFIX.owner}: ${lookups.ownerLabel(v)}`,
    })
  }
  for (const v of state.directions) {
    pills.push({
      filterType: "direction",
      value: v,
      label: `${PILL_PREFIX.direction}: ${lookups.directionLabel(v)}`,
    })
  }
  for (const v of state.outcomes) {
    pills.push({
      filterType: "outcome",
      value: v,
      label: `${PILL_PREFIX.outcome}: ${lookups.outcomeLabel(v)}`,
    })
  }
  return pills
}

export function removeFilterValue(
  state: ActivityFilterState,
  filterType: PillFilterType,
  value: string,
): ActivityFilterState {
  switch (filterType) {
    case "due":
      return { ...state, due: null, dueFrom: null, dueTo: null }
    case "event":
      return { ...state, events: state.events.filter((v) => v !== value) }
    case "owner":
      return { ...state, owners: state.owners.filter((v) => v !== value) }
    case "direction":
      return { ...state, directions: state.directions.filter((v) => v !== value) }
    case "outcome":
      return { ...state, outcomes: state.outcomes.filter((v) => v !== value) }
  }
}

/** Clear all row FILTERS; preserve the active tab + the thread view toggle
 *  (a "clear" returns to the unfiltered list, not a tab/view reset). */
export function clearAllFilters(state: ActivityFilterState): ActivityFilterState {
  return { ...emptyActivityFilterState(), tab: state.tab, thread: state.thread }
}
