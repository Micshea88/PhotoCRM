import { sql } from "drizzle-orm"
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * Workflow engine per Requirements §4.4 + §261 + §265, Build Spec §2,
 * Tech Arch §3. THREE tables:
 *
 *   - `workflows` — the rule definition (trigger + name + enabled flag)
 *   - `workflow_steps` — ordered action list per workflow
 *   - `workflow_executions` — per-firing audit + state + IDEMPOTENCY key
 *
 * INTEGRATION POLICY (locked — `docs/INTEGRATION_STRATEGY.md`):
 *   Every action delegates to ALREADY-BUILT native modules or to
 *   `src/lib/email.ts` (Resend, outbound-only). NO new external
 *   service. Stripe-blocked / SMS-blocked / IG-blocked actions ship
 *   as STUBS that throw `ActionError("VALIDATION", "<action> is
 *   deferred until <reason>")`. They never silently no-op.
 *
 * IDEMPOTENCY CONTRACT (silent-corruption mode 1):
 *   `workflow_executions.idempotency_key` carries a partial unique
 *   index. The trigger matcher's `INSERT ... ON CONFLICT DO NOTHING`
 *   ensures one source event fires one execution per workflow. The
 *   executor additionally tracks `step_results[N].status` to skip
 *   already-succeeded steps on retry — double-send of `send_email` is
 *   the worst-case harm and is gated by this per-step idempotency.
 *
 * RBAC:
 *   Workflow definitions are owner/admin/manager-only via the
 *   existing `hasPermission('manage_workflows')` action-layer check.
 *   The `manage_workflows` permission is already in
 *   `rbac/types.ts:PERMISSION_KEYS` and defaults to manager and above.
 *   No new role gate at the RLS layer — standard org-isolation only.
 */
export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * Trigger type — Zod-validated against the V1 TRIGGER_TYPES enum in
     * types.ts. Adding a new trigger is a code-only change.
     */
    triggerType: text("trigger_type").notNull(),
    /**
     * Trigger-specific config (e.g., `{ stage_id: "..." }` for
     * `opportunity.stage_changed`). Shape varies per trigger; the
     * matcher validates at fire time.
     */
    triggerConfig: jsonb("trigger_config").$type<Record<string, unknown> | null>(),
    /**
     * enabled=false means the workflow is a draft — definition is
     * editable but the matcher SKIPS it. Default false: new workflows
     * are inert until the user explicitly enables (matches the AI-
     * Workflow-Builder future hard constraint that AI-generated
     * workflows land disabled).
     */
    enabled: boolean("enabled").notNull().default(false),
    status: text("status").notNull().default("draft"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("workflows_org_name_uidx")
      .on(t.organizationId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index("workflows_org_trigger_enabled_idx").on(
      t.organizationId,
      t.triggerType,
      t.enabled,
      t.deletedAt,
    ),
    index("workflows_org_deleted_idx").on(t.organizationId, t.deletedAt),
  ],
)

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    sequenceNo: integer("sequence_no").notNull(),
    actionType: text("action_type").notNull(),
    /** Action-specific params; shape varies per actionType. */
    actionConfig: jsonb("action_config").$type<Record<string, unknown> | null>(),
    /**
     * Optional branch predicate. V1 shape: `{ field, op, value }` —
     * evaluated against the trigger payload. Null = unconditional.
     */
    branchCondition: jsonb("branch_condition").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("workflow_steps_workflow_seq_uidx").on(t.workflowId, t.sequenceNo),
    index("workflow_steps_org_idx").on(t.organizationId),
  ],
)

export const workflowExecutions = pgTable(
  "workflow_executions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "restrict" }),
    /** What kind of event fired this — denormalized from the workflow's triggerType. */
    triggerEventType: text("trigger_event_type").notNull(),
    /**
     * The source event's id (audit_log.id for audit-driven triggers; a
     * synthetic id like "task:abc:2026-09-15" for time-based triggers).
     * No FK — the source row may be deleted later.
     */
    triggerEventId: text("trigger_event_id").notNull(),
    /** Snapshot of the event data at fire time, so the executor sees a stable payload. */
    triggerPayload: jsonb("trigger_payload").$type<Record<string, unknown> | null>(),
    /**
     * THE idempotency contract. Format: `<triggerType>:<eventId>:<workflowId>`
     * (time-based triggers also include the date). The partial unique
     * index below ensures one execution per source event per workflow.
     */
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    currentStepNo: integer("current_step_no"),
    /**
     * Per-step result array, parallel to workflow_steps by sequenceNo.
     * Shape: `[{ sequenceNo, status: "succeeded"|"failed"|"deferred"|"skipped", error? }]`.
     * The executor reads this on retry and SKIPS already-`succeeded`
     * steps — the per-step idempotency mechanism that prevents
     * duplicate `send_email` on executor re-invocation.
     */
    stepResults: jsonb("step_results").$type<unknown[] | null>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("workflow_executions_idempotency_uidx")
      .on(t.organizationId, t.workflowId, t.idempotencyKey)
      .where(sql`${t.deletedAt} IS NULL`),
    index("workflow_executions_org_status_started_idx").on(t.organizationId, t.status, t.startedAt),
    index("workflow_executions_org_workflow_status_idx").on(
      t.organizationId,
      t.workflowId,
      t.status,
      t.deletedAt,
    ),
  ],
)

export type Workflow = typeof workflows.$inferSelect
export type NewWorkflow = typeof workflows.$inferInsert
export type WorkflowStep = typeof workflowSteps.$inferSelect
export type NewWorkflowStep = typeof workflowSteps.$inferInsert
export type WorkflowExecution = typeof workflowExecutions.$inferSelect
export type NewWorkflowExecution = typeof workflowExecutions.$inferInsert
