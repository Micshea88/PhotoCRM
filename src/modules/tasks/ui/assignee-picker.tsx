"use client"

import { Plus } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { SingleSelectMenu, type SingleSelectOption } from "@/components/ui/single-select-menu"
import { cn } from "@/lib/utils"

/**
 * Assignee picker for tasks (Mike-locked 2026-06-20). Single-assignee — one
 * org member or Unassigned. Built on the generic SingleSelectMenu + Avatar
 * primitives.
 *
 * Two trigger variants:
 *   - "avatar" (default): icon-only avatar — the row's click-to-reassign
 *     affordance (decision #4). Unassigned shows a greyed dashed "+" circle
 *     (decision #5).
 *   - "full": avatar + name in a bordered control — used inside the Add/Edit
 *     task forms.
 */
export interface AssigneeMember {
  id: string
  name: string
  image: string | null
}

const UNASSIGNED = "unassigned"

/** Presentational avatar for an assignee, or a greyed dashed "+" when null. */
export function AssigneeAvatar({
  member,
  size = 22,
}: {
  member: AssigneeMember | null
  size?: number
}) {
  if (member) return <Avatar name={member.name} image={member.image} size={size} />
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex items-center justify-center rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-muted-foreground)]"
      data-testid="assignee-empty"
    >
      <Plus className="size-3" />
    </span>
  )
}

export function AssigneePicker({
  members,
  value,
  onChange,
  variant = "avatar",
  size,
  align,
}: {
  members: AssigneeMember[]
  /** Selected member id, or null for Unassigned. */
  value: string | null
  onChange: (userId: string | null) => void
  variant?: "avatar" | "full"
  size?: number
  align?: "start" | "end"
}) {
  const selected = value ? (members.find((m) => m.id === value) ?? null) : null
  const options: SingleSelectOption[] = [
    ...members.map((m) => ({
      value: m.id,
      label: m.name,
      leading: <Avatar name={m.name} image={m.image} size={18} />,
    })),
    { value: UNASSIGNED, label: "Unassigned", dividerBefore: members.length > 0 },
  ]
  const avatarSize = size ?? (variant === "avatar" ? 22 : 18)
  // The row avatar sits on the right edge → align the panel to its right
  // (decision #2); forms read left-to-right → align to the start.
  const panelAlign = align ?? (variant === "avatar" ? "end" : "start")

  return (
    <SingleSelectMenu
      options={options}
      value={value ?? UNASSIGNED}
      onChange={(v) => {
        onChange(v === UNASSIGNED ? null : v)
      }}
      align={panelAlign}
      ariaLabel="Assign task"
      trigger={({ toggle }) =>
        variant === "full" ? (
          <button
            type="button"
            onClick={toggle}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-input)] px-2 text-sm hover:bg-[var(--color-accent)]/40"
            data-testid="task-assignee-trigger"
          >
            <AssigneeAvatar member={selected} size={avatarSize} />
            <span className={cn(selected ? "" : "text-[var(--color-muted-foreground)]")}>
              {selected ? selected.name : "Unassigned"}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={toggle}
            title={selected ? `Assigned to ${selected.name}` : "Unassigned"}
            aria-label={selected ? `Assigned to ${selected.name}` : "Assign task"}
            className="shrink-0 rounded-full"
            data-testid="task-assignee-trigger"
          >
            <AssigneeAvatar member={selected} size={avatarSize} />
          </button>
        )
      }
    />
  )
}
