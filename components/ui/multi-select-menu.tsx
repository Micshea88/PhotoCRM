"use client"

import { Fragment, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Generic multi-select dropdown: a labeled button that opens a checkbox list
 * (HubSpot filter pattern). OR-within-the-list selection. A reusable primitive
 * (no domain logic) — the task filter strip uses it for Event / Status /
 * Priority / Assigned-to today; the contact Activity feed filter strip
 * (memory #12) will reuse it as-is.
 *
 * `dividerBefore` draws a separator above an option (e.g. before the "No
 * priority" / "Unassigned" sentinels). `leading` renders a node before the
 * label (e.g. an Avatar in the assignee menu).
 */
export interface MultiSelectOption {
  value: string
  label: string
  leading?: ReactNode
  dividerBefore?: boolean
}

export function MultiSelectMenu({
  label,
  options,
  values,
  onChange,
  align = "start",
  testId,
}: {
  label: string
  options: MultiSelectOption[]
  values: string[]
  onChange: (values: string[]) => void
  align?: "start" | "end"
  testId?: string
}) {
  const active = values.length > 0
  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value])
  }
  return (
    <Popover
      align={align}
      className="min-w-[200px] p-1"
      trigger={({ open, toggle: toggleOpen }) => (
        <button
          type="button"
          onClick={toggleOpen}
          data-testid={testId}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors",
            active
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/40",
          )}
        >
          <span>{label}</span>
          {active && (
            <span className="rounded-full bg-[var(--color-primary)]/10 px-1.5 text-[11px] tabular-nums">
              {values.length}
            </span>
          )}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      <ul role="listbox" aria-multiselectable aria-label={label} className="space-y-0.5">
        {options.map((o) => (
          <Fragment key={o.value}>
            {o.dividerBefore && <li className="my-1 border-t border-[var(--color-border)]" />}
            <li>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--color-accent)]/40">
                <input
                  type="checkbox"
                  checked={values.includes(o.value)}
                  onChange={() => {
                    toggle(o.value)
                  }}
                  className="size-4 shrink-0"
                />
                {o.leading}
                <span className="truncate">{o.label}</span>
              </label>
            </li>
          </Fragment>
        ))}
      </ul>
    </Popover>
  )
}
