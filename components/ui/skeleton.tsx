import { cn } from "@/lib/utils"

/**
 * Skeleton — content-shaped loading placeholder (design-system standard →
 * designed micro-states). A subtle editorial-ink pulse on the muted token,
 * `motion-safe` so it respects `prefers-reduced-motion`.
 *
 * Compose several to match a view's REAL layout (row heights, avatar circle,
 * text-line widths) — never one generic full-box. Spinners are for in-button
 * busy states only, not view-level loading.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-md bg-[var(--color-muted)] motion-safe:animate-pulse", className)}
    />
  )
}
