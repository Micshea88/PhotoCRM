"use client"

import { Fragment, type ReactNode } from "react"
import { Check } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Generic single-select dropdown: one labeled list of options where picking a
 * value closes the menu (radio semantics). Sibling to MultiSelectMenu — same
 * `leading` / `dividerBefore` option shape — but single-value. The trigger is
 * fully customizable via the `trigger` render-prop so the same primitive backs
 * a labeled button, an avatar, etc. Reusable (no domain logic): the task
 * assignee picker uses it today.
 *
 * `value` is the currently-selected option value (or null). Picking the
 * already-selected value re-selects it (no toggle-off here — callers that need
 * a "clear" provide an explicit option such as an "Unassigned" sentinel).
 */
export interface SingleSelectOption {
  value: string
  label: string
  leading?: ReactNode
  dividerBefore?: boolean
}

export function SingleSelectMenu({
  options,
  value,
  onChange,
  trigger,
  align = "start",
  className,
  ariaLabel,
}: {
  options: SingleSelectOption[]
  value: string | null
  onChange: (value: string) => void
  /** Render the trigger element; receives the open state + a toggle callback. */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
  align?: "start" | "end"
  className?: string
  ariaLabel?: string
}) {
  return (
    <Popover align={align} className={cn("min-w-[200px] p-1", className)} trigger={trigger}>
      {({ close }) => (
        <ul role="listbox" aria-label={ariaLabel} className="space-y-0.5">
          {options.map((o) => {
            const selected = o.value === value
            return (
              <Fragment key={o.value}>
                {o.dividerBefore && <li className="my-1 border-t border-[var(--color-border)]" />}
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(o.value)
                      close()
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none active:bg-[var(--state-active)]",
                      selected &&
                        "bg-[var(--state-selected)] font-medium text-[var(--state-selected-foreground)]",
                    )}
                  >
                    {o.leading}
                    <span className="flex-1 truncate">{o.label}</span>
                    {selected && (
                      <Check className="size-3.5 shrink-0 text-[var(--state-selected-foreground)]" />
                    )}
                  </button>
                </li>
              </Fragment>
            )
          })}
        </ul>
      )}
    </Popover>
  )
}
