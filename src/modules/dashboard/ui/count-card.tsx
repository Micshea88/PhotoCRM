import { cn } from "@/lib/utils"

export interface CountCardProps {
  label: string
  count: number
  hint?: string
  className?: string
}

/**
 * Compact summary card for a dashboard count. Used for "Open
 * opportunities," "Projects this month," and "Tasks due this week."
 * Per LOC1, the label is plain language; if the count is zero we
 * still show the number (no "—" or "N/A") and a hint that's a
 * concrete next step.
 */
export function CountCard({ label, count, hint, className }: CountCardProps) {
  return (
    <article
      className={cn("space-y-2 rounded-lg border border-[var(--color-border)] p-4", className)}
    >
      <h2 className="text-sm font-medium text-[var(--color-muted-foreground)]">{label}</h2>
      <p className="font-serif text-3xl font-semibold tabular-nums">{count}</p>
      {hint ? <p className="text-xs text-[var(--color-muted-foreground)]">{hint}</p> : null}
    </article>
  )
}
