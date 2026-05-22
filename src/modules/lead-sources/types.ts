import { z } from "zod"

/**
 * Status value stored on `org_lead_source_overrides.status`.
 * V1 has only `"hidden"`. Modeled as a Zod enum (and a text column)
 * for forward compatibility — future statuses (`"pinned"`, etc.)
 * land as additive enum widening, not a schema change.
 */
export const LEAD_SOURCE_STATUSES = ["hidden"] as const
export const leadSourceStatusSchema = z.enum(LEAD_SOURCE_STATUSES)
export type LeadSourceStatus = z.infer<typeof leadSourceStatusSchema>

const sourceNameSchema = z
  .string()
  .min(1)
  .max(200)
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, "Source name is required")

export const hideLeadSourceInput = z.object({
  sourceName: sourceNameSchema,
})

export const showLeadSourceInput = z.object({
  sourceName: sourceNameSchema,
})

export const deleteLeadSourceValueInput = z.object({
  sourceName: sourceNameSchema,
})

export type HideLeadSourceInput = z.infer<typeof hideLeadSourceInput>
export type ShowLeadSourceInput = z.infer<typeof showLeadSourceInput>
export type DeleteLeadSourceValueInput = z.infer<typeof deleteLeadSourceValueInput>
