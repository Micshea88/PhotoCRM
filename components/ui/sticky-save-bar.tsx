"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * StickySaveBar — the shared dirty-state commit surface.
 *
 * Best-in-class pattern (shadcn/Radix, Primer, Cloudscape, Mirakl): pin save
 * actions to the BOTTOM of the content area, never a cramped panel card that
 * clips its own buttons. Full width of the content area, offset past the app nav
 * via the inherited `--sidebar-w` on `lg` (above the mobile bottom-nav below it),
 * so it never overlaps the nav and never truncates its actions.
 *
 * Render it ONLY on a real dirty diff. Status text is left, actions right. The
 * internal rhythm uses the shared commit-spacing token (`--space-commit-bottom`);
 * the in-flow `<CommitBar>` primitive owns the same tokens for non-pinned forms.
 * Reusable by the merge screen and any future save surface.
 */
export function StickySaveBar({
  status,
  actions,
  className,
}: {
  status: ReactNode
  actions: ReactNode
  className?: string
}) {
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className={cn(
        "fixed right-0 bottom-16 left-0 z-40 lg:bottom-0 lg:left-[var(--sidebar-w)]",
        "border-t border-[var(--color-border)] bg-[var(--color-popover)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)]",
        "motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200",
        className,
      )}
    >
      <div
        className="flex items-center justify-between gap-4 px-6"
        style={{
          paddingTop: "calc(var(--space-commit-bottom) / 2)",
          paddingBottom: "calc(var(--space-commit-bottom) / 2)",
        }}
      >
        <div className="min-w-0 truncate text-sm text-[var(--color-foreground)]">{status}</div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </div>
  )
}
