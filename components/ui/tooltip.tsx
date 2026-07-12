"use client"

import { type ReactNode } from "react"
import * as RadixTooltip from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

/**
 * Tooltip — reveals `label` above the wrapped element on hover / keyboard focus.
 *
 * PORTALED + collision-aware (Radix `Portal` → document.body, `collisionPadding`),
 * matching the filter-menu / snooze-popover pattern — so it is NEVER clipped by an
 * overflow container such as the bell notification dropdown. Dark-inverted styling
 * (foreground bg / background text) is the HubSpot/Salesforce/Asana convention.
 *
 * API unchanged: `<Tooltip label="…">{child}</Tooltip>`. The child is wrapped in a
 * span trigger so any element works (a plain button, an icon, etc.).
 */
export function Tooltip({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <RadixTooltip.Provider delayDuration={300}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          <span className={cn("inline-flex", className)}>{children}</span>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="top"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 rounded-md bg-[var(--color-foreground)] px-2 py-1 text-xs whitespace-nowrap text-[var(--color-background)] shadow-md select-none"
          >
            {label}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
