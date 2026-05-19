import "server-only"
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import type * as schema from "@/db/schema"
import { log } from "@/lib/log"
import { addDays } from "@/lib/recompute/dates"
import { respectOverride } from "@/lib/recompute/override"
import { recomputeTaskStatus } from "@/modules/tasks/dependency-flip"
import { projects, projectPhotographers } from "./schema"
import { projectStages, tasks, taskDependencies, taskChecklistItems } from "@/modules/tasks/schema"
import { projectTemplates, projectTemplateTaskItems } from "@/modules/project-templates/schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Map a template item's free-text assigneeRole (e.g., "Lead Photographer",
 * "Second Shooter", "Editor") to one of the project_photographers role
 * slots ('lead' / 'second' / 'backup'). V1 heuristic: case-insensitive
 * keyword search. Unmatched roles produce null — the task is created
 * unassigned and the user resolves it manually.
 */
function photographerSlotForRole(assigneeRole: string | null): "lead" | "second" | "backup" | null {
  if (!assigneeRole) return null
  const lower = assigneeRole.toLowerCase()
  if (lower.includes("lead")) return "lead"
  if (lower.includes("second")) return "second"
  if (lower.includes("backup")) return "backup"
  return null
}

interface ChecklistItemShape {
  label?: unknown
  done?: unknown
  order?: unknown
}

function isChecklistItemShape(x: unknown): x is ChecklistItemShape {
  return typeof x === "object" && x !== null
}

export interface InstantiateProjectFromTemplateResult {
  stagesCreated: number
  tasksCreated: number
  dependenciesCreated: number
  checklistItemsCreated: number
}

/**
 * Read the template, resolve assignee roles to users, compute due dates
 * from primary_date + offset_days, create project_stages / tasks /
 * task_dependencies / task_checklist_items in one transaction.
 *
 * Called from within an orgAction (so `db` is already a transaction).
 * Throws if the project already has any task with createdFromTemplateItemId.
 *
 * After creating dependencies this calls `recomputeTaskStatus` on each
 * dependent task — the dependency-flip helper transitions them from
 * 'not_started' to 'blocked' since their blocker is not yet done.
 */
export async function instantiateProjectFromTemplate(
  db: DbHandle,
  args: { projectId: string; templateId: string; organizationId: string; userId: string },
): Promise<InstantiateProjectFromTemplateResult> {
  const { projectId, templateId, organizationId, userId } = args

  // 1. Verify project belongs to org and read primary_date.
  const [projectRow] = await db
    .select({
      id: projects.id,
      primaryDate: projects.primaryDate,
      templateId: projects.templateId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1)
  if (!projectRow) {
    throw new Error("Project not found in this organization")
  }

  // 2. Verify template belongs to org.
  const [templateRow] = await db
    .select({ id: projectTemplates.id })
    .from(projectTemplates)
    .where(
      and(
        eq(projectTemplates.id, templateId),
        eq(projectTemplates.organizationId, organizationId),
        isNull(projectTemplates.deletedAt),
      ),
    )
    .limit(1)
  if (!templateRow) {
    throw new Error("Template not found in this organization")
  }

  // 3. Idempotency check — has any task on this project already been
  // instantiated from a template item?
  const [existingTemplated] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNotNull(tasks.createdFromTemplateItemId),
        isNull(tasks.deletedAt),
      ),
    )
    .limit(1)
  if (existingTemplated) {
    throw new Error("Project already instantiated from a template")
  }

  // 4. Read template items in order.
  const templateItems = await db
    .select()
    .from(projectTemplateTaskItems)
    .where(eq(projectTemplateTaskItems.projectTemplateId, templateId))
    .orderBy(projectTemplateTaskItems.order)

  // 5. Build a {slot → userId} map from project_photographers. If
  // multiple photographers share a slot, the first (by createdAt) wins.
  const photographers = await db
    .select({ userId: projectPhotographers.userId, role: projectPhotographers.role })
    .from(projectPhotographers)
    .where(eq(projectPhotographers.projectId, projectId))
    .orderBy(projectPhotographers.createdAt)

  const slotMap = new Map<string, string>()
  for (const p of photographers) {
    if (!slotMap.has(p.role)) slotMap.set(p.role, p.userId)
  }

  // 6. Pass 1: create project_stages, deduped by stageName.
  const stageNames = Array.from(new Set(templateItems.map((it) => it.stageName)))
  const stageIdByName = new Map<string, string>()
  for (const [idx, name] of stageNames.entries()) {
    const stageId = createId()
    stageIdByName.set(name, stageId)
    await db.insert(projectStages).values({
      id: stageId,
      organizationId,
      projectId,
      name,
      order: idx,
      createdBy: userId,
      updatedBy: userId,
    })
  }

  // 7. Pass 2: create tasks + checklist items. Track item→task ids
  // for the dependency pass.
  const taskIdByTemplateItemId = new Map<string, string>()
  let checklistItemsCreated = 0
  for (const [idx, item] of templateItems.entries()) {
    const taskId = createId()
    taskIdByTemplateItemId.set(item.id, taskId)
    const slot = photographerSlotForRole(item.assigneeRole)
    const assigneeUserId = slot ? (slotMap.get(slot) ?? null) : null
    const dueDate = projectRow.primaryDate
      ? addDays(projectRow.primaryDate, item.relativeOffsetDays)
      : null
    await db.insert(tasks).values({
      id: taskId,
      organizationId,
      projectId,
      projectStageId: stageIdByName.get(item.stageName) ?? null,
      title: item.title,
      description: item.description,
      assigneeUserId,
      assigneeRole: item.assigneeRole,
      dueDate,
      status: "not_started",
      order: idx,
      createdFromTemplateItemId: item.id,
      dueDateOverridden: false,
      createdBy: userId,
      updatedBy: userId,
    })
    if (Array.isArray(item.checklistItems)) {
      for (const [ciIdx, raw] of item.checklistItems.entries()) {
        if (!isChecklistItemShape(raw)) continue
        const label = typeof raw.label === "string" ? raw.label : null
        if (!label) continue
        await db.insert(taskChecklistItems).values({
          id: createId(),
          organizationId,
          taskId,
          label,
          done: raw.done === true,
          order: typeof raw.order === "number" ? raw.order : ciIdx,
          createdBy: userId,
          updatedBy: userId,
        })
        checklistItemsCreated += 1
      }
    }
  }

  // 8. Pass 3: create dependencies + flip dependents to 'blocked'.
  let dependenciesCreated = 0
  for (const item of templateItems) {
    if (!item.blockedByTemplateItemId) continue
    const dependentTaskId = taskIdByTemplateItemId.get(item.id)
    const blockerTaskId = taskIdByTemplateItemId.get(item.blockedByTemplateItemId)
    if (!dependentTaskId || !blockerTaskId) {
      log.warn(
        { projectId, itemId: item.id, blockedBy: item.blockedByTemplateItemId },
        "instantiation: skipping dependency — referenced template item not found in this template",
      )
      continue
    }
    await db.insert(taskDependencies).values({
      id: createId(),
      organizationId,
      taskId: dependentTaskId,
      blockedByTaskId: blockerTaskId,
      createdBy: userId,
    })
    dependenciesCreated += 1
    // Force dependent to 'blocked' since the blocker is not_started.
    await recomputeTaskStatus(db, dependentTaskId)
  }

  // 9. Mark the project as having been instantiated from this template.
  await db
    .update(projects)
    .set({ templateId, updatedAt: new Date(), updatedBy: userId })
    .where(eq(projects.id, projectId))

  return {
    stagesCreated: stageNames.length,
    tasksCreated: templateItems.length,
    dependenciesCreated,
    checklistItemsCreated,
  }
}

export interface RecomputeProjectTaskDueDatesResult {
  tasksUpdated: number
  tasksSkippedOverridden: number
  tasksSkippedOrphan: number
}

/**
 * Recompute due_dates for every templated task on a project after its
 * primary_date changes. Respects `dueDateOverridden` (silent-corruption
 * mode B — overridden tasks are untouched, not even updated_at).
 *
 * Orphans (tasks whose template item has been deleted) are reported,
 * not crashed.
 *
 * No-op if primary_date is null.
 */
export async function recomputeProjectTaskDueDates(
  db: DbHandle,
  projectId: string,
): Promise<RecomputeProjectTaskDueDatesResult> {
  const [projectRow] = await db
    .select({ id: projects.id, primaryDate: projects.primaryDate })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!projectRow?.primaryDate) {
    return { tasksUpdated: 0, tasksSkippedOverridden: 0, tasksSkippedOrphan: 0 }
  }
  const primaryDate = projectRow.primaryDate

  const taskRows = await db
    .select({
      id: tasks.id,
      dueDate: tasks.dueDate,
      dueDateOverridden: tasks.dueDateOverridden,
      createdFromTemplateItemId: tasks.createdFromTemplateItemId,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNotNull(tasks.createdFromTemplateItemId),
        isNull(tasks.deletedAt),
      ),
    )

  if (taskRows.length === 0) {
    return { tasksUpdated: 0, tasksSkippedOverridden: 0, tasksSkippedOrphan: 0 }
  }

  const templateItemIds = Array.from(
    new Set(taskRows.map((t) => t.createdFromTemplateItemId).filter((x): x is string => !!x)),
  )
  const itemRows = templateItemIds.length
    ? await db
        .select({
          id: projectTemplateTaskItems.id,
          relativeOffsetDays: projectTemplateTaskItems.relativeOffsetDays,
        })
        .from(projectTemplateTaskItems)
        .where(inArray(projectTemplateTaskItems.id, templateItemIds))
    : []
  const offsetByItemId = new Map(itemRows.map((r) => [r.id, r.relativeOffsetDays]))

  let tasksUpdated = 0
  let tasksSkippedOverridden = 0
  let tasksSkippedOrphan = 0
  for (const t of taskRows) {
    if (t.dueDateOverridden) {
      tasksSkippedOverridden += 1
      continue
    }
    const offset = t.createdFromTemplateItemId
      ? offsetByItemId.get(t.createdFromTemplateItemId)
      : undefined
    if (offset == null) {
      tasksSkippedOrphan += 1
      log.warn(
        { projectId, taskId: t.id, templateItemId: t.createdFromTemplateItemId },
        "recompute: orphan template item — skipping",
      )
      continue
    }
    const computed = addDays(primaryDate, offset)
    const next = respectOverride({
      overridden: false,
      current: t.dueDate,
      computed,
    })
    if (next !== t.dueDate) {
      await db.update(tasks).set({ dueDate: next, updatedAt: new Date() }).where(eq(tasks.id, t.id))
      tasksUpdated += 1
    }
  }

  return { tasksUpdated, tasksSkippedOverridden, tasksSkippedOrphan }
}
