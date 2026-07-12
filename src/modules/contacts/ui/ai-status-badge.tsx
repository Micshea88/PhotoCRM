"use client"

import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { leadStatusCategory, type LeadStatusCategory } from "@/modules/contacts/ai/lead-status-enum"

/**
 * Push 3 (C6c) — AI lead-status badge.
 *
 * Renders the cached `ai_lead_status` value with a small sparkles
 * marker (so users can tell at a glance which fields are AI-derived
 * vs human-entered). Color comes from the category map in
 * lead-status-enum.ts when the value matches one of the canonical 19;
 * otherwise the badge uses the neutral "other" palette since C6b
 * classifier output is free-form (Haiku may return anything reasonable).
 *
 * The reasoning string lives in the badge's `title` attribute so
 * hover surfaces it without needing a dedicated tooltip primitive.
 */
const CATEGORY_CLASSES: Record<LeadStatusCategory, string> = {
  client: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  lead: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  referral_partner: "bg-violet-500/10 text-violet-700 border-violet-500/30",
  vendor: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  other:
    "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] border-[var(--color-border)]",
}

function pickCategory(status: string): LeadStatusCategory {
  // The classifier is free-form — try the canonical mapping first;
  // free-form output flows through `other`.
  try {
    // leadStatusCategory expects a LeadStatus type narrow; we cast at
    // the boundary and rely on the function's exhaustive switch to
    // return "other" only if it hits the explicit Uncategorized case.
    return leadStatusCategory(status as Parameters<typeof leadStatusCategory>[0])
  } catch {
    return "other"
  }
}

export function AiStatusBadge({
  status,
  reasoning,
  className,
}: {
  status: string | null
  reasoning: string | null
  className?: string
}) {
  if (!status) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
          CATEGORY_CLASSES.other,
          className,
        )}
      >
        <Sparkles className="size-3" aria-hidden="true" />
        <span>No classification yet</span>
      </span>
    )
  }
  const category = pickCategory(status)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        CATEGORY_CLASSES[category],
        className,
      )}
      title={reasoning ?? undefined}
      data-testid="ai-status-badge"
    >
      <Sparkles className="size-3" aria-hidden="true" />
      <span className="font-medium">{status}</span>
    </span>
  )
}
