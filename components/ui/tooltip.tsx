import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Lightweight CSS-only tooltip (no JS/state) — reveals `label` above the
 * wrapped element on hover or keyboard focus. Replaces the native `title`
 * attribute, which is slow (~1–2s), unreliable, and OS-styled.
 *
 * Implementation notes:
 *   - Named group (`group/tooltip`) so it won't trigger off the row-level
 *     `group` hover already used elsewhere (e.g. the contact Tasks pane row).
 *   - 300ms APPEAR delay via `transition-delay` on the hover/focus state;
 *     instant on leave (base state carries no delay) so it doesn't linger.
 *   - Positioned above, centered (`bottom-full`), `whitespace-nowrap`.
 *   - Dark-inverted styling (foreground bg / background text) — the
 *     HubSpot/Salesforce/Asana/ClickUp convention.
 *   - `role="tooltip"` + reveal on `group-focus-within` for keyboard users.
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
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2 rounded-md bg-[var(--color-foreground)] px-2 py-1 text-xs whitespace-nowrap text-[var(--color-background)] opacity-0 shadow-md transition-opacity duration-100 group-focus-within/tooltip:opacity-100 group-focus-within/tooltip:delay-300 group-hover/tooltip:opacity-100 group-hover/tooltip:delay-300"
      >
        {label}
      </span>
    </span>
  )
}
