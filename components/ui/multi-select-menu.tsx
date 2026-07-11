"use client"

import { Fragment, useId, useState, type ReactNode } from "react"
import { ChevronDown, Search } from "lucide-react"
import * as RadixPopover from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"

/**
 * Generic multi-select dropdown: a labeled button that opens a checkbox list
 * (HubSpot filter pattern). OR-within-the-list selection. A reusable primitive
 * (no domain logic) — the task / contact / notification filter strips reuse it.
 *
 * PORTALED (Radix Popover.Portal + collision handling): the option list renders
 * into `document.body`, so it is NOT clipped or mis-anchored when the menu lives
 * inside an `overflow` container such as the bell notification dropdown.
 *
 * Optional GROUPING (`sections`) renders section headers (role="group"); a flat
 * `options` list renders headerless (back-compatible). Optional `searchable`
 * adds a type-ahead input that filters options by label across all sections.
 *
 * `dividerBefore` draws a separator above an option. `leading` renders a node
 * before the label (e.g. an Avatar in the assignee menu).
 */
export interface MultiSelectOption {
  value: string
  label: string
  leading?: ReactNode
  dividerBefore?: boolean
}

export interface MultiSelectSection {
  label: string
  options: MultiSelectOption[]
}

export function MultiSelectMenu({
  label,
  options,
  sections,
  values,
  onChange,
  align = "start",
  testId,
  searchable = false,
  searchPlaceholder = "Search…",
}: {
  label: string
  /** Flat list (headerless). Provide this OR `sections`. */
  options?: MultiSelectOption[]
  /** Grouped list with section headers. Takes precedence over `options`. */
  sections?: MultiSelectSection[]
  values: string[]
  onChange: (values: string[]) => void
  align?: "start" | "end"
  testId?: string
  searchable?: boolean
  searchPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const groupId = useId()
  const active = values.length > 0

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value])
  }

  // Normalize to sections. A flat `options` list becomes one unlabeled section.
  const baseSections: MultiSelectSection[] = sections ?? [{ label: "", options: options ?? [] }]
  const q = query.trim().toLowerCase()
  const shown = baseSections
    .map((s) => ({
      ...s,
      options: q ? s.options.filter((o) => o.label.toLowerCase().includes(q)) : s.options,
    }))
    .filter((s) => s.options.length > 0)

  function renderOption(o: MultiSelectOption) {
    return (
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
    )
  }

  return (
    <RadixPopover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
    >
      <RadixPopover.Trigger asChild>
        <button
          type="button"
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
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 flex max-h-[min(420px,70vh)] min-w-[220px] flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-1 shadow-lg"
          onCloseAutoFocus={(e) => {
            e.preventDefault()
          }}
          onOpenAutoFocus={
            searchable
              ? undefined
              : (e) => {
                  e.preventDefault()
                }
          }
        >
          {searchable && (
            <div className="mb-1 flex items-center gap-1.5 border-b border-[var(--color-border)] px-2 pb-1">
              <Search className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                }}
                placeholder={searchPlaceholder}
                aria-label={`Search ${label}`}
                data-testid={testId ? `${testId}-search` : undefined}
                className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-[var(--color-muted-foreground)]"
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {shown.length === 0 ? (
              <div className="px-2 py-3 text-center text-sm text-[var(--color-muted-foreground)]">
                No matches
              </div>
            ) : (
              shown.map((section, si) => {
                const headerId = `${groupId}-${String(si)}`
                return (
                <div
                  key={section.label || headerId}
                  role="group"
                  aria-labelledby={section.label ? headerId : undefined}
                  aria-label={section.label ? undefined : label}
                >
                  {section.label && (
                    <div
                      id={headerId}
                      className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase"
                    >
                      {section.label}
                    </div>
                  )}
                  <ul className="space-y-0.5">{section.options.map(renderOption)}</ul>
                </div>
                )
              })
            )}
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
