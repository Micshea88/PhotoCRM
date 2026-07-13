"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CONTACT_TYPES, LIFECYCLE_STATUSES } from "../types"
import { LeadSourceCombobox } from "./lead-source-combobox"

export interface FilterBarProps {
  tagOptions: string[]
  ownerOptions: { id: string; name: string | null; email: string }[]
  companyOptions: { id: string; name: string }[]
  leadSourceOptions: string[]
  hiddenLeadSources: string[]
  /**
   * Optional content appended to the chip row as a sibling of the chips.
   * Used by the contacts shell to inline the "+ More filters" button so
   * it sits immediately after the last chip on the same flex line (and
   * wraps with the chips on narrow viewports instead of dropping to its
   * own row).
   */
  trailingChips?: React.ReactNode
}

/**
 * Sticky filter bar for /contacts. Owns the search box + 7 filter chips.
 * State lives entirely in URL search params — onChange updates the URL,
 * which triggers a server re-render with new filtered data.
 *
 * Search: live + debounced (~300ms). No explicit submit button — typing
 * pushes the URL once typing pauses. "Clear all" resets filters + the
 * search box together.
 *
 * Filter chips: each chip is a Popover (custom component). Popover closes
 * on outside-click, Escape, or click-the-chip-again.
 */
const SEARCH_DEBOUNCE_MS = 300

export function ContactsFilterBar(props: FilterBarProps) {
  const router = useRouter()
  const params = useSearchParams()
  const [, startTransition] = useTransition()
  const [searchInput, setSearchInput] = useState(params.get("q") ?? "")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateParam = useCallback(
    (key: string, value: string | string[] | null) => {
      const next = new URLSearchParams(params)
      if (value === null || (Array.isArray(value) && value.length === 0) || value === "") {
        next.delete(key)
      } else if (Array.isArray(value)) {
        next.set(key, value.join(","))
      } else {
        next.set(key, value)
      }
      startTransition(() => {
        router.push(`/contacts?${next.toString()}`)
      })
    },
    [params, router],
  )

  // Debounce the search box. Each keystroke schedules a push 300ms out;
  // a new keystroke cancels the pending push. The URL only changes once
  // the user pauses, so the server doesn't re-render on every key.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const current = params.get("q") ?? ""
    if (searchInput === current) return
    debounceRef.current = setTimeout(() => {
      updateParam("q", searchInput.trim() || null)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchInput, params, updateParam])

  function clearAll() {
    setSearchInput("")
    startTransition(() => {
      router.push("/contacts")
    })
  }

  const activeContactType = params.get("contactType") ?? ""
  const activeLifecycle = params.get("lifecycleStatus") ?? ""
  const activeOwner = params.get("ownerUserId") ?? ""
  const activeCompany = params.get("companyId") ?? ""
  const activeLeadSource = params.get("leadSource") ?? ""
  const activeTags = (params.get("tags") ?? "").split(",").filter(Boolean)
  const createdFrom = params.get("createdFrom") ?? ""
  const createdTo = params.get("createdTo") ?? ""

  const hasAnyFilter =
    !!activeContactType ||
    !!activeLifecycle ||
    !!activeOwner ||
    !!activeCompany ||
    !!activeLeadSource ||
    activeTags.length > 0 ||
    !!createdFrom ||
    !!createdTo ||
    !!params.get("q")

  function selectPreset(days: number) {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - days)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const next = new URLSearchParams(params)
    next.set("createdFrom", fmt(start))
    next.set("createdTo", fmt(end))
    startTransition(() => {
      router.push(`/contacts?${next.toString()}`)
    })
  }

  function clearDateRange() {
    const next = new URLSearchParams(params)
    next.delete("createdFrom")
    next.delete("createdTo")
    startTransition(() => {
      router.push(`/contacts?${next.toString()}`)
    })
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          // No-op equivalent: typing already pushes the URL via the
          // debounce effect. The button exists as a visual + a11y
          // affordance; pressing it re-asserts the current value
          // (and clears any pending debounce timer by calling
          // updateParam immediately).
          updateParam("q", searchInput.trim() || null)
        }}
        className="flex items-center gap-2"
      >
        <Input
          type="search"
          placeholder="Search name, email, phone, or company…"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value)
          }}
          className="max-w-md flex-1"
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
        {hasAnyFilter && (
          <Button type="button" variant="outline" size="sm" onClick={clearAll}>
            Clear all
          </Button>
        )}
      </form>

      {/* Filter chips */}
      <div className="flex flex-wrap items-start gap-2">
        <FilterChip label="Contact type" value={activeContactType}>
          <ChipSearchList
            items={CONTACT_TYPES.map((t) => ({ value: t, label: t }))}
            value={activeContactType || null}
            onChange={(v) => {
              updateParam("contactType", v)
            }}
          />
        </FilterChip>

        <FilterChip label="Lifecycle status" value={activeLifecycle}>
          <ChipSearchList
            items={LIFECYCLE_STATUSES.map((s) => ({ value: s, label: s }))}
            value={activeLifecycle || null}
            onChange={(v) => {
              updateParam("lifecycleStatus", v)
            }}
          />
        </FilterChip>

        <FilterChip
          label="Tags"
          value={activeTags.length > 0 ? `${String(activeTags.length)} selected` : ""}
        >
          {props.tagOptions.length === 0 ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              No tags yet. Add tags on a contact to filter by them.
            </p>
          ) : (
            <ChipSearchMultiList
              items={props.tagOptions.map((t) => ({ value: t, label: t }))}
              values={activeTags}
              onChange={(next) => {
                updateParam("tags", next)
              }}
            />
          )}
        </FilterChip>

        <FilterChip
          label="Owner"
          value={(() => {
            if (!activeOwner) return ""
            const m = props.ownerOptions.find((o) => o.id === activeOwner)
            return m?.name ?? m?.email ?? activeOwner
          })()}
        >
          <ChipSearchList
            items={props.ownerOptions.map((o) => ({
              value: o.id,
              label: o.name ?? o.email,
              description: o.name ? o.email : undefined,
            }))}
            value={activeOwner || null}
            onChange={(v) => {
              updateParam("ownerUserId", v)
            }}
            emptyMessage="No team members"
          />
        </FilterChip>

        <FilterChip
          label="Company"
          value={
            activeCompany
              ? (props.companyOptions.find((c) => c.id === activeCompany)?.name ?? activeCompany)
              : ""
          }
        >
          <ChipSearchList
            items={props.companyOptions.map((c) => ({ value: c.id, label: c.name }))}
            value={activeCompany || null}
            onChange={(v) => {
              updateParam("companyId", v)
            }}
            emptyMessage="No companies yet"
          />
        </FilterChip>

        <FilterChip label="Lead source" value={activeLeadSource}>
          <LeadSourceCombobox
            value={activeLeadSource}
            onChange={(v) => {
              updateParam("leadSource", v || null)
            }}
            existingValues={props.leadSourceOptions}
            hiddenSources={props.hiddenLeadSources}
            allowAnyOption
            anyLabel="— Any —"
          />
        </FilterChip>

        <FilterChip
          label="Date created"
          value={createdFrom || createdTo ? `${createdFrom || "…"} → ${createdTo || "…"}` : ""}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  selectPreset(7)
                }}
              >
                Last 7 days
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  selectPreset(30)
                }}
              >
                Last 30 days
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  selectPreset(90)
                }}
              >
                Last 90 days
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs">From</label>
                <Input
                  type="date"
                  value={createdFrom}
                  onChange={(e) => {
                    updateParam("createdFrom", e.target.value || null)
                  }}
                />
              </div>
              <div>
                <label className="text-xs">To</label>
                <Input
                  type="date"
                  value={createdTo}
                  onChange={(e) => {
                    updateParam("createdTo", e.target.value || null)
                  }}
                />
              </div>
            </div>
            {(createdFrom || createdTo) && (
              <Button type="button" variant="outline" size="sm" onClick={clearDateRange}>
                Clear date range
              </Button>
            )}
          </div>
        </FilterChip>
        {props.trailingChips}
      </div>
    </div>
  )
}

/**
 * Push 3 (C3) — inline single-select search list used inside a
 * FilterChip popover. Unlike SearchableSelect, this renders an
 * always-visible search input + scrollable list (no nested
 * click-to-open trigger) — the chip itself is already the popover
 * trigger, so a second one would be confusing UX.
 *
 * Clicking an item:
 *   - selects it when not already active
 *   - clears the filter when re-clicking the current value
 *
 * "Any" affordance: clearing happens via the toggle behavior + the
 * filter bar's global "Clear all" button. No explicit "Any" row.
 */
function ChipSearchList({
  items,
  value,
  onChange,
  emptyMessage = "No results",
}: {
  items: { value: string; label: string; description?: string }[]
  value: string | null
  onChange: (v: string | null) => void
  emptyMessage?: string
}) {
  const [q, setQ] = useState("")
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(needle) ||
        (i.description ?? "").toLowerCase().includes(needle),
    )
  }, [items, q])

  return (
    <div className="w-56 space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-2">
        <Search className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
          }}
          placeholder="Search…"
          aria-label="Search options"
          className="h-7 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
      {visible.length === 0 ? (
        <p className="px-1 text-xs text-[var(--color-muted-foreground)]">{emptyMessage}</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto" role="listbox">
          {visible.map((item) => {
            const selected = item.value === value
            return (
              <li key={item.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(selected ? null : item.value)
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs",
                    selected
                      ? "bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]"
                      : "hover:bg-[var(--color-accent)]/50",
                  )}
                >
                  <span className="flex flex-col truncate">
                    <span className="truncate">{item.label}</span>
                    {item.description && (
                      <span className="text-3xs truncate text-[var(--color-muted-foreground)]">
                        {item.description}
                      </span>
                    )}
                  </span>
                  {selected && <Check className="size-3.5 shrink-0 text-[var(--color-primary)]" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Push 3 (C3) — inline multi-select search list for the Tags chip.
 * Click toggles each value in the values array. Search input filters
 * the option list.
 */
function ChipSearchMultiList({
  items,
  values,
  onChange,
}: {
  items: { value: string; label: string }[]
  values: string[]
  onChange: (next: string[]) => void
}) {
  const [q, setQ] = useState("")
  const selectedSet = useMemo(() => new Set(values), [values])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter((i) => i.label.toLowerCase().includes(needle))
  }, [items, q])

  function toggle(v: string) {
    if (selectedSet.has(v)) {
      onChange(values.filter((x) => x !== v))
    } else {
      onChange([...values, v])
    }
  }

  return (
    <div className="w-56 space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-2">
        <Search className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
          }}
          placeholder="Search tags…"
          aria-label="Search tags"
          className="h-7 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
      {visible.length === 0 ? (
        <p className="px-1 text-xs text-[var(--color-muted-foreground)]">No tags match.</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto" role="listbox" aria-multiselectable="true">
          {visible.map((item) => {
            const selected = selectedSet.has(item.value)
            return (
              <li key={item.value}>
                <label
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs",
                    "hover:bg-[var(--color-accent)]/50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      toggle(item.value)
                    }}
                    aria-label={item.label}
                  />
                  <span className="truncate">{item.label}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function FilterChip({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children: React.ReactNode
}) {
  const active = !!value
  return (
    <Popover
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={`flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 text-xs ${
            active
              ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
              : "border-[var(--color-border)]"
          }`}
        >
          <span>{label}</span>
          {active && (
            <>
              <span className="text-[var(--color-muted-foreground)]">:</span>
              <span className="font-medium">{value}</span>
            </>
          )}
        </button>
      )}
    >
      {children}
    </Popover>
  )
}
