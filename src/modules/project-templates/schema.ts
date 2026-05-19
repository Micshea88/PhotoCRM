import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * Per Requirements §4.9, Tech Arch §2.3, Build Spec §2.
 *
 * Project templates are the BLUEPRINT for new projects:
 *   - Default package + payment schedule defaults (used by the
 *     invoices module when it creates the initial payment installments)
 *   - Default workflow ids (workflows engine, Phase 4)
 *   - The task plan (in project_template_task_items): an ordered list
 *     of task definitions with relative date offsets and assignee
 *     ROLES rather than specific users
 *
 * This module ships the storage + admin CRUD only. The INSTANTIATION
 * ENGINE — which reads the template, resolves roles to users at project
 * creation time, computes absolute due dates from relative offsets,
 * creates project_stages + tasks + checklist items — is module #12 (the
 * recompute helper shared with payment-schedule recompute per Tech Arch
 * §4). Until that lands, templates are inert: created, edited, but
 * never realized into a live project's task graph.
 *
 * `questionnaireId` and `contractTemplateId` are text WITHOUT FKs in
 * V1 — the questionnaires and contract-template modules ship later.
 * The Phase 4 admin UI will validate these as they're filled in.
 */
export const projectTemplates = pgTable(
  "project_templates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    projectType: text("project_type").notNull(),
    packageDefaults: jsonb("package_defaults").$type<Record<string, unknown>>(),
    paymentScheduleDefaults: jsonb("payment_schedule_defaults").$type<Record<string, unknown>>(),
    defaultWorkflowIds: text("default_workflow_ids").array().$type<string[]>(),
    questionnaireId: text("questionnaire_id"),
    contractTemplateId: text("contract_template_id"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("project_templates_org_deleted_idx").on(t.organizationId, t.deletedAt),
    index("project_templates_org_type_deleted_idx").on(
      t.organizationId,
      t.projectType,
      t.deletedAt,
    ),
  ],
)

/**
 * One row per task in a template's task plan. The instantiation engine
 * walks these in `order`, creates a `tasks` row per item, computes
 * `due_date = event_date + relative_offset_days`, resolves
 * `assignee_role` to a real user from the project's photographer
 * assignments, and creates checklist items from the `checklist_items`
 * jsonb array.
 *
 * `relative_offset_days` is negative for before-event ("T−7 days:
 * confirm timeline" → -7) and positive for after ("T+2 days: back up
 * files" → 2). The instantiation engine respects manual `due_date_overridden`
 * flags on existing tasks during recompute (Tech Arch §4).
 *
 * `blocked_by_template_item_id` references another template item AS
 * THE BLUEPRINT for the dependency. When the engine instantiates, it
 * creates a real `task_dependencies` row between the corresponding
 * `tasks` rows. Self-reference is rejected at the Zod schema; same-
 * template-only is validated in the action.
 *
 * No soft-delete on items — hard-delete on template purge cascades.
 * The audit log captures item add/remove.
 */
export const projectTemplateTaskItems = pgTable(
  "project_template_task_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    projectTemplateId: text("project_template_id")
      .notNull()
      .references(() => projectTemplates.id, { onDelete: "cascade" }),
    stageName: text("stage_name").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    relativeOffsetDays: integer("relative_offset_days").notNull(),
    assigneeRole: text("assignee_role"),
    blockedByTemplateItemId: text("blocked_by_template_item_id").references(
      (): AnyPgColumn => projectTemplateTaskItems.id,
      { onDelete: "set null" },
    ),
    checklistItems: jsonb("checklist_items").$type<unknown[]>(),
    order: integer("order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("project_template_task_items_template_order_idx").on(t.projectTemplateId, t.order),
    index("project_template_task_items_org_idx").on(t.organizationId),
  ],
)

export type ProjectTemplate = typeof projectTemplates.$inferSelect
export type NewProjectTemplate = typeof projectTemplates.$inferInsert
export type ProjectTemplateTaskItem = typeof projectTemplateTaskItems.$inferSelect
export type NewProjectTemplateTaskItem = typeof projectTemplateTaskItems.$inferInsert
