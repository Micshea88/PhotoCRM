"use client"

import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Active-filter pill row (HubSpot pattern): each active filter shows as a pill
 * with an ✕ to remove just that one, plus an optional "Clear all filters" link.
 * Generic primitive — the caller supplies pre-formatted labels + remove
 * callbacks, so it's reusable by any filter strip (task today, Activity feed
 * per memory #12). Renders nothing when there are no pills.
 */
export interface FilterPillItem {
  key: string
  label: string
  onRemove: () => void
}

export function FilterPills({
  pills,
  onClearAll,
  className,
}: {
  pills: FilterPillItem[]
  onClearAll?: () => void
  className?: string
}) {
  if (pills.length === 0) return null
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      data-testid="filter-pills"
    >
      {pills.map((p) => (
        <span
          key={p.key}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-[11px] text-[var(--color-foreground)]"
        >
          {p.label}
          <button
            type="button"
            onClick={p.onRemove}
            aria-label={`Remove filter ${p.label}`}
            className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-[11px] text-[var(--color-primary)] hover:underline"
          data-testid="filter-clear-all"
        >
          Clear all filters
        </button>
      )}
    </div>
  )
}
