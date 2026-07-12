import { Flag } from "lucide-react"

/**
 * The red flag shown next to High-priority task titles (Mike, 2026-06-19).
 * High is the only level that gets a marker — Low/Medium/none render nothing.
 * Shared across the contact Tasks tab and the dashboard task widgets.
 *
 * Pure presentational (no hooks) so it renders in server or client trees.
 */
export function HighPriorityFlag({ priority }: { priority: string | null }) {
  if (priority !== "high") return null
  return <Flag className="size-3.5 shrink-0 fill-red-600 text-red-600" aria-label="High priority" />
}
