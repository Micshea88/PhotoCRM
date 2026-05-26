"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"

export interface UserOption {
  id: string
  name: string
  email: string
}

/**
 * Push 4 (A3) — single-select picker for user_ref custom fields.
 *
 * Built but NOT yet consumed by any host form. The CustomFieldsRenderer's
 * user_ref case wires it in via the optional `userOptions` prop; until
 * that prop is supplied (e.g., from Company / Opportunity / Project
 * forms in their respective UI pushes) the renderer falls back to its
 * legacy paste-an-id text input.
 *
 * UX: lightweight client-side filter input above a native `<select>`.
 * No server-side debounced search yet — the org-member list is bounded
 * (V1: ~10 members per org). When that ceiling becomes a real constraint
 * swap the select for a server-side typeahead the same way contacts/
 * pickers will when the contact list outgrows in-memory.
 */
export function UserRefPicker({
  id,
  options,
  value,
  onChange,
  disabled,
}: {
  id?: string
  options: UserOption[]
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState("")
  const sorted = useMemo(() => [...options].sort((a, b) => a.name.localeCompare(b.name)), [options])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return sorted
    return sorted.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [sorted, query])

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder="Search team members…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
        }}
        disabled={disabled}
        aria-label="Filter team members"
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
        {visible.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.email})
          </option>
        ))}
      </select>
    </div>
  )
}
