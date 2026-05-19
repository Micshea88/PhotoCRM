import { z } from "zod"

/**
 * V1 trigger catalog. Each entry is sourced from an event the existing
 * modules already emit (via `audit_log` rows) or from a daily cron
 * sweep over the relevant tables. NO external event bus.
 *
 * Deferred triggers (named owner in src/modules/workflows/README.md):
 *   form.submitted, email.opened/clicked, sms.received, ig_dm.received,
 *   calendar.*, payment.received/failed, contract.sent/signed,
 *   webhook.received.
 */
export const TRIGGER_TYPES = [
  "opportunity.stage_changed",
  "opportunity.won",
  "opportunity.lost",
  "task.completed",
  "task.due_soon",
  "project.created",
  "contact.created",
  "payment_installment.overdue",
  "date_relative",
] as const

export const triggerTypeSchema = z.enum(TRIGGER_TYPES)
export type TriggerType = z.infer<typeof triggerTypeSchema>

/**
 * V1 action catalog. "Native" actions delegate to existing modules or
 * `src/lib/email.ts`. "Stub" actions ship as runnable code paths that
 * throw a clear ActionError at execute time (the executor catches and
 * records `deferred` status — never a silent no-op).
 *
 * Per docs/INTEGRATION_STRATEGY.md (locked): no new external service
 * may be introduced to make a stub work — each stub awaits its own
 * module / provider integration.
 *
 * Workflow-chaining actions (`add_to_workflow` / `remove_from_workflow`)
 * are NOT in V1 — see "Deliberately deferred (planned future)" in the
 * module README. They are a planned future capability with their own
 * plan-first checkpoint, not abandoned.
 */
export const NATIVE_ACTION_TYPES = [
  "send_email",
  "create_task",
  "update_field",
  "change_pipeline_stage",
  "add_tag",
  "remove_tag",
  "assign_owner",
  "mark_won",
  "mark_lost",
  "create_note",
  "wait",
  "if_else",
  "end_workflow",
] as const

export const STUB_ACTION_TYPES = [
  "send_invoice",
  "take_payment",
  "send_sms",
  "send_smart_document",
  "send_questionnaire",
  "send_webhook",
  "create_calendar_event",
  "send_smart_doc_for_signature",
] as const

export const ACTION_TYPES = [...NATIVE_ACTION_TYPES, ...STUB_ACTION_TYPES] as const
export const actionTypeSchema = z.enum(ACTION_TYPES)
export type ActionType = z.infer<typeof actionTypeSchema>

export const WORKFLOW_STATUSES = ["draft", "active", "paused", "archived"] as const
export const workflowStatusSchema = z.enum(WORKFLOW_STATUSES)

export const EXECUTION_STATUSES = ["pending", "running", "succeeded", "failed", "deferred"] as const
export const executionStatusSchema = z.enum(EXECUTION_STATUSES)
export type ExecutionStatus = z.infer<typeof executionStatusSchema>

export const STEP_RESULT_STATUSES = ["succeeded", "failed", "deferred", "skipped"] as const
export const stepResultStatusSchema = z.enum(STEP_RESULT_STATUSES)
export type StepResultStatus = z.infer<typeof stepResultStatusSchema>

/**
 * Per-step result snapshot. The executor maintains this array on the
 * execution row; on retry, it reads stepResults[N].status === "succeeded"
 * and SKIPS already-completed steps — the per-step idempotency that
 * prevents double-send of `send_email`.
 */
export const stepResultSchema = z.object({
  sequenceNo: z.number().int().min(0),
  status: stepResultStatusSchema,
  error: z.string().optional(),
  completedAt: z.iso.datetime().optional(),
})
export type StepResult = z.infer<typeof stepResultSchema>

/**
 * Branch predicate. V1 supports a single `{field, op, value}` check
 * evaluated against the trigger payload. Null = unconditional.
 */
const filterOps = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "contains",
  "is_null",
  "is_not_null",
] as const
export const branchConditionSchema = z
  .object({
    field: z.string().min(1).max(120),
    op: z.enum(filterOps),
    value: z.unknown().optional(),
  })
  .strict()
  .nullable()

// ─── ACTION CONFIG SCHEMAS ─────────────────────────────────────────────
//
// One per actionType. The executor validates the matching schema
// before dispatching. AI-Workflow-Builder (future module) uses these
// IDENTICAL schemas — that's the hard constraint locked in
// PIVOTS_LEDGER: AI output must parse through the same Zod schemas
// as manual creation.

const sendEmailConfig = z
  .object({
    to: z.email(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(50000),
  })
  .strict()

const createTaskConfig = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(10000).optional(),
    projectId: z.string().optional(),
    dueDateOffsetDays: z.number().int().optional(),
    priority: z.string().optional(),
  })
  .strict()

const updateFieldConfig = z
  .object({
    resourceType: z.enum(["contact", "project", "opportunity", "task"]),
    resourceId: z.string().min(1),
    fields: z.record(z.string(), z.unknown()),
  })
  .strict()

const changePipelineStageConfig = z
  .object({
    opportunityId: z.string().min(1),
    targetStageId: z.string().min(1),
  })
  .strict()

const tagConfig = z
  .object({
    contactId: z.string().min(1),
    tag: z.string().min(1).max(120),
  })
  .strict()

const assignOwnerConfig = z
  .object({
    resourceType: z.enum(["contact", "project", "opportunity"]),
    resourceId: z.string().min(1),
    ownerUserId: z.string().min(1),
  })
  .strict()

const markWonLostConfig = z
  .object({
    opportunityId: z.string().min(1),
    lostReason: z.string().max(500).optional(),
  })
  .strict()

const createNoteConfig = z
  .object({
    resourceType: z.enum(["contact", "project"]),
    resourceId: z.string().min(1),
    note: z.string().min(1).max(10000),
  })
  .strict()

const waitConfig = z
  .object({
    delayDays: z.number().int().min(0).max(365),
  })
  .strict()

const ifElseConfig = z
  .object({
    // For V1, if_else uses the step's branchCondition column directly;
    // actionConfig is empty.
  })
  .strict()
  .nullable()

const endWorkflowConfig = z.object({}).strict().nullable()

// Stub configs accept anything (the executor throws at run time
// regardless of config shape — but we still validate the AT-LEAST shape
// so the AI builder can suggest a reasonable starting point).
const stubConfig = z.record(z.string(), z.unknown()).nullable()

/**
 * The discriminated-union actionConfig validator. The executor calls
 * this before dispatching to assert the config matches the action.
 * AI-Workflow-Builder MUST also call this on its drafted output.
 */
export const actionConfigSchema = z.discriminatedUnion("actionType", [
  z.object({ actionType: z.literal("send_email"), config: sendEmailConfig }),
  z.object({ actionType: z.literal("create_task"), config: createTaskConfig }),
  z.object({ actionType: z.literal("update_field"), config: updateFieldConfig }),
  z.object({
    actionType: z.literal("change_pipeline_stage"),
    config: changePipelineStageConfig,
  }),
  z.object({ actionType: z.literal("add_tag"), config: tagConfig }),
  z.object({ actionType: z.literal("remove_tag"), config: tagConfig }),
  z.object({ actionType: z.literal("assign_owner"), config: assignOwnerConfig }),
  z.object({ actionType: z.literal("mark_won"), config: markWonLostConfig }),
  z.object({ actionType: z.literal("mark_lost"), config: markWonLostConfig }),
  z.object({ actionType: z.literal("create_note"), config: createNoteConfig }),
  z.object({ actionType: z.literal("wait"), config: waitConfig }),
  z.object({ actionType: z.literal("if_else"), config: ifElseConfig }),
  z.object({ actionType: z.literal("end_workflow"), config: endWorkflowConfig }),
  // Stubs
  z.object({ actionType: z.literal("send_invoice"), config: stubConfig }),
  z.object({ actionType: z.literal("take_payment"), config: stubConfig }),
  z.object({ actionType: z.literal("send_sms"), config: stubConfig }),
  z.object({ actionType: z.literal("send_smart_document"), config: stubConfig }),
  z.object({ actionType: z.literal("send_questionnaire"), config: stubConfig }),
  z.object({ actionType: z.literal("send_webhook"), config: stubConfig }),
  z.object({ actionType: z.literal("create_calendar_event"), config: stubConfig }),
  z.object({ actionType: z.literal("send_smart_doc_for_signature"), config: stubConfig }),
])

// ─── ACTION INPUT SCHEMAS (the orgAction Zod inputs) ──────────────────

export const createWorkflowInput = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(10000).optional(),
  triggerType: triggerTypeSchema,
  triggerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  enabled: z.boolean().default(false),
})

export const updateWorkflowInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(300).optional(),
  description: z.string().max(10000).optional(),
  triggerType: triggerTypeSchema.optional(),
  triggerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  enabled: z.boolean().optional(),
  status: workflowStatusSchema.optional(),
})

export const addWorkflowStepInput = z.object({
  workflowId: z.string().min(1),
  actionType: actionTypeSchema,
  actionConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  branchCondition: branchConditionSchema.optional(),
})

export const updateWorkflowStepInput = z.object({
  id: z.string().min(1),
  actionType: actionTypeSchema.optional(),
  actionConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  branchCondition: branchConditionSchema.optional(),
})

export const reorderWorkflowStepsInput = z.object({
  workflowId: z.string().min(1),
  stepOrders: z.array(z.object({ id: z.string(), sequenceNo: z.number().int().min(0) })),
})

export const deleteWorkflowInput = z.object({ id: z.string().min(1) })
export const restoreWorkflowInput = z.object({ id: z.string().min(1) })
export const enableWorkflowInput = z.object({ id: z.string().min(1), enabled: z.boolean() })
export const removeWorkflowStepInput = z.object({ id: z.string().min(1) })

export type CreateWorkflowInput = z.infer<typeof createWorkflowInput>
export type AddWorkflowStepInput = z.infer<typeof addWorkflowStepInput>
