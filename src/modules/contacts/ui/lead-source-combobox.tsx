"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { LEAD_SOURCE_DEFAULTS } from "@/modules/lead-sources/types"

/**
 * Lead-source picker. Dropdown of (seeded defaults) + (any custom
 * values currently in use by other contacts), with an "+ Add new…"
 * option at the bottom that reveals an inline text input for the
 * user to type a brand-new value.
 *
 * One source of truth, used in two places:
 *   - The /contacts/new form's Lead source field
 *   - The /contacts filter chip's value picker
 *
 * Empty string means "no value selected" (or "Any" in the filter
 * context — the consumer interprets).
 */
export function LeadSourceCombobox({
  id,
  value,
  onChange,
  existingValues,
  hiddenSources = [],
  allowAnyOption = false,
  anyLabel = "— None —",
  inlineMode = false,
  onDismiss,
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  /** Custom values currently in use on real contacts. Merged with
   * defaults; duplicates collapse case-insensitively. */
  existingValues: string[]
  /** Sources the org has hidden via /settings/lead-sources. Filtered
   * from the visible options (case-insensitive). The currently-selected
   * value is NEVER filtered — if a contact already carries a hidden
   * value, the user must still see + be able to keep it. */
  hiddenSources?: string[]
  /** If true, renders an "Any" / "None" sentinel at the top of the
   * list with value="". Used by the filter chip; the form does NOT
   * set this. */
  allowAnyOption?: boolean
  anyLabel?: string
  /** P3 (C6c polish #3) — render as a SearchableSelect with
   *  defaultOpen + inlineMode for inline-edit surfaces. The
   *  "+ Add new" affordance is omitted in inline mode; use the
   *  full edit form to add a brand-new lead source. */
  inlineMode?: boolean
  onDismiss?: () => void
}) {
  const [addingNew, setAddingNew] = useState(false)
  const [newValue, setNewValue] = useState("")

  // Compute the unfiltered options list before the inlineMode short-
  // circuit. inlineMode is fixed across the component's lifetime by
  // the parent (never flips at runtime), so the conditional return
  // below doesn't break the hooks-order invariant in practice.
  const options = useMemo(() => {
    const hiddenLower = new Set(hiddenSources.map((s) => s.toLowerCase()))
    const seen = new Set<string>()
    const out: string[] = []
    for (const d of LEAD_SOURCE_DEFAULTS) {
      seen.add(d.toLowerCase())
      if (!hiddenLower.has(d.toLowerCase())) out.push(d)
    }
    const customs = existingValues
      .filter((v) => v && !seen.has(v.toLowerCase()) && !hiddenLower.has(v.toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
    return [...out, ...customs]
  }, [existingValues, hiddenSources])

  if (inlineMode) {
    const items = options.map((o) => ({ value: o, label: o }))
    // Mike's spec: drop the "— None —" sentinel + the inline "+ Add new"
    // affordance in inlineMode. Use the full edit form for those.
    return (
      <SearchableSelect
        id={id}
        items={items}
        value={value || null}
        onChange={(next) => {
          onChange(next ?? "")
        }}
        placeholder="Search lead sources…"
        aria-label="Lead source"
        defaultOpen
        inlineMode
        onDismiss={onDismiss}
        allowClear
      />
    )
  }

  if (addingNew) {
    return (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={newValue}
          autoFocus
          placeholder="Enter custom source…"
          onChange={(e) => {
            setNewValue(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              const v = newValue.trim()
              if (v) onChange(v)
              setAddingNew(false)
              setNewValue("")
            }
            if (e.key === "Escape") {
              setAddingNew(false)
              setNewValue("")
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const v = newValue.trim()
            if (v) onChange(v)
            setAddingNew(false)
            setNewValue("")
          }}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAddingNew(false)
            setNewValue("")
          }}
        >
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <select
      id={id}
      className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
      value={value}
      onChange={(e) => {
        if (e.target.value === "__add_new__") {
          setAddingNew(true)
          return
        }
        onChange(e.target.value)
      }}
    >
      {allowAnyOption && <option value="">{anyLabel}</option>}
      {!allowAnyOption && !value && (
        <option value="" disabled>
          Select a lead source
        </option>
      )}
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
      {value && !options.some((o) => o.toLowerCase() === value.toLowerCase()) && (
        <option key={value} value={value}>
          {value}
        </option>
      )}
      <option value="__add_new__">+ Add new…</option>
    </select>
  )
}
