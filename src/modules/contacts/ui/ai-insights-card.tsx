"use client"

import Link from "next/link"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AiInsight, InsightAction } from "@/modules/contacts/ai/insights-detector"

/**
 * Push 3 (C6c) — AI insights cards.
 *
 * Reads the cached `ai_insights_json.insights[]` shape produced by
 * detectInsights (C6b). Each card surfaces title + text + action
 * buttons. The host hides the entire section when insights is empty,
 * so this component just bails on no insights.
 *
 * Action button styling per autonomous default C:
 *   - navigate     → primary blue button
 *   - compose_email → secondary outline
 *   - create_task   → secondary outline
 *
 * "navigate" actions render as Next.js Link so client-side routing
 * works. Other action kinds are placeholders — V1 logs a console
 * stub since the compose/task surfaces haven't shipped yet. Future
 * commits wire them to real actions.
 */
export function AiInsightsCard({
  insights,
  className,
}: {
  insights: AiInsight[]
  className?: string
}) {
  if (insights.length === 0) return null
  return (
    <section
      className={cn(
        "space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4",
        className,
      )}
      data-testid="ai-insights-card"
    >
      <header className="flex items-center gap-2">
        <Sparkles className="size-4 text-[var(--color-primary)]" aria-hidden="true" />
        <h2 className="text-sm font-semibold">AI insights</h2>
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {String(insights.length)}
        </span>
      </header>
      <ul className="space-y-3">
        {insights.map((insight) => (
          <li
            key={insight.kind}
            className="space-y-2 rounded-md border border-[var(--color-border)]/60 p-3"
          >
            <div>
              <p className="text-sm font-medium">{insight.title}</p>
              <p className="text-sm text-[var(--color-muted-foreground)]">{insight.text}</p>
            </div>
            {insight.actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {insight.actions.map((action, idx) => (
                  <InsightActionButton key={`${insight.kind}-${String(idx)}`} action={action} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function InsightActionButton({ action }: { action: InsightAction }) {
  if (action.kind === "navigate") {
    return (
      <Button asChild size="sm">
        <Link href={action.payload}>{action.label}</Link>
      </Button>
    )
  }
  // compose_email / create_task — placeholders. The action's payload
  // is the contract for whatever future module wires them up.
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        // V1 — surface "coming soon" client-side. Replaced when the
        // compose/task modals land.
        if (typeof window !== "undefined") {
          window.alert(`${action.label} — coming soon. Payload: ${action.payload}`)
        }
      }}
    >
      {action.label}
    </Button>
  )
}
