"use client"

import { type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover } from "@/components/ui/popover"
import { Avatar } from "@/components/ui/avatar"
import { CalendarRange } from "@/components/ui/calendar-range"
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input"
import { MultiSelectMenu, type MultiSelectOption } from "@/components/ui/multi-select-menu"
import { FilterPills, type FilterPillItem } from "@/components/ui/filter-pills"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format"
import {
  parseTaskFilters,
  applyTaskFiltersToParams,
  hasActiveFilters,
  activeFilterPills,
  removeFilterValue,
  clearAllFilters,
  DUE_PRESET_OPTIONS,
  STATUS_FILTER_OPTIONS,
  PRIORITY_FILTER_OPTIONS,
  EVENT_GENERAL,
  ASSIGNEE_UNASSIGNED,
  type TaskFilterState,
  type DuePreset,
  type StatusFilterValue,
} from "@/modules/tasks/task-filter"

/**
 * HubSpot-style filter strip for the contact Tasks pane (Mike-locked
 * 2026-06-20). Three rows: search + Collapse-all; Filters toggle + sort
 * toggle + Create-a-task; the five dropdowns. Plus an active-filter pill row.
 *
 * The URL is the single source of truth (decision #9): the strip parses
 * filters from `useSearchParams`, and every control writes back via
 * `router.replace` (preserving `?tab=`). The Tasks pane reads the same params
 * to filter its list, so the two stay in sync without prop threading.
 *
 * REUSE (memory #12): the dropdowns / search / pills / calendar / avatar are
 * generic primitives in `components/ui`; this file is the task-specific
 * COMPOSITION that the upcoming Activity-feed filter strip will mirror.
 *
 * Pattern note (memory rule #10): the stacking AND-across / OR-within filter
 * model + the Filters-toggle-reveals-dropdowns layout follow HubSpot's task
 * index; the sort-by-priority toggle follows Asana/ClickUp "group by priority".
 */
export interface TaskEventOption {
  id: string
  name: string
}
export interface TaskMemberOption {
  id: string
  name: string
  image: string | null
}

export function TaskFilterStrip({
  eventOptions,
  memberOptions,
  today,
  createSlot,
  collapseAllSlot,
  filtersOpen,
  onToggleFilters,
}: {
  eventOptions: TaskEventOption[]
  memberOptions: TaskMemberOption[]
  /** Viewer-local today (YYYY-MM-DD) for the custom calendar; null pre-hydration. */
  today: string | null
  /** "Create a task" control (Row 2, right). */
  createSlot: ReactNode
  /** "Collapse all" control (Row 1, right) — omitted when filters are active. */
  collapseAllSlot?: ReactNode
  filtersOpen: boolean
  onToggleFilters: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const state = parseTaskFilters(searchParams)
  const anyActive = hasActiveFilters(state)

  function commit(next: TaskFilterState) {
    const params = applyTaskFiltersToParams(new URLSearchParams(searchParams.toString()), next)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "?", { scroll: false })
  }

  // ── Dropdown option lists ──
  const eventMenuOptions: MultiSelectOption[] = [
    ...eventOptions.map((e) => ({ value: e.id, label: e.name })),
    { value: EVENT_GENERAL, label: "General", dividerBefore: eventOptions.length > 0 },
  ]
  const statusMenuOptions: MultiSelectOption[] = STATUS_FILTER_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }))
  const priorityMenuOptions: MultiSelectOption[] = PRIORITY_FILTER_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
    dividerBefore: o.value === "none",
  }))
  const assigneeMenuOptions: MultiSelectOption[] = [
    ...memberOptions.map((m) => ({
      value: m.id,
      label: m.name,
      leading: <Avatar name={m.name} image={m.image} size={18} />,
    })),
    { value: ASSIGNEE_UNASSIGNED, label: "Unassigned", dividerBefore: memberOptions.length > 0 },
  ]

  // ── Pills ──
  const eventLabel = (v: string) =>
    v === EVENT_GENERAL ? "General" : (eventOptions.find((e) => e.id === v)?.name ?? v)
  const assigneeLabel = (v: string) =>
    v === ASSIGNEE_UNASSIGNED ? "Unassigned" : (memberOptions.find((m) => m.id === v)?.name ?? v)
  const pills: FilterPillItem[] = activeFilterPills(state, {
    eventLabel,
    assigneeLabel,
    formatDate,
  }).map((p) => ({
    key: `${p.filterType}:${p.value}`,
    label: p.label,
    onRemove: () => {
      commit(removeFilterValue(state, p.filterType, p.value))
    },
  }))

  return (
    <div className="space-y-2" data-testid="task-filter-strip">
      {/* Row 1 — search (left, never full-width) + Collapse all (right) */}
      <div className="flex items-center justify-between gap-2">
        <DebouncedSearchInput
          value={state.search}
          onDebouncedChange={(v) => {
            commit({ ...state, search: v })
          }}
          placeholder="Search tasks"
          className="h-8 w-[160px] shrink text-sm sm:w-[220px]"
          testId="task-search"
        />
        {collapseAllSlot}
      </div>

      {/* Row 2 — Filters toggle + sort toggle (left) + Create a task (right) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onToggleFilters}
            data-testid="task-filters-toggle"
          >
            Filters
          </Button>
          <button
            type="button"
            onClick={() => {
              commit({ ...state, sortByPriority: !state.sortByPriority })
            }}
            aria-pressed={state.sortByPriority}
            className={cn(
              "rounded-md border px-2.5 py-1 text-sm transition-colors",
              state.sortByPriority
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/40",
            )}
            data-testid="task-sort-priority"
          >
            Sort by priority
          </button>
        </div>
        {createSlot}
      </div>

      {/* Row 3 — the five dropdowns (responsive wrap) */}
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2" data-testid="task-filter-dropdowns">
          <DateRangeMenu state={state} today={today} onCommit={commit} />
          <MultiSelectMenu
            label="Event"
            options={eventMenuOptions}
            values={state.events}
            onChange={(v) => {
              commit({ ...state, events: v })
            }}
            testId="task-filter-event"
          />
          <MultiSelectMenu
            label="Task status"
            options={statusMenuOptions}
            values={state.statuses}
            onChange={(v) => {
              commit({ ...state, statuses: v as StatusFilterValue[] })
            }}
            testId="task-filter-status"
          />
          <MultiSelectMenu
            label="Priority"
            options={priorityMenuOptions}
            values={state.priorities}
            onChange={(v) => {
              commit({ ...state, priorities: v })
            }}
            testId="task-filter-priority"
          />
          <MultiSelectMenu
            label="Assigned to"
            options={assigneeMenuOptions}
            values={state.assignees}
            onChange={(v) => {
              commit({ ...state, assignees: v })
            }}
            testId="task-filter-assignee"
          />
        </div>
      )}

      {/* Row 4 — active-filter pills + Clear all */}
      {anyActive && (
        <FilterPills
          pills={pills}
          onClearAll={() => {
            commit(clearAllFilters(state))
          }}
        />
      )}
    </div>
  )
}

/**
 * "All time" date dropdown — single-select presets; "Custom" reveals the inline
 * range calendar in the same popover (decision #3). Stays open on selection so
 * the calendar interaction isn't interrupted; dismiss by clicking away.
 */
function DateRangeMenu({
  state,
  today,
  onCommit,
}: {
  state: TaskFilterState
  today: string | null
  onCommit: (next: TaskFilterState) => void
}) {
  const active = state.due !== null
  const activeLabel = state.due
    ? (DUE_PRESET_OPTIONS.find((o) => o.value === state.due)?.label ?? "All time")
    : "All time"

  function selectPreset(due: DuePreset) {
    if (due === "custom") onCommit({ ...state, due: "custom" })
    else onCommit({ ...state, due, dueFrom: null, dueTo: null })
  }

  return (
    <Popover
      align="start"
      className="p-2"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          data-testid="task-filter-due"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors",
            active
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/40",
          )}
        >
          <span>{activeLabel}</span>
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      <ul className="space-y-0.5">
        {DUE_PRESET_OPTIONS.map((o) => (
          <li key={o.value}>
            <button
              type="button"
              onClick={() => {
                selectPreset(o.value)
              }}
              className={cn(
                "flex w-full items-center rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-accent)]/40",
                state.due === o.value && "font-medium text-[var(--color-primary)]",
              )}
            >
              {o.label}
            </button>
          </li>
        ))}
      </ul>
      {state.due === "custom" && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          <CalendarRange
            from={state.dueFrom}
            to={state.dueTo}
            today={today}
            onChange={(range) => {
              onCommit({ ...state, due: "custom", dueFrom: range.from, dueTo: range.to })
            }}
          />
        </div>
      )}
    </Popover>
  )
}
