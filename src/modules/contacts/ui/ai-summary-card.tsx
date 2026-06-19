"use client"

import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6c) — AI summary card.
 *
 * Renders the cached `ai_summary_text` paragraph with a header and a
 * "Last regenerated X ago" footer. The Regenerate button is rendered
 * by the host page (RegenerateAiButton.tsx) so we don't couple this
 * card to the regenerate server action.
 *
 * Falls back to a neutral empty state when no summary has been
 * cached (first view before regenerate fires).
 */
/** Relative freshness label: "just now" under a minute, then "Nm/Nh/Nd ago". */
function timeAgo(timestamp: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp.getTime()) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  const days = Math.floor(hours / 24)
  return `${String(days)}d ago`
}

export function AiSummaryCard({
  summary,
  generatedAt,
  generationModel,
  rightSlot,
  className,
  refreshing = false,
}: {
  summary: string | null
  generatedAt: Date | null
  /** Identifier for the model that produced the cache. Renders as a
   *  small footer label ("via claude-haiku-4-5-20251001" /
   *  "via rules-engine@1"). */
  generationModel: string | null
  /** Slot for the Regenerate button or other actions. */
  rightSlot?: React.ReactNode
  className?: string
  /** True while a background freshness refresh is in flight — shows a
   *  subtle "Refreshing…" note in the footer. */
  refreshing?: boolean
}) {
  // P3 polish #5 Fix 4c — de-card. AI-generated content reads as
  // part of the page; only the heading + body + footer remain. No
  // outer border, no rounded card, no background. Internal padding
  // preserves breathing room within the center column.
  return (
    <section className={cn("space-y-2 px-1 py-1", className)} data-testid="ai-summary-card">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--color-primary)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold">AI summary</h2>
        </div>
        {rightSlot}
      </header>
      {summary ? (
        <p className="text-sm leading-relaxed">{summary}</p>
      ) : (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No summary cached yet — click Regenerate to produce one.
        </p>
      )}
      <footer className="text-[11px] text-[var(--color-muted-foreground)]">
        {generatedAt ? `Updated ${timeAgo(generatedAt)}` : "Not generated yet"}
        {generationModel && <span className="ml-1 opacity-70">· via {generationModel}</span>}
        {refreshing && <span className="ml-1 opacity-70">· Refreshing…</span>}
      </footer>
    </section>
  )
}
