"use client"

import { ChevronDown } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import { MultiSelectMenu, type MultiSelectOption } from "@/components/ui/multi-select-menu"
import { FilterPills, type FilterPillItem } from "@/components/ui/filter-pills"
import { cn } from "@/lib/utils"
import { NOTIFICATION_TYPES } from "@/modules/notifications/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationTimePreset = "today" | "this_week"

export interface NotificationFilterState {
  types: string[]
  timePreset: NotificationTimePreset | null
  from: string | null
  to: string | null
}

export const EMPTY_NOTIFICATION_FILTER: NotificationFilterState = {
  types: [],
  timePreset: null,
  from: null,
  to: null,
}

// ---------------------------------------------------------------------------
// Type options (derived from the registry)
// ---------------------------------------------------------------------------

const TYPE_OPTIONS: MultiSelectOption[] = Object.entries(NOTIFICATION_TYPES).map(([key, meta]) => ({
  value: key,
  label: meta.label,
}))

// Label lookup that's safe against unknown type keys from the DB
const TYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(NOTIFICATION_TYPES).map(([k, v]) => [k, v.label]),
)

// ---------------------------------------------------------------------------
// Time preset options
// ---------------------------------------------------------------------------

interface TimeOption {
  value: NotificationTimePreset
  label: string
}

const TIME_OPTIONS: TimeOption[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
]

const TIME_LABEL_MAP: Record<NotificationTimePreset, string> = {
  today: "Today",
  this_week: "This week",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function filterStateToApiParams(state: NotificationFilterState): Record<string, string> {
  const params: Record<string, string> = {}
  if (state.types.length > 0) params.types = state.types.join(",")
  if (state.timePreset === "today") {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(start.getTime() + 86_400_000 - 1)
    params.from = start.toISOString()
    params.to = end.toISOString()
  } else if (state.timePreset === "this_week") {
    const now = new Date()
    const day = now.getDay() // 0=Sun
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((day + 6) % 7))
    const sunday = new Date(monday.getTime() + 7 * 86_400_000 - 1)
    params.from = monday.toISOString()
    params.to = sunday.toISOString()
  }
  return params
}

export function hasActiveNotificationFilters(state: NotificationFilterState): boolean {
  return state.types.length > 0 || state.timePreset !== null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Filter strip for the notification center — Type (multi-select) + Time
 * (date-preset popover). Modeled on ActivityFilterStrip.
 */
export function NotificationFilterStrip({
  state,
  onChange,
}: {
  state: NotificationFilterState
  onChange: (next: NotificationFilterState) => void
}) {
  const anyActive = hasActiveNotificationFilters(state)

  const pills: FilterPillItem[] = [
    ...state.types.map((t) => ({
      key: `type:${t}`,
      label: TYPE_LABEL_MAP[t] ?? t,
      onRemove: () => {
        onChange({ ...state, types: state.types.filter((v) => v !== t) })
      },
    })),
    ...(state.timePreset
      ? [
          {
            key: `time:${state.timePreset}`,
            label: TIME_LABEL_MAP[state.timePreset],
            onRemove: () => {
              onChange({ ...state, timePreset: null, from: null, to: null })
            },
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-2" data-testid="notification-filter-strip">
      {/* Dropdowns row */}
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectMenu
          label="Type"
          options={TYPE_OPTIONS}
          values={state.types}
          onChange={(v) => {
            onChange({ ...state, types: v })
          }}
          testId="notification-filter-type"
        />
        <TimeMenu state={state} onChange={onChange} />
        <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">Newest</span>
      </div>
      {/* Pills row */}
      {anyActive && (
        <FilterPills
          pills={pills}
          onClearAll={() => {
            onChange(EMPTY_NOTIFICATION_FILTER)
          }}
        />
      )}
    </div>
  )
}

/** Time preset dropdown — Today / This week. */
function TimeMenu({
  state,
  onChange,
}: {
  state: NotificationFilterState
  onChange: (next: NotificationFilterState) => void
}) {
  const active = state.timePreset !== null
  // Explicit null check allows TypeScript to narrow timePreset to the Record key type
  const label = state.timePreset !== null ? TIME_LABEL_MAP[state.timePreset] : "Time"

  return (
    <Popover
      align="start"
      className="p-1"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          data-testid="notification-filter-time"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors",
            active
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/40",
          )}
        >
          <span>{label}</span>
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      <ul className="space-y-0.5">
        {TIME_OPTIONS.map((o) => (
          <li key={o.value}>
            <button
              type="button"
              onClick={() => {
                onChange({
                  ...state,
                  timePreset: o.value,
                  from: null,
                  to: null,
                })
              }}
              className={cn(
                "flex w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-accent)]/40",
                state.timePreset === o.value && "font-medium text-[var(--color-primary)]",
              )}
            >
              {o.label}
            </button>
          </li>
        ))}
        {active && (
          <>
            <li className="my-1 border-t border-[var(--color-border)]" />
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...state, timePreset: null, from: null, to: null })
                }}
                className="flex w-full rounded px-2 py-1 text-left text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
              >
                Clear
              </button>
            </li>
          </>
        )}
      </ul>
    </Popover>
  )
}
