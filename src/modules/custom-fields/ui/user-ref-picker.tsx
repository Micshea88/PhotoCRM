"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"

export interface UserOption {
  id: string
  name: string
  email: string
}

/**
 * Push 4 (A3) — single-select picker for user_ref custom fields.
 *
 * Two render modes (mirrors ContactRefPicker):
 *
 *   • Default — bordered Input + native `<select>` with "— None —".
 *   • Inline (`inlineMode=true`) — delegates to SearchableSelect with
 *     defaultOpen + inlineMode for the design-system inline-edit rule.
 */
export function UserRefPicker({
  id,
  options,
  value,
  onChange,
  disabled,
  inlineMode = false,
  onDismiss,
}: {
  id?: string
  options: UserOption[]
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  inlineMode?: boolean
  onDismiss?: () => void
}) {
  const [query, setQuery] = useState("")
  const sorted = useMemo(() => [...options].sort((a, b) => a.name.localeCompare(b.name)), [options])

  if (inlineMode) {
    const items = sorted.map((u) => ({
      value: u.id,
      label: u.name,
      description: u.email,
    }))
    return (
      <SearchableSelect
        id={id}
        items={items}
        value={value}
        onChange={onChange}
        placeholder="Search team members…"
        aria-label="Search team members"
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
    return sorted.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  })()

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
