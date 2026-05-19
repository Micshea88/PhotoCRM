import { sql } from "drizzle-orm"
import { pgTable, text, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * Pipelines + their stages — the configurable kanban backbone per
 * Requirements §6.3, Tech Arch §2.2, Build Spec §2.
 *
 * Five default pipelines ship per-org via `seedDefaultPipelines`
 * (called from the Better Auth org-create hook + the dev seed):
 * Sales, Production, Wedding/Event Post-Production, Family/Portrait
 * Post-Production, Album Production. Names and stages match the
 * spec verbatim.
 *
 * `type` is text validated app-side by the Zod enum in types.ts
 * (sales / production / post_production_wedding / post_production_family /
 * album_production). Same text-not-enum reasoning as elsewhere: future
 * type additions are code-only.
 *
 * `pipeline_stages.organization_id` is denormalized. Strictly the
 * stage's org is implied by `pipeline_id → pipelines.organization_id`,
 * but every org-scoped table carries `organization_id` directly so
 * the same RLS pattern works without a join. The seed sets it
 * consistently and migrations/actions enforce it.
 *
 * FKs:
 *   pipelines.organization_id   → organization  ON DELETE RESTRICT
 *   pipeline_stages.pipeline_id → pipelines     ON DELETE CASCADE
 *   pipeline_stages.organization_id → organization ON DELETE RESTRICT
 *
 * Cascade on `pipeline_id` means a HARD-deleted pipeline takes its
 * stages with it (the purge cron's job). Soft-delete on pipelines
 * doesn't touch stages — they remain visible only when the user
 * `withDeleted: true` (admin tooling).
 */
export const pipelines = pgTable(
  "pipelines",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    config: jsonb("config").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("pipelines_org_name_uidx")
      .on(t.organizationId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index("pipelines_org_type_deleted_idx").on(t.organizationId, t.type, t.deletedAt),
    index("pipelines_org_deleted_order_idx").on(t.organizationId, t.deletedAt, t.displayOrder),
  ],
)

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    pipelineId: text("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    order: integer("order").notNull().default(0),
    probability: integer("probability"),
    color: text("color"),
    config: jsonb("config").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("pipeline_stages_pipeline_name_uidx")
      .on(t.pipelineId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index("pipeline_stages_pipeline_deleted_order_idx").on(t.pipelineId, t.deletedAt, t.order),
    index("pipeline_stages_org_deleted_idx").on(t.organizationId, t.deletedAt),
  ],
)

export type Pipeline = typeof pipelines.$inferSelect
export type NewPipeline = typeof pipelines.$inferInsert
export type PipelineStage = typeof pipelineStages.$inferSelect
export type NewPipelineStage = typeof pipelineStages.$inferInsert
