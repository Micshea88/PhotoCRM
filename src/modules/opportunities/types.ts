import { z } from "zod"

/**
 * Opportunity status. open is the working state; won and lost are
 * terminal (the kanban view filters them out of active columns by
 * default). `lost_reason` is only set when status='lost' — the
 * markOpportunityLost action enforces this.
 */
export const OPPORTUNITY_STATUSES = ["open", "won", "lost"] as const
export const opportunityStatusSchema = z.enum(OPPORTUNITY_STATUSES)
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()

const isoDateNullable = z
  .union([z.iso.date(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()

const probabilityBpsField = z.number().int().min(0).max(10_000).nullable().optional()

// Push 4 (A3) — custom_fields jsonb payload. Validation happens at the
// action layer against the org's custom_field_definitions for
// record_type='opportunity'. Shape is unknown at the input-schema
// level because the actual schema is per-org.
const customFieldsSchema = z.record(z.string(), z.unknown()).nullable().optional()

export const createOpportunityInput = z.object({
  projectId: z.string(),
  pipelineId: z.string(),
  stageId: z.string(),
  contactId: z.string().nullable().optional(),
  valueCents: z.number().int().min(0).nullable().optional(),
  probabilityBps: probabilityBpsField,
  ownerUserId: z.string().nullable().optional(),
  expectedCloseDate: isoDateNullable.optional(),
  customFields: customFieldsSchema,
})

export const updateOpportunityInput = z.object({
  id: z.string(),
  contactId: z.string().nullable().optional(),
  valueCents: z.number().int().min(0).nullable().optional(),
  probabilityBps: probabilityBpsField,
  ownerUserId: z.string().nullable().optional(),
  expectedCloseDate: isoDateNullable.optional(),
  customFields: customFieldsSchema,
})

/**
 * Specialized stage-move action. Updates `stage_id` AND `stage_changed_at`
 * (the latter to NOW() inside the action body). Validates that the target
 * stage belongs to the opportunity's pipeline — moving an opportunity
 * across pipelines is a different operation (deleteOpportunity + create
 * a new one in the other pipeline; see Requirements §6.3 "auto-create
 * opportunities in subsequent pipelines on stage change").
 */
export const moveOpportunityStageInput = z.object({
  id: z.string(),
  toStageId: z.string(),
})

export const markOpportunityWonInput = z.object({ id: z.string() })

export const markOpportunityLostInput = z.object({
  id: z.string(),
  lostReason: optionalText(500).optional(),
})

export const deleteOpportunityInput = z.object({ id: z.string() })
export const restoreOpportunityInput = z.object({ id: z.string() })

export type CreateOpportunityInput = z.infer<typeof createOpportunityInput>
export type UpdateOpportunityInput = z.infer<typeof updateOpportunityInput>
export type MoveOpportunityStageInput = z.infer<typeof moveOpportunityStageInput>
