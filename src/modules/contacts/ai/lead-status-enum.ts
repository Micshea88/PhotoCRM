import { z } from "zod"

/**
 * Push 3 (C6b) — 19-status canonical lead-status enum.
 *
 * Locked per docs/pathway-ai-architecture.md + autonomous default D.
 * Order is grouped by ContactType for readability:
 *   CLIENT (6) → LEAD (6) → REFERRAL PARTNER (4) → VENDOR (2) → OTHER (1)
 *
 * Persisted as text on contacts.ai_lead_status. The Layer 2 classifier
 * (Haiku) is constrained to this set via the system prompt; a parse
 * failure falls back to "Uncategorized".
 */
export const LEAD_STATUSES = [
  // Client (6)
  "Booked Client",
  "Active Client",
  "Past Client",
  "VIP Client",
  "At-Risk Client",
  "Repeat Client",
  // Lead (6)
  "Hot Lead",
  "Warm Lead",
  "Lead in Progress",
  "Cold Lead",
  "Unresponsive Lead",
  "Dead Lead",
  // Referral partner (4)
  "Top Referral Source",
  "Active Referral Partner",
  "Occasional Referral",
  "Past Referral",
  // Vendor (2)
  "Active Vendor",
  "Past Vendor",
  // Other (1) — fallback when the classifier can't pick or fails to parse.
  "Uncategorized",
] as const

export const leadStatusSchema = z.enum(LEAD_STATUSES)
export type LeadStatus = z.infer<typeof leadStatusSchema>

/**
 * Visual category for the status badge. Returned by the badge
 * component as a class hint so the same 19 values map to a small
 * color palette without duplicating logic per consumer.
 */
export type LeadStatusCategory = "client" | "lead" | "referral_partner" | "vendor" | "other"

export function leadStatusCategory(status: LeadStatus): LeadStatusCategory {
  switch (status) {
    case "Booked Client":
    case "Active Client":
    case "Past Client":
    case "VIP Client":
    case "At-Risk Client":
    case "Repeat Client":
      return "client"
    case "Hot Lead":
    case "Warm Lead":
    case "Lead in Progress":
    case "Cold Lead":
    case "Unresponsive Lead":
    case "Dead Lead":
      return "lead"
    case "Top Referral Source":
    case "Active Referral Partner":
    case "Occasional Referral":
    case "Past Referral":
      return "referral_partner"
    case "Active Vendor":
    case "Past Vendor":
      return "vendor"
    case "Uncategorized":
      return "other"
  }
}
