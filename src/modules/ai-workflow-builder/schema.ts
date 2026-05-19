import { pgTable, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * `ai_workflow_drafts` — the audit + review surface for the AI Workflow
 * Builder (module 16). Every AI generation attempt is persisted here, BEFORE
 * any `workflows` row is created.
 *
 * THE FOUR HARD CONSTRAINTS (locked in docs/PIVOTS_LEDGER.md Section 2):
 *
 *   1. AI output is NEVER trusted directly. The model's raw output passes
 *      through the IDENTICAL Zod schemas used by manual workflow creation
 *      (actionConfigSchema + the trigger/step schemas from
 *      src/modules/workflows/types.ts). Anything failing validation is
 *      stored here with status='rejected' — NEVER silently saved, NEVER
 *      auto-repaired.
 *
 *   2. AI-generated workflows ALWAYS land enabled=false. The confirm
 *      action hard-codes enabled: false when calling createWorkflow.
 *      The validated-draft jsonb shape has no `enabled` field at all.
 *
 *   3. The AI is bounded to the V1 trigger + action catalogs. Stub
 *      actions (take_payment, send_sms, etc.) cannot appear as a step;
 *      the model must emit a `refusal` instead. Validated by
 *      `validate.ts`.
 *
 *   4. Own module, standard org-isolation RLS, Module 15 schemas and
 *      actions UNCHANGED. This module is a PRODUCER of inputs to the
 *      existing createWorkflow / addWorkflowStep orgActions. There is
 *      NO AI-specific write back-channel.
 *
 * AI LAYER GUIDING PRINCIPLE (locked):
 *
 *   "It is a tool, not the leader." The AI is human-directed: the human
 *   asks, the AI does the legwork, the human stays in the loop. Every
 *   write the AI performs MUST route through the identical human action
 *   path. The AI never self-directs, never enables its own workflows,
 *   never acts on client data or money without an explicit human
 *   request for that specific action.
 *
 * Why a separate table (not a column on workflows):
 *   - The draft can outlive the workflow it produces, or fail before
 *     ever producing one. They are different lifecycles.
 *   - Forensic record of prompt-injection attempts that get past the
 *     model but are caught by the validation gate (rawModelOutput is
 *     preserved for every attempt, including rejections).
 *   - Per-org / per-user rate-limit lookups need a stable count surface.
 */
export const aiWorkflowDrafts = pgTable(
  "ai_workflow_drafts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    requesterUserId: text("requester_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * The user's natural-language prompt verbatim. Capped at 2000 chars
     * at the action input layer. NEVER passed back to the model unmodified
     * in any follow-up call without the user explicitly seeing it again —
     * this is the source of any prompt-injection attempt and the forensic
     * record.
     */
    prompt: text("prompt").notNull(),
    /** Model identifier used for this draft (e.g. claude-sonnet-4-6). */
    modelName: text("model_name").notNull(),
    /** Token count for cost tracking. Null if model call failed. */
    modelTokensUsed: integer("model_tokens_used"),
    /**
     * The model's RAW output, parsed as JSON or null if the model
     * returned non-JSON. Preserved EVEN ON REJECTION so we have a
     * forensic record of what the model emitted.
     */
    rawModelOutput: jsonb("raw_model_output").$type<unknown>(),
    /** Structured validation result: { ok: boolean; errors?: ... }. */
    validationResult: jsonb("validation_result").$type<Record<string, unknown> | null>(),
    /**
     * The parsed-and-validated draft. NULL when status is rejected/refused.
     * Shape mirrors a workflow + its steps but does NOT include `enabled` —
     * that field is hard-coded to false at confirm time.
     */
    validatedDraft: jsonb("validated_draft").$type<Record<string, unknown> | null>(),
    /** Plain-language rendering shown to the user during the review step. */
    renderedProse: text("rendered_prose"),
    /**
     * Lifecycle:
     *   pending_review — model output passed validation; awaiting user confirmation
     *   confirmed      — user confirmed; resultingWorkflowId is set
     *   rejected       — validation gate rejected the model output
     *   refused        — model itself refused (deferred-action requested)
     *   abandoned      — user did not confirm within retention window
     */
    status: text("status").notNull().default("pending_review"),
    refusalReason: text("refusal_reason"),
    /**
     * Soft pointer to workflows.id after status='confirmed'. No FK — the
     * workflow may be soft-deleted later; the draft record persists.
     */
    resultingWorkflowId: text("resulting_workflow_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("ai_workflow_drafts_org_user_created_idx").on(
      t.organizationId,
      t.requesterUserId,
      t.createdAt,
    ),
    index("ai_workflow_drafts_org_status_created_idx").on(t.organizationId, t.status, t.createdAt),
    index("ai_workflow_drafts_org_deleted_idx").on(t.organizationId, t.deletedAt),
  ],
)

export type AiWorkflowDraft = typeof aiWorkflowDrafts.$inferSelect
export type NewAiWorkflowDraft = typeof aiWorkflowDrafts.$inferInsert
