import { sql } from "drizzle-orm"
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  date,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"
import { projects } from "@/modules/projects/schema"
import { contacts } from "@/modules/contacts/schema"

/**
 * The PM-engine tables per Requirements §4.8 + §6.29, Tech Arch §2.3,
 * Build Spec §2. Four tables in this module:
 *
 *   - `tasks`               — units of work
 *   - `task_dependencies`   — `blocked_by` graph (one direction only)
 *   - `task_checklist_items`— inline sub-task tracking
 *   - `project_stages`      — per-project, user-editable task stages
 *
 * Status state machine (`tasks.status`):
 *   not_started → in_progress → done                 (manual progression)
 *   not_started → done                               (skip)
 *   * → blocked                                       (auto, never manual)
 *   blocked → ready                                   (auto on blocker
 *                                                     completion)
 *   ready → in_progress → done                        (manual)
 *   done → not_started/in_progress                    (manual un-complete)
 *
 * `blocked` is NEVER set by the user directly. The dependency-flip
 * helper (src/modules/tasks/dependency-flip.ts) is the sole source of
 * the `blocked → ready` transition and its reverse.
 *
 * `done` is final-ish: completing a task is a one-way trip (with a
 * separate `markTaskNotDone` to undo). If a blocker is reopened, the
 * dependent task does NOT flip back from done — it stays done. See
 * the edge-case tests in tests/integration/tasks-dependency-flip.test.ts.
 *
 * `project_stages` is intentionally separate from `pipeline_stages`:
 *   - pipeline_stages = workspace-level kanban configuration (Sales,
 *     Production, etc.). Shared across projects of that pipeline type.
 *   - project_stages = per-project task grouping (e.g., "Pre-shoot,"
 *     "Shoot day," "Post"). Templated from the project's template but
 *     user-editable per project without touching the template. The
 *     instantiation engine (Phase 2 module 4.30) creates these from
 *     template_task_items' stage_name field.
 */
export const projectStages = pgTable(
  "project_stages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    order: integer("order").notNull().default(0),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("project_stages_project_name_uidx")
      .on(t.projectId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index("project_stages_project_order_idx").on(t.projectId, t.deletedAt, t.order),
    index("project_stages_org_deleted_idx").on(t.organizationId, t.deletedAt),
  ],
)

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    // Contact Tasks build: project_id is now NULLABLE. A task belongs to a
    // project (Event), a contact, or both — enforced by the table CHECK below
    // (at least one non-null). Project-scoped tasks (template instantiation,
    // Event detail) keep working unchanged; contact-scoped tasks are the new
    // lead-phase case.
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    // Contact this task belongs to (lead-phase / general task). NULL for a
    // pure project task. ON DELETE SET NULL so deleting a contact reverts its
    // task to project-scoped rather than destroying it — the CHECK still holds
    // as long as project_id is set (a contact-only task is purged with its
    // contact via the soft-delete + purge-deleted cron).
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    projectStageId: text("project_stage_id").references(() => projectStages.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    // Resolved assignee. The instantiation engine sets this from
    // `assigneeRole` at project-creation time; users can override.
    assigneeUserId: text("assignee_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Unresolved assignee for templated tasks: "Lead Photographer",
    // "Editor", etc. The instantiation engine looks this up in the
    // project's photographer assignments to resolve to an actual user.
    assigneeRole: text("assignee_role"),
    dueDate: date("due_date"),
    status: text("status").notNull().default("not_started"),
    priority: text("priority"),
    order: integer("order").notNull().default(0),
    // Breadcrumb back to the template item this task was instantiated
    // from. Used by the recompute engine (Tech Arch §4) to know which
    // tasks to recompute due dates for when the event date moves. No
    // FK — template items live in a separate module shipped later.
    createdFromTemplateItemId: text("created_from_template_item_id"),
    // Protects manually-overridden due dates from the recompute engine.
    // The user editing a task's due_date sets this to true; recompute
    // skips rows where this is true.
    dueDateOverridden: boolean("due_date_overridden").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("tasks_org_project_deleted_idx").on(t.organizationId, t.projectId, t.deletedAt),
    index("tasks_project_stage_order_idx").on(t.projectId, t.projectStageId, t.deletedAt, t.order),
    index("tasks_org_assignee_status_idx").on(
      t.organizationId,
      t.assigneeUserId,
      t.status,
      t.deletedAt,
    ),
    index("tasks_org_due_date_idx").on(t.organizationId, t.dueDate, t.deletedAt),
    index("tasks_org_status_idx").on(t.organizationId, t.status, t.deletedAt),
    // Contact Tasks: the per-contact Tasks tab read path.
    index("tasks_org_contact_deleted_idx").on(t.organizationId, t.contactId, t.deletedAt),
    // A task is never orphaned: it must belong to a project, a contact, or
    // both. The three valid states are (contact-only), (project-only), (both).
    check(
      "tasks_project_or_contact_chk",
      sql`${t.projectId} IS NOT NULL OR ${t.contactId} IS NOT NULL`,
    ),
  ],
)

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    blockedByTaskId: text("blocked_by_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // A task can't block itself — enforced via Zod in the action input
    // schema; this unique index keeps duplicate dependency rows out.
    uniqueIndex("task_dependencies_task_blocker_uidx").on(t.taskId, t.blockedByTaskId),
    index("task_dependencies_blocked_by_idx").on(t.blockedByTaskId),
    index("task_dependencies_org_idx").on(t.organizationId),
  ],
)

export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    done: boolean("done").notNull().default(false),
    assigneeUserId: text("assignee_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    order: integer("order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("task_checklist_items_task_order_idx").on(t.taskId, t.order),
    index("task_checklist_items_org_idx").on(t.organizationId),
  ],
)

export type ProjectStage = typeof projectStages.$inferSelect
export type NewProjectStage = typeof projectStages.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type TaskDependency = typeof taskDependencies.$inferSelect
export type NewTaskDependency = typeof taskDependencies.$inferInsert
export type TaskChecklistItem = typeof taskChecklistItems.$inferSelect
export type NewTaskChecklistItem = typeof taskChecklistItems.$inferInsert
