"use client"

import { useEffect, useState } from "react"
import { AiSummaryCard } from "./ai-summary-card"
import { AiInsightsCard } from "./ai-insights-card"
import { refreshContactAiSummary } from "@/modules/contacts/ai/refresh-summary"
import type { AiInsight } from "@/modules/contacts/ai/insights-detector"

/**
 * AI-summary freshness wrapper (client). Renders the AI summary + insights from
 * the server's cached values immediately, then — on mount when the server says
 * a refresh is due, and on a 1-hour interval while the page stays open — calls
 * `refreshContactAiSummary` and swaps the new content **in place via state**.
 * It deliberately does NOT call `router.refresh()`, so the rest of the contact
 * page (activity feed, tabs, scroll) never re-renders or flashes.
 *
 * The action self-gates (freshness check + 1-minute throttle), so calling it on
 * every mount + hourly is safe and cheap — it returns `unchanged`/`throttled`
 * without a Haiku call when nothing is due.
 *
 * Timestamps cross the server→client boundary as ISO strings (stable effect
 * deps); the summary card takes a Date.
 */
export function AiSummaryLive({
  contactId,
  initialSummary,
  initialGeneratedAt,
  initialGenerationModel,
  initialInsights,
  needsRefresh,
  rightSlot,
}: {
  contactId: string
  initialSummary: string | null
  /** ISO string or null. */
  initialGeneratedAt: string | null
  initialGenerationModel: string | null
  initialInsights: AiInsight[]
  needsRefresh: boolean
  rightSlot?: React.ReactNode
}) {
  const [summary, setSummary] = useState(initialSummary)
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt)
  const [generationModel, setGenerationModel] = useState(initialGenerationModel)
  const [insights, setInsights] = useState(initialInsights)
  const [refreshing, setRefreshing] = useState(false)

  // Adopting fresh SERVER values (e.g. after the manual Regenerate button's
  // router.refresh()) is handled by remounting — the page keys this component
  // on the server's generatedAt, so new server data gives fresh initial state.
  // Client-side swaps below update state directly without a remount.

  // Background refresh: on mount (when due) + every hour while open.
  useEffect(() => {
    let cancelled = false
    async function run() {
      setRefreshing(true)
      try {
        const res = await refreshContactAiSummary({ contactId })
        if (cancelled) return
        if (res.data?.status === "updated") {
          setSummary(res.data.aiSummaryText)
          setGeneratedAt(res.data.aiGeneratedAt)
          setGenerationModel(res.data.aiGenerationModel)
          setInsights(res.data.aiInsights)
        }
      } finally {
        if (!cancelled) setRefreshing(false)
      }
    }
    if (needsRefresh) void run()
    const interval = setInterval(() => void run(), 60 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [contactId, needsRefresh])

  return (
    <div className="space-y-4">
      <AiSummaryCard
        summary={summary}
        generatedAt={generatedAt ? new Date(generatedAt) : null}
        generationModel={generationModel}
        rightSlot={rightSlot}
        refreshing={refreshing}
      />
      <AiInsightsCard insights={insights} />
    </div>
  )
}
