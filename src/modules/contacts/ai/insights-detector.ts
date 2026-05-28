import type { LeadStatus } from "./lead-status-enum"

/**
 * Push 3 (C6b) — deterministic insights detector.
 *
 * Per autonomous default E, the 3 V1 insight types are pure
 * heuristics computed from precomputed facts. AI doesn't write
 * insights in V1 — the rules below ARE the AI insight (just framed
 * as actionable cards on the detail page).
 *
 * The thresholds are locked:
 *   - cold_reengage: ai_lead_status in {Cold Lead, Unresponsive Lead}
 *     AND days_since_last_contact > 30
 *   - vip_detect: not already tagged "VIP" AND
 *     (booking_count >= 3 OR highest_proposal_value > org_avg * 1.5)
 *   - referrer_gap: contact has >= 5 referrals where NONE
 *     converted to a booked event
 *
 * Each insight has a `kind`, a short `text` (single sentence), and a
 * default action shape the detail page renders as a button. Action
 * "kind" maps to button styles per default C (navigate=primary,
 * compose_email=outline, create_task=outline).
 */

export type InsightActionKind = "navigate" | "compose_email" | "create_task"
export interface InsightAction {
  kind: InsightActionKind
  label: string
  /** For "navigate": href. For others: hint payload the host can dispatch. */
  payload: string
}

export interface AiInsight {
  kind: "cold_reengage" | "vip_detect" | "referrer_gap"
  title: string
  text: string
  actions: InsightAction[]
}

export interface InsightFacts {
  contactId: string
  aiLeadStatus: LeadStatus | null
  tags: string[]
  bookingCount: number
  /** Cents. */
  highestProposalValue: number
  /** Cents. Average proposal value across all booked contacts in the
   *  org. Used by the VIP detection rule. */
  orgAvgProposalValue: number
  daysSinceLastContact: number | null
  referralsMade: number
  referralsWhoBooked: number
}

/**
 * Returns the insight cards that should appear on this contact's
 * Overview tab. Empty array when no rule fires (the host hides the
 * "Insights" panel when empty).
 */
export function detectInsights(facts: InsightFacts): AiInsight[] {
  const out: AiInsight[] = []
  const tagsLower = new Set(facts.tags.map((t) => t.toLowerCase()))

  // Cold lead re-engagement
  const isCold = facts.aiLeadStatus === "Cold Lead" || facts.aiLeadStatus === "Unresponsive Lead"
  if (isCold && facts.daysSinceLastContact !== null && facts.daysSinceLastContact > 30) {
    out.push({
      kind: "cold_reengage",
      title: "Re-engage opportunity",
      text: `${String(facts.daysSinceLastContact)} days since last contact — reach out before this lead goes cold.`,
      actions: [
        {
          kind: "compose_email",
          label: "Draft email",
          payload: `contact:${facts.contactId}:reengage`,
        },
        {
          kind: "create_task",
          label: "Add follow-up task",
          payload: `contact:${facts.contactId}:followup`,
        },
      ],
    })
  }

  // VIP detection — only when not already tagged.
  const alreadyVip = tagsLower.has("vip") || tagsLower.has("vip client")
  const meetsRepeat = facts.bookingCount >= 3
  const meetsValue =
    facts.orgAvgProposalValue > 0 && facts.highestProposalValue > facts.orgAvgProposalValue * 1.5
  if (!alreadyVip && (meetsRepeat || meetsValue)) {
    out.push({
      kind: "vip_detect",
      title: "Looks like a VIP",
      text: meetsRepeat
        ? `${String(facts.bookingCount)} bookings on record — consider tagging as VIP for priority handling.`
        : `Highest proposal is well above your org average — consider tagging as VIP.`,
      actions: [
        {
          kind: "create_task",
          label: "Add VIP tag",
          payload: `contact:${facts.contactId}:tag:vip`,
        },
      ],
    })
  }

  // Referral source conversion gap.
  if (facts.referralsMade >= 5 && facts.referralsWhoBooked === 0) {
    out.push({
      kind: "referrer_gap",
      title: "Referral conversion gap",
      text: `Has made ${String(facts.referralsMade)} referrals but none have booked yet — worth checking in.`,
      actions: [
        {
          kind: "compose_email",
          label: "Thank-you / check-in email",
          payload: `contact:${facts.contactId}:referral_thanks`,
        },
        {
          kind: "navigate",
          label: "View referred contacts",
          payload: `/contacts?referredBy=${facts.contactId}`,
        },
      ],
    })
  }

  return out
}
