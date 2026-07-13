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
  CALL_DIRECTIONS,
  RECORDED_CALL_DISPOSITIONS,
  dispositionDisplayLabel,
} from "@/modules/calls/types"
import { MEETING_OUTCOMES } from "@/modules/meetings/types"
import {
  parseActivityFilters,
  applyActivityFiltersToParams,
  hasActiveFilters,
  activeFilterPills,
  removeFilterValue,
  clearAllFilters,
  ACTIVITY_DUE_PRESET_OPTIONS,
  EVENT_NONE,
  OWNER_UNASSIGNED,
  type ActivityFilterState,
  type ActivityTab,
  type ActivityDuePreset,
} from "@/modules/contacts/ui/activity-filter"

/**
 * Tab-aware filter strip for the contact Activity feed (memory #12, Mike-locked
 * 2026-06-21). Sibling to TaskFilterStrip — same 3-row layout + pill row, same
 * URL-as-source-of-truth (a-prefix params via the activity-filter core), same
 * reused primitives.
 *
 * TABS ARE THE TYPE FILTER (rendered by the parent feed). This strip shows the
 * dropdowns appropriate to the active tab: All time + Event + Assigned-to on
 * every tab; Direction on Call/Email/SMS; Outcome on Call/Meeting; a "Thread
 * replies" toggle on Email. "No event" / "Unassigned" sentinels are included in
 * the Event / Assigned-to menus (parity with the Tasks strip).
 *
 * Not yet mounted into the feed — the swap from the legacy chip row + Filters
 * popover happens in Commit 5 with the test rewrites.
 */
export interface ActivityEventOption {
  id: string
  name: string
}
export interface ActivityMemberOption {
  id: string
  name: string
  image: string | null
}

const TAB_SEARCH_PLACEHOLDER: Record<ActivityTab, string> = {
  all: "Search activities",
  note: "Search notes",
  call: "Search calls",
  email: "Search emails",
  sms: "Search SMS",
  meeting: "Search meetings",
}

// Direction option sets differ by tab: calls use incoming/outgoing/missed;
// email + SMS use inbound/outbound.
const CALL_DIRECTION_LABEL: Record<string, string> = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  missed: "Missed",
}
const COMM_DIRECTION_LABEL: Record<string, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
}

function directionOptionsForTab(tab: ActivityTab): MultiSelectOption[] {
  if (tab === "call") {
    return CALL_DIRECTIONS.map((d) => ({ value: d, label: CALL_DIRECTION_LABEL[d] ?? d }))
  }
  if (tab === "email" || tab === "sms") {
    return [
      { value: "inbound", label: "Inbound" },
      { value: "outbound", label: "Outbound" },
    ]
  }
  return []
}

function directionLabelForTab(tab: ActivityTab, value: string): string {
  if (tab === "call") return CALL_DIRECTION_LABEL[value] ?? value
  return COMM_DIRECTION_LABEL[value] ?? value
}

function outcomeOptionsForTab(tab: ActivityTab): MultiSelectOption[] {
  if (tab === "call") {
    return RECORDED_CALL_DISPOSITIONS.map((d) => ({ value: d, label: dispositionDisplayLabel(d) }))
  }
  if (tab === "meeting") {
    return MEETING_OUTCOMES.map((o) => ({ value: o, label: o }))
  }
  return []
}

function outcomeLabelForTab(tab: ActivityTab, value: string): string {
  if (tab === "call") {
    return RECORDED_CALL_DISPOSITIONS.includes(value as never)
      ? dispositionDisplayLabel(value as (typeof RECORDED_CALL_DISPOSITIONS)[number])
      : value
  }
  return value
}

const showsDirection = (tab: ActivityTab) => tab === "call" || tab === "email" || tab === "sms"
const showsOutcome = (tab: ActivityTab) => tab === "call" || tab === "meeting"

export function ActivityFilterStrip({
  eventOptions,
  memberOptions,
  today,
  shownCount,
  totalCount,
  actionSlot,
  collapseAllSlot,
  filtersOpen,
  onToggleFilters,
}: {
  eventOptions: ActivityEventOption[]
  memberOptions: ActivityMemberOption[]
  today: string | null
  shownCount: number
  totalCount: number
  /** Tab action buttons (Row 2, right) — Create a note, Log a call, etc. */
  actionSlot?: ReactNode
  /** "Collapse all" (Row 1, right). */
  collapseAllSlot?: ReactNode
  filtersOpen: boolean
  onToggleFilters: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const state = parseActivityFilters(searchParams)
  const anyActive = hasActiveFilters(state)
  const tab = state.tab

  function commit(next: ActivityFilterState) {
    const params = applyActivityFiltersToParams(new URLSearchParams(searchParams.toString()), next)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "?", { scroll: false })
  }

  // ── Dropdown options ──
  const eventMenuOptions: MultiSelectOption[] = [
    ...eventOptions.map((e) => ({ value: e.id, label: e.name })),
    { value: EVENT_NONE, label: "No event", dividerBefore: eventOptions.length > 0 },
  ]
  const ownerMenuOptions: MultiSelectOption[] = [
    ...memberOptions.map((m) => ({
      value: m.id,
      label: m.name,
      leading: <Avatar name={m.name} image={m.image} size={18} />,
    })),
    { value: OWNER_UNASSIGNED, label: "Unassigned", dividerBefore: memberOptions.length > 0 },
  ]

  // ── Pills ──
  const eventLabel = (v: string) =>
    v === EVENT_NONE ? "No event" : (eventOptions.find((e) => e.id === v)?.name ?? v)
  const ownerLabel = (v: string) =>
    v === OWNER_UNASSIGNED ? "Unassigned" : (memberOptions.find((m) => m.id === v)?.name ?? v)
  const pills: FilterPillItem[] = activeFilterPills(state, {
    eventLabel,
    ownerLabel,
    directionLabel: (v) => directionLabelForTab(tab, v),
    outcomeLabel: (v) => outcomeLabelForTab(tab, v),
    formatDate,
  }).map((p) => ({
    key: `${p.filterType}:${p.value}`,
    label: p.label,
    onRemove: () => {
      commit(removeFilterValue(state, p.filterType, p.value))
    },
  }))

  return (
    <div className="space-y-2" data-testid="activity-filter-strip">
      {/* Row 1 — search (+ Thread-replies toggle on Email) + Collapse all */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DebouncedSearchInput
            value={state.search}
            onDebouncedChange={(v) => {
              commit({ ...state, search: v })
            }}
            placeholder={TAB_SEARCH_PLACEHOLDER[tab]}
            className="h-8 w-[160px] shrink text-sm sm:w-[220px]"
            testId="activity-search"
          />
          {tab === "email" && (
            <button
              type="button"
              onClick={() => {
                commit({ ...state, thread: !state.thread })
              }}
              aria-pressed={state.thread}
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1 text-sm transition-colors focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none active:bg-[var(--state-active)]",
                state.thread
                  ? "border-[var(--state-selected)] text-[var(--color-primary)]"
                  : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--state-hover)]",
              )}
              data-testid="activity-thread-toggle"
            >
              Thread replies
            </button>
          )}
        </div>
        {collapseAllSlot}
      </div>

      {/* Row 2 — Filters toggle (left) + tab action buttons (right) */}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleFilters}
          data-testid="activity-filters-toggle"
        >
          Filters
        </Button>
        {actionSlot}
      </div>

      {/* Row 3 — tab-appropriate dropdowns */}
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2" data-testid="activity-filter-dropdowns">
          <DateRangeMenu state={state} today={today} onCommit={commit} />
          <MultiSelectMenu
            label="Event"
            options={eventMenuOptions}
            values={state.events}
            onChange={(v) => {
              commit({ ...state, events: v })
            }}
            testId="activity-filter-event"
          />
          {showsDirection(tab) && (
            <MultiSelectMenu
              label="Direction"
              options={directionOptionsForTab(tab)}
              values={state.directions}
              onChange={(v) => {
                commit({ ...state, directions: v })
              }}
              testId="activity-filter-direction"
            />
          )}
          {showsOutcome(tab) && (
            <MultiSelectMenu
              label="Outcome"
              options={outcomeOptionsForTab(tab)}
              values={state.outcomes}
              onChange={(v) => {
                commit({ ...state, outcomes: v })
              }}
              testId="activity-filter-outcome"
            />
          )}
          <MultiSelectMenu
            label="Assigned to"
            options={ownerMenuOptions}
            values={state.owners}
            onChange={(v) => {
              commit({ ...state, owners: v })
            }}
            testId="activity-filter-owner"
          />
        </div>
      )}

      {/* Row 4 — pills + Clear all (left) + X/Y count (right) */}
      {anyActive && (
        <div className="flex items-start justify-between gap-2">
          <FilterPills
            pills={pills}
            onClearAll={() => {
              commit(clearAllFilters(state))
            }}
          />
          <span
            className="text-2xs shrink-0 text-[var(--color-muted-foreground)] tabular-nums"
            data-testid="activity-filter-count"
          >
            {shownCount}/{totalCount}
          </span>
        </div>
      )}
    </div>
  )
}

/** "All time" date dropdown — single-select presets (grouped Past/Present/Future
 *  with dividers); "Custom" reveals the inline range calendar. */
function DateRangeMenu({
  state,
  today,
  onCommit,
}: {
  state: ActivityFilterState
  today: string | null
  onCommit: (next: ActivityFilterState) => void
}) {
  const active = state.due !== null
  const activeLabel = state.due
    ? (ACTIVITY_DUE_PRESET_OPTIONS.find((o) => o.value === state.due)?.label ?? "All time")
    : "All time"

  function selectPreset(due: ActivityDuePreset) {
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
          data-testid="activity-filter-due"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none active:bg-[var(--state-active)]",
            active
              ? "border-[var(--state-selected)] text-[var(--color-primary)]"
              : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--state-hover)]",
          )}
        >
          <span>{activeLabel}</span>
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      <ul className="space-y-0.5">
        {ACTIVITY_DUE_PRESET_OPTIONS.map((o) => (
          <li key={o.value}>
            {o.dividerBefore && <div className="my-1 border-t border-[var(--color-border)]" />}
            <button
              type="button"
              onClick={() => {
                selectPreset(o.value)
              }}
              className={cn(
                "flex w-full items-center rounded px-2 py-1 text-left text-sm hover:bg-[var(--state-hover)]",
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
