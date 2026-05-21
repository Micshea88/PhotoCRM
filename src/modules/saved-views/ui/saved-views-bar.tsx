"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

export interface SavedViewChip {
  id: string
  name: string
  isDefault: boolean
}

/**
 * PUSH 2a chip bar — read-only. Renders each saved view as a chip;
 * clicking a non-active chip navigates with its applied query (empty
 * for the seeded "All Contacts" default). The active chip is the one
 * whose id matches `?view=<id>` OR — when no `view` param is set —
 * the row marked `isDefault`.
 *
 * PUSH 2b ships the CRUD UX (Save as / Rename / Duplicate / Delete) +
 * the diff indicator ("Save current view as..." appears when applied
 * filters differ from saved spec).
 */
export function SavedViewsBar({ views }: { views: SavedViewChip[] }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const activeId = params.get("view") ?? views.find((v) => v.isDefault)?.id ?? null

  if (views.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3">
      <span className="text-xs text-[var(--color-muted-foreground)]">Views:</span>
      {views.map((v) => {
        const isActive = v.id === activeId
        const href =
          v.id === activeId ? `${pathname}?${params.toString()}` : `${pathname}?view=${v.id}`
        return (
          <Link
            key={v.id}
            href={href}
            className={`rounded-full border px-3 py-1 text-xs ${
              isActive
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 font-medium"
                : "border-[var(--color-border)] hover:bg-[var(--color-accent)]"
            }`}
          >
            {v.name}
          </Link>
        )
      })}
    </div>
  )
}
