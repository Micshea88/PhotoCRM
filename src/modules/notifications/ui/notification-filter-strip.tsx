"use client"

import { ChevronDown } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import {
  MultiSelectMenu,
  type MultiSelectOption,
  type MultiSelectSection,
} from "@/components/ui/multi-select-menu"
import { FilterPills, type FilterPillItem } from "@/components/ui/filter-pills"
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input"
import { cn } from "@/lib/utils"
import { NOTIFICATION_TYPES, NOTIFICATION_CATEGORIES } from "@/modules/notifications/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationTimePreset = "today" | "this_week"

export type NotificationSortOrder = "newest" | "oldest"

export interface NotificationFilterState {
  types: string[]
  timePreset: NotificationTimePreset | null
  from: string | null
  to: string | null
  /** Free-text search over notification title + body (case-insensitive). */
  search: string
  /** Filter to a single contact by ID. */
  contactId: string | null
  /** Sort order: "newest" (default) = desc(createdAt), "oldest" = asc(createdAt). */
  sort: NotificationSortOrder
}

export const EMPTY_NOTIFICATION_FILTER: NotificationFilterState = {
  types: [],
  timePreset: null,
  from: null,
  to: null,
  search: "",
  contactId: null,
  sort: "newest",
}

/** A lightweight contact option for the notification filter contact picker. */
export interface NotificationContactOption {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Type options (derived from the registry)
// ---------------------------------------------------------------------------

// Grouped by the 6 registry categories (single source of truth:
// NOTIFICATION_CATEGORIES) so the Type filter mirrors the settings panel's bands.
const TYPE_SECTIONS: MultiSelectSection[] = NOTIFICATION_CATEGORIES.map((cat) => ({
  label: cat.label,
  options: Object.entries(NOTIFICATION_TYPES)
    .filter(([, meta]) => meta.category === cat.key)
    .map(([key, meta]): MultiSelectOption => ({ value: key, label: meta.label })),
})).filter((s) => s.options.length > 0)

// Label lookup that's safe against unknown type keys from the DB
const TYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(NOTIFICATION_TYPES).map(([k, v]) => [k, v.label]),
)

// ---------------------------------------------------------------------------
// Sort options
// ---------------------------------------------------------------------------

// Sort is mutually exclusive → single-select (radio), NOT MultiSelectMenu.
const SORT_OPTIONS: { value: NotificationSortOrder; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
]

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
  if (state.search.trim()) params.q = state.search.trim()
  if (state.contactId) params.contactId = state.contactId
  if (state.sort === "oldest") params.sort = "oldest"
  return params
}

export function hasActiveNotificationFilters(state: NotificationFilterState): boolean {
  return (
    state.types.length > 0 ||
    state.timePreset !== null ||
    state.search.trim() !== "" ||
    state.contactId !== null
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Filter strip for the notification center — Type (multi-select) + Time
 * (date-preset popover) + optional Contact (multi-select, single-pick) +
 * optional free-text Search + optional Sort order.
 *
 * `contactOptions` — when non-empty, a Contact picker is rendered. Pass the
 *   distinct contacts from the current user's live notifications (page-only).
 * `showSearch` — when true, the DebouncedSearchInput is rendered (page-only).
 * `showSort`   — when true, the Sort order control is rendered (page-only).
 *
 * The bell dropdown passes none of these props, so it continues to show only
 * Type + Time (graceful degradation). The /notifications page passes
 * `showSearch` and `showSort` to expose the full control set.
 */
export function NotificationFilterStrip({
  state,
  onChange,
  contactOptions = [],
  showSearch = false,
  showSort = false,
}: {
  state: NotificationFilterState
  onChange: (next: NotificationFilterState) => void
  contactOptions?: NotificationContactOption[]
  showSearch?: boolean
  showSort?: boolean
}) {
  const anyActive = hasActiveNotificationFilters(state)

  const contactLabel = (id: string) => contactOptions.find((c) => c.id === id)?.name ?? "Contact"

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
    ...(state.contactId
      ? [
          {
            key: `contact:${state.contactId}`,
            label: contactLabel(state.contactId),
            onRemove: () => {
              onChange({ ...state, contactId: null })
            },
          },
        ]
      : []),
    ...(state.search.trim()
      ? [
          {
            key: "search",
            label: `"${state.search.trim()}"`,
            onRemove: () => {
              onChange({ ...state, search: "" })
            },
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-2" data-testid="notification-filter-strip">
      {/* Dropdowns + search row */}
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectMenu
          label="Type"
          sections={TYPE_SECTIONS}
          searchable
          searchPlaceholder="Search types…"
          values={state.types}
          onChange={(v) => {
            onChange({ ...state, types: v })
          }}
          testId="notification-filter-type"
        />
        <TimeMenu state={state} onChange={onChange} />
        {contactOptions.length > 0 && (
          <MultiSelectMenu
            label="Contact"
            options={contactOptions.map((c) => ({ value: c.id, label: c.name }))}
            values={state.contactId ? [state.contactId] : []}
            onChange={(v) => {
              onChange({ ...state, contactId: v[0] ?? null })
            }}
            testId="notification-filter-contact"
          />
        )}
        {showSearch && (
          <DebouncedSearchInput
            value={state.search}
            onDebouncedChange={(v) => {
              onChange({ ...state, search: v })
            }}
            placeholder="Search notifications"
            className="h-8 w-[180px] shrink text-sm"
            testId="notification-search"
          />
        )}
        {showSort && (
          <div
            role="radiogroup"
            aria-label="Sort order"
            data-testid="notification-sort"
            className="ml-auto flex overflow-hidden rounded-md border border-[var(--color-border)]"
          >
            {SORT_OPTIONS.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={state.sort === o.value}
                onClick={() => {
                  onChange({ ...state, sort: o.value })
                }}
                className={cn(
                  "px-3 py-1 text-sm transition-colors",
                  i > 0 && "border-l border-[var(--color-border)]",
                  state.sort === o.value
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-background)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40 hover:text-[var(--color-foreground)]",
                )}
                data-testid={`notification-sort-${o.value}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
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
