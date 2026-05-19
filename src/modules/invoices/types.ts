import { z } from "zod"

/**
 * Per Tech Arch §4 + Build Spec §2 line 63. Split methods are stored
 * as `text` and validated app-side via Zod; adding a 6th method later
 * is a code-only change (same pattern as `custom_fields.field_type`).
 */
export const SPLIT_METHODS = [
  "pay_in_full",
  "even_by_count",
  "percentage",
  "fraction",
  "manual",
] as const
export const splitMethodSchema = z.enum(SPLIT_METHODS)
export type SplitMethod = z.infer<typeof splitMethodSchema>

/**
 * Installment lifecycle status per the spec. Stored as text; validated
 * app-side.
 */
export const INSTALLMENT_STATUSES = ["scheduled", "sent", "paid", "overdue", "refunded"] as const
export const installmentStatusSchema = z.enum(INSTALLMENT_STATUSES)
export type InstallmentStatus = z.infer<typeof installmentStatusSchema>

/**
 * Due-date rule shapes. Per the spec a rule is one of:
 *   { days_before_event: N } — N days before project.primary_date
 *   { days_after_event:  N } — N days after project.primary_date
 *   { fixed: "YYYY-MM-DD" }  — a hard date, no event-date dependency
 *   null                     — no rule; due_date stays null until set manually
 *
 * Stored as loose jsonb (the rule is consumed only by the orchestrator;
 * the renderer doesn't read it).
 */
const dueDateRuleSchema = z
  .union([
    z.object({ days_before_event: z.number().int().min(0) }).strict(),
    z.object({ days_after_event: z.number().int().min(0) }).strict(),
    z.object({ fixed: z.iso.date() }).strict(),
  ])
  .nullable()

// ─── ACTION INPUT SCHEMAS ─────────────────────────────────────────────

/**
 * Input for `createPaymentSchedule`. Method-specific params are
 * unioned — Zod enforces the right shape at the action layer.
 */
export const createPaymentScheduleInput = z.discriminatedUnion("method", [
  z.object({
    projectId: z.string().min(1),
    method: z.literal("pay_in_full"),
    dueDateRule: dueDateRuleSchema.optional(),
    billingContactId: z.string().nullable().optional(),
  }),
  z.object({
    projectId: z.string().min(1),
    method: z.literal("even_by_count"),
    count: z.number().int().min(1).max(60),
    dueDateRules: z.array(dueDateRuleSchema).optional(),
    billingContactId: z.string().nullable().optional(),
  }),
  z.object({
    projectId: z.string().min(1),
    method: z.literal("percentage"),
    bps: z.array(z.number().int().min(0).max(10000)).min(2).max(60),
    dueDateRules: z.array(dueDateRuleSchema).optional(),
    billingContactId: z.string().nullable().optional(),
  }),
  z.object({
    projectId: z.string().min(1),
    method: z.literal("fraction"),
    fractions: z.array(z.number().int().min(1)).min(2).max(60),
    dueDateRules: z.array(dueDateRuleSchema).optional(),
    billingContactId: z.string().nullable().optional(),
  }),
  z.object({
    projectId: z.string().min(1),
    method: z.literal("manual"),
    amounts: z.array(z.number().int().min(0)).min(1).max(60),
    dueDateRules: z.array(dueDateRuleSchema).optional(),
    billingContactId: z.string().nullable().optional(),
  }),
])

export type CreatePaymentScheduleInput = z.infer<typeof createPaymentScheduleInput>

/**
 * Input for `updatePaymentInstallment` — flips `*_overridden` flags
 * when the corresponding fields are present. The orchestrator on next
 * recompute will then leave the row untouched (silent-corruption mode B
 * defense).
 */
export const updatePaymentInstallmentInput = z.object({
  id: z.string().min(1),
  amountCents: z.number().int().min(0).optional(),
  dueDate: z.iso.date().nullable().optional(),
  status: installmentStatusSchema.optional(),
  billingContactId: z.string().nullable().optional(),
})

export type UpdatePaymentInstallmentInput = z.infer<typeof updatePaymentInstallmentInput>

export const recomputeProjectPaymentScheduleInput = z.object({
  projectId: z.string().min(1),
})
export type RecomputeProjectPaymentScheduleInput = z.infer<
  typeof recomputeProjectPaymentScheduleInput
>

export const deletePaymentInstallmentInput = z.object({ id: z.string().min(1) })
