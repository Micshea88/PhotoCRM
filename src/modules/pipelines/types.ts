import { z } from "zod"

/**
 * Five default pipeline types per Requirements §6.3. Stored as text;
 * validated app-side. The seed module creates one of each per new org.
 * New types are additive (code-only change in the enum).
 */
export const PIPELINE_TYPES = [
  "sales",
  "production",
  "post_production_wedding",
  "post_production_family",
  "album_production",
] as const

export const pipelineTypeSchema = z.enum(PIPELINE_TYPES)
export type PipelineType = z.infer<typeof pipelineTypeSchema>

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()

const optionalProbability = z.number().int().min(0).max(100).nullable().optional()

const hexColor = z
  .union([z.string().regex(/^#?[0-9a-fA-F]{3,8}$/u), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()

export const createPipelineInput = z.object({
  name: z.string().min(1).max(120),
  type: pipelineTypeSchema,
  displayOrder: z.number().int().nonnegative().default(0),
})

export const updatePipelineInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  type: pipelineTypeSchema.optional(),
  displayOrder: z.number().int().nonnegative().optional(),
})

export const deletePipelineInput = z.object({ id: z.string() })
export const restorePipelineInput = z.object({ id: z.string() })

export const createPipelineStageInput = z.object({
  pipelineId: z.string(),
  name: z.string().min(1).max(120),
  order: z.number().int().nonnegative().default(0),
  probability: optionalProbability,
  color: hexColor.optional(),
})

export const updatePipelineStageInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  order: z.number().int().nonnegative().optional(),
  probability: optionalProbability,
  color: hexColor.optional(),
})

export const deletePipelineStageInput = z.object({ id: z.string() })

/**
 * Reorder stages in a single batch. The payload is the new ordered list
 * of `{id, order}` pairs — the action validates that every id belongs
 * to the same pipeline in the active org, then issues one UPDATE per
 * stage. The convenience is for the drag-and-drop kanban UI: one action
 * call rather than N updateStage calls.
 */
export const reorderPipelineStagesInput = z.object({
  pipelineId: z.string(),
  stageOrders: z
    .array(
      z.object({
        id: z.string(),
        order: z.number().int().nonnegative(),
      }),
    )
    .min(1),
})

export type CreatePipelineInput = z.infer<typeof createPipelineInput>
export type UpdatePipelineInput = z.infer<typeof updatePipelineInput>
export type CreatePipelineStageInput = z.infer<typeof createPipelineStageInput>
export type UpdatePipelineStageInput = z.infer<typeof updatePipelineStageInput>
export type ReorderPipelineStagesInput = z.infer<typeof reorderPipelineStagesInput>

// `optionalText` is unused publicly but kept for future fields (e.g., description).
export { optionalText as _optionalText }
