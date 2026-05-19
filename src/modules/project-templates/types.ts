import { z } from "zod"
import { projectTypeSchema } from "@/modules/projects/types"

/**
 * Reused enum from the projects module — templates and projects must
 * agree on `project_type` so the instantiation engine knows which
 * template applies to which project.
 */
export { projectTypeSchema }

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()

const customFieldsSchema = z.record(z.string(), z.unknown()).optional().nullable()

/**
 * Loose jsonb shape for `package_defaults`. The instantiation engine
 * copies this onto the new project's `package_*` columns. Phase 4
 * invoices module will tighten the schema; for now it's a passthrough.
 */
const packageDefaultsSchema = z
  .object({
    packageName: z.string().max(200).optional(),
    packageBasePriceCents: z.number().int().min(0).optional(),
    lineItems: z.array(z.unknown()).optional(),
    discountType: z.enum(["none", "percent", "flat"]).optional(),
    discountValue: z.number().int().min(0).optional(),
    taxRateBps: z.number().int().min(0).max(100_000).optional(),
    taxSign: z.enum(["add", "subtract"]).optional(),
  })
  .strict()
  .optional()
  .nullable()

/**
 * Loose jsonb shape for `payment_schedule_defaults`. Phase 3 (invoices)
 * defines the formal shape; today's storage accepts the spec's split
 * methods (pay_in_full / even_by_count / percentage / fraction / manual)
 * as a generic record.
 */
const paymentScheduleDefaultsSchema = z
  .object({
    splitMethod: z
      .enum(["pay_in_full", "even_by_count", "percentage", "fraction", "manual"])
      .optional(),
    splitParam: z.record(z.string(), z.unknown()).optional(),
    installmentsCount: z.number().int().min(1).max(60).optional(),
    dueDateRule: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .optional()
  .nullable()

const checklistItemTemplateSchema = z
  .object({
    label: z.string().min(1).max(500),
    assigneeRole: z.string().max(120).optional(),
  })
  .strict()

// ─── Template CRUD ────────────────────────────────────────────────────

export const createProjectTemplateInput = z.object({
  name: z.string().min(1).max(200),
  projectType: projectTypeSchema,
  packageDefaults: packageDefaultsSchema,
  paymentScheduleDefaults: paymentScheduleDefaultsSchema,
  defaultWorkflowIds: z.array(z.string()).max(64).optional().nullable(),
  questionnaireId: z.string().nullable().optional(),
  contractTemplateId: z.string().nullable().optional(),
  customFields: customFieldsSchema,
})

export const updateProjectTemplateInput = createProjectTemplateInput
  .partial()
  .extend({ id: z.string() })

export const deleteProjectTemplateInput = z.object({ id: z.string() })
export const restoreProjectTemplateInput = z.object({ id: z.string() })

// ─── Template item CRUD ──────────────────────────────────────────────

export const addTemplateTaskItemInput = z.object({
  projectTemplateId: z.string(),
  stageName: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  description: optionalText(10000).optional(),
  relativeOffsetDays: z.number().int(),
  assigneeRole: optionalText(120).optional(),
  blockedByTemplateItemId: z.string().nullable().optional(),
  checklistItems: z.array(checklistItemTemplateSchema).max(50).optional().nullable(),
  order: z.number().int().nonnegative().default(0),
})

export const updateTemplateTaskItemInput = z
  .object({
    id: z.string(),
    stageName: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(300).optional(),
    description: optionalText(10000).optional(),
    relativeOffsetDays: z.number().int().optional(),
    assigneeRole: optionalText(120).optional(),
    blockedByTemplateItemId: z.string().nullable().optional(),
    checklistItems: z.array(checklistItemTemplateSchema).max(50).optional().nullable(),
    order: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.blockedByTemplateItemId === undefined || v.blockedByTemplateItemId !== v.id, {
    message: "A template task item cannot block itself",
    path: ["blockedByTemplateItemId"],
  })

export const removeTemplateTaskItemInput = z.object({ id: z.string() })

/**
 * Batched reorder, mirrors pipelines.reorderPipelineStages. The action
 * validates that every id belongs to the named template (in the active
 * org) before issuing UPDATEs. One audit row per call.
 */
export const reorderTemplateTaskItemsInput = z.object({
  projectTemplateId: z.string(),
  itemOrders: z
    .array(
      z.object({
        id: z.string(),
        order: z.number().int().nonnegative(),
      }),
    )
    .min(1),
})

export type CreateProjectTemplateInput = z.infer<typeof createProjectTemplateInput>
export type UpdateProjectTemplateInput = z.infer<typeof updateProjectTemplateInput>
export type AddTemplateTaskItemInput = z.infer<typeof addTemplateTaskItemInput>
export type UpdateTemplateTaskItemInput = z.infer<typeof updateTemplateTaskItemInput>
export type ReorderTemplateTaskItemsInput = z.infer<typeof reorderTemplateTaskItemsInput>
