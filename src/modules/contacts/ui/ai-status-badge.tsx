"use client"

import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge, type BadgeCategory } from "@/components/ui/badge"
import { leadStatusCategory, type LeadStatusCategory } from "@/modules/contacts/ai/lead-status-enum"

/**
 * Push 3 (C6c) — AI lead-status badge, on the shared <Badge> primitive.
 *
 * A category pill with a small sparkles marker so users can tell AI-derived
 * fields from human-entered ones; the reasoning string surfaces via the badge's
 * native `title` tooltip. The free-form classifier output maps to the category
 * tier (canonical 19 → their category; anything else → neutral).
 */
const CATEGORY_TO_BADGE: Record<LeadStatusCategory, BadgeCategory | null> = {
  client: "client",
  lead: "lead",
  referral_partner: "blush",
  vendor: "vendor",
  other: null, // neutral
}

function pickCategory(status: string): LeadStatusCategory {
  // The classifier is free-form — try the canonical mapping first; free-form
  // output flows through `other`.
  try {
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
  const label = status ?? "No classification yet"
  const category = status ? CATEGORY_TO_BADGE[pickCategory(status)] : null
  const content = (
    <>
      <Sparkles className="size-3" aria-hidden="true" />
      <span className="font-medium">{label}</span>
    </>
  )
  const cls = cn("gap-1", className)
  if (category) {
    return (
      <Badge variant="category" category={category} className={cls} title={reasoning ?? undefined}>
        {content}
      </Badge>
    )
  }
  return (
    <Badge className={cls} title={reasoning ?? undefined}>
      {content}
    </Badge>
  )
}
