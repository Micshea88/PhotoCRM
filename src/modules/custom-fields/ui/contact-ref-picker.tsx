"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"

export interface ContactOption {
  id: string
  firstName: string
  lastName: string
  primaryEmail?: string | null
}

/**
 * Push 4 (A3) — single-select picker for contact_ref custom fields.
 *
 * Two render modes:
 *
 *   • Default (`inlineMode=false`) — bordered Input + native `<select>`
 *     with a "— None —" sentinel. Used by the contact form and the
 *     custom-fields renderer.
 *
 *   • Inline (`inlineMode=true`) — delegates to SearchableSelect with
 *     `defaultOpen` + `inlineMode`. Matches the C6c design-system
 *     "no box, underline only" rule for inline-edit surfaces (see
 *     docs/pathway-design-system.md §1 callout).
 */
export function ContactRefPicker({
  id,
  options,
  value,
  onChange,
  disabled,
  inlineMode = false,
  onDismiss,
}: {
  id?: string
  options: ContactOption[]
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  /** P3 (C6c polish #3) — render as a SearchableSelect with
   *  defaultOpen + inlineMode so the picker sits inside an
   *  InlineEditSelect without bordered chrome. */
  inlineMode?: boolean
  /** Forwarded to SearchableSelect.onDismiss in inlineMode. Lets
   *  InlineEditSelect autosave the current draft on click-outside /
   *  Esc. */
  onDismiss?: () => void
}) {
  const [query, setQuery] = useState("")

  const sorted = useMemo(() => {
    return [...options].sort((a, b) => {
      const an = `${a.firstName} ${a.lastName}`
      const bn = `${b.firstName} ${b.lastName}`
      return an.localeCompare(bn)
    })
  }, [options])

  if (inlineMode) {
    const items = sorted.map((c) => {
      const name = `${c.firstName} ${c.lastName}`.trim()
      return {
        value: c.id,
        label: name || "(no name)",
        description: c.primaryEmail ?? undefined,
      }
    })
    return (
      <SearchableSelect
        id={id}
        items={items}
        value={value}
        onChange={onChange}
        placeholder="Search contacts…"
        aria-label="Search contacts"
        defaultOpen
        inlineMode
        onDismiss={onDismiss}
        disabled={disabled}
      />
    )
  }

  const visible = (() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return sorted
    return sorted.filter((c) => {
      const name = `${c.firstName} ${c.lastName}`.toLowerCase()
      const email = (c.primaryEmail ?? "").toLowerCase()
      return name.includes(q) || email.includes(q)
    })
  })()

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder="Search contacts…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
        }}
        disabled={disabled}
        aria-label="Filter contacts"
      />
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value === "" ? null : e.target.value)
        }}
        className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
      >
        <option value="">— None —</option>
        {visible.map((c) => {
          const name = `${c.firstName} ${c.lastName}`.trim()
          const email = c.primaryEmail ? ` (${c.primaryEmail})` : ""
          return (
            <option key={c.id} value={c.id}>
              {name}
              {email}
            </option>
          )
        })}
      </select>
    </div>
  )
}
