"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"

export interface ContactOption {
  id: string
  firstName: string
  lastName: string
  primaryEmail?: string | null
}

/**
 * Push 4 (A3) — single-select picker for contact_ref custom fields.
 *
 * Built but NOT yet consumed by any host form. The CustomFieldsRenderer's
 * contact_ref case wires it in via the optional `contactOptions` prop;
 * until that prop is supplied the renderer falls back to its legacy
 * paste-an-id text input.
 *
 * UX: lightweight client-side filter input above a native `<select>`,
 * matching UserRefPicker. Server-side debounced search lands when the
 * contact list outgrows in-memory render (sub-1k contacts handles fine
 * via this path).
 */
export function ContactRefPicker({
  id,
  options,
  value,
  onChange,
  disabled,
}: {
  id?: string
  options: ContactOption[]
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState("")
  const sorted = useMemo(() => {
    return [...options].sort((a, b) => {
      const an = `${a.firstName} ${a.lastName}`
      const bn = `${b.firstName} ${b.lastName}`
      return an.localeCompare(bn)
    })
  }, [options])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return sorted
    return sorted.filter((c) => {
      const name = `${c.firstName} ${c.lastName}`.toLowerCase()
      const email = (c.primaryEmail ?? "").toLowerCase()
      return name.includes(q) || email.includes(q)
    })
  }, [sorted, query])

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
