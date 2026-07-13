import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * EmptyState — the considered empty state (design-system standard → designed
 * micro-states). Quiet icon + a real title + a supporting line + an optional
 * REAL CTA button where an action makes sense. Never a bare "No data" one-liner
 * or a text-only hint.
 *
 * Centered, on the 8px grid, serif title (editorial register). The icon is
 * decorative (muted, aria-hidden); pass a lucide icon sized ~`size-6`.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="mb-1 text-[var(--color-muted-foreground)]">
          {icon}
        </span>
      )}
      <p className="font-serif text-lg text-[var(--color-foreground)]">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-[var(--color-muted-foreground)]">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
