"use client"

import { useCallback, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CONTACT_TYPES, LIFECYCLE_STATUSES } from "../types"

export interface FilterBarProps {
  tagOptions: string[]
  ownerOptions: { id: string; name: string | null; email: string }[]
  companyOptions: { id: string; name: string }[]
  leadSourceOptions: string[]
}

/**
 * Sticky filter bar for /contacts. Owns the search box + 7 filter chips.
 * State lives entirely in URL search params — onChange updates the URL,
 * which triggers a server re-render with new filtered data.
 *
 * Filter chips collapse into native `<details>` widgets so the sub-panel
 * UX works without a popover library. Each chip's `<summary>` shows the
 * applied value when set; clicking the summary opens/closes the panel.
 */
export function ContactsFilterBar(props: FilterBarProps) {
  const router = useRouter()
  const params = useSearchParams()
  const [, startTransition] = useTransition()
  const [searchInput, setSearchInput] = useState(params.get("q") ?? "")

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
          className="flex-1"
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
          <select
            className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
            value={activeContactType}
            onChange={(e) => {
              updateParam("contactType", e.target.value || null)
            }}
          >
            <option value="">— Any —</option>
            {CONTACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FilterChip>

        <FilterChip label="Lifecycle status" value={activeLifecycle}>
          <select
            className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
            value={activeLifecycle}
            onChange={(e) => {
              updateParam("lifecycleStatus", e.target.value || null)
            }}
          >
            <option value="">— Any —</option>
            {LIFECYCLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
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
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {props.tagOptions.map((tag) => {
                const checked = activeTags.includes(tag)
                return (
                  <label key={tag} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...activeTags, tag]
                          : activeTags.filter((t) => t !== tag)
                        updateParam("tags", next)
                      }}
                    />
                    {tag}
                  </label>
                )
              })}
            </div>
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
          <select
            className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
            value={activeOwner}
            onChange={(e) => {
              updateParam("ownerUserId", e.target.value || null)
            }}
          >
            <option value="">— Any —</option>
            {props.ownerOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name ?? o.email}
              </option>
            ))}
          </select>
        </FilterChip>

        <FilterChip
          label="Company"
          value={
            activeCompany
              ? (props.companyOptions.find((c) => c.id === activeCompany)?.name ?? activeCompany)
              : ""
          }
        >
          <select
            className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
            value={activeCompany}
            onChange={(e) => {
              updateParam("companyId", e.target.value || null)
            }}
          >
            <option value="">— Any —</option>
            {props.companyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FilterChip>

        <FilterChip label="Lead source" value={activeLeadSource}>
          {props.leadSourceOptions.length === 0 ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              No lead sources yet. Set lead source on a contact to filter by it.
            </p>
          ) : (
            <select
              className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
              value={activeLeadSource}
              onChange={(e) => {
                updateParam("leadSource", e.target.value || null)
              }}
            >
              <option value="">— Any —</option>
              {props.leadSourceOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
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
      </div>
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
    <details className="relative">
      <summary
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
      </summary>
      <div className="absolute top-full left-0 z-10 mt-1 min-w-[240px] rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 shadow-md">
        {children}
      </div>
    </details>
  )
}
