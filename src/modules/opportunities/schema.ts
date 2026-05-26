import { pgTable, text, integer, jsonb, timestamp, date, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"
import { projects } from "@/modules/projects/schema"
import { contacts } from "@/modules/contacts/schema"
import { pipelines, pipelineStages } from "@/modules/pipelines/schema"

/**
 * Per Requirements §4.5 + §6.3, Tech Arch §2.2, Build Spec §2.
 *
 * An `opportunity` is one project's tracking instance in one pipeline.
 * Per Requirements §4.5: "Project ↔ Opportunity (one-to-many across
 * pipelines)" — one Smith Wedding project can have a Sales opportunity,
 * a Production opportunity, a Wedding/Event Post-Production opportunity,
 * and an Album Production opportunity, each as a kanban card in the
 * respective pipeline. NO unique constraint on (project_id, pipeline_id)
 * — a "lost" deal can be re-opened as a new opportunity later.
 *
 * Money discipline matches the projects module: `value_cents` is integer
 * cents; `probability_bps` is integer basis points (0-10000 = 0-100%).
 *
 * `stage_changed_at` is set to NOW() on every stage move via
 * moveOpportunityStage. The "average time in stage" report
 * (Requirements §6.15) reads this column. The kanban view's stale-card
 * warning (Requirements §6.3) compares it against per-stage thresholds
 * configured on `pipeline_stages.config jsonb`.
 *
 * `status` ∈ open | won | lost. `lost_reason` is only meaningful when
 * status='lost' (Requirements §6.15 "Lost lead reasons breakdown").
 *
 * FK strategy:
 *   project_id  → CASCADE  (a purged project takes its opportunities)
 *   contact_id  → SET NULL (primary contact can change; nullable already)
 *   pipeline_id → RESTRICT (can't purge a pipeline with active opps)
 *   stage_id    → RESTRICT (same — caller must move the opp first)
 *   owner_user_id → SET NULL
 */
export const opportunities = pgTable(
  "opportunities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    valueCents: integer("value_cents"),
    probabilityBps: integer("probability_bps"),
    status: text("status").notNull().default("open"),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    expectedCloseDate: date("expected_close_date"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    lostReason: text("lost_reason"),
    // Push 4 (A1) — custom-fields jsonb. Matches the nullable + no-
    // default pattern used on contacts/companies/projects/tasks. Reads
    // use `record.customFields ?? {}` everywhere.
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // Kanban board: list by pipeline + stage, fastest. Ordering by
    // stage_changed_at (newest first) keeps moved cards at the top within
    // a column.
    index("opportunities_org_pipeline_stage_idx").on(
      t.organizationId,
      t.pipelineId,
      t.stageId,
      t.deletedAt,
    ),
    // Forecast: SUM(value × probability) WHERE status='open' GROUP BY pipeline.
    index("opportunities_org_status_deleted_idx").on(t.organizationId, t.status, t.deletedAt),
    // Project rollup: all opportunities for one project across pipelines.
    index("opportunities_org_project_deleted_idx").on(t.organizationId, t.projectId, t.deletedAt),
    // Owner views (My Opportunities).
    index("opportunities_org_owner_deleted_idx").on(t.organizationId, t.ownerUserId, t.deletedAt),
    // Average time in stage: stage_changed_at index.
    index("opportunities_stage_changed_idx").on(t.stageId, t.stageChangedAt),
  ],
)

export type Opportunity = typeof opportunities.$inferSelect
export type NewOpportunity = typeof opportunities.$inferInsert
