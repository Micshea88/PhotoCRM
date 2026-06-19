import "server-only"
import { and, eq, gte, isNull, lte } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { projects } from "@/modules/projects/schema"
import { tasks, taskDependencies, taskChecklistItems, projectStages } from "./schema"

export type Task = typeof tasks.$inferSelect

interface ListOptions {
  withDeleted?: boolean
}

export async function listTasksForProject(projectId: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(tasks.projectId, projectId)
      : and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt))
    return tx.select().from(tasks).where(where).orderBy(tasks.order, tasks.dueDate)
  })
}

/**
 * Contact Tasks tab — every task scoped to this contact (Open + Completed),
 * with the linked Event's name for the inline tag (null when the task isn't
 * event-linked, or when the viewer can't see that project under RLS). The UI
 * (ContactTasksPane) partitions Open vs Completed and renders the event chips.
 */
export async function listTasksForContact(contactId: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(tasks.contactId, contactId)
      : and(eq(tasks.contactId, contactId), isNull(tasks.deletedAt))
    return tx
      .select({ task: tasks, eventName: projects.name })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(where)
      .orderBy(tasks.dueDate, tasks.order)
  })
}

export async function listTasksForOrg(opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(tasks)
      .where(opts.withDeleted ? undefined : isNull(tasks.deletedAt))
      .orderBy(tasks.dueDate, tasks.order)
  })
}

/**
 * Single task with dependency-graph + checklist. Three parallel
 * lookups (the detail view renders all three sections).
 */
export async function getTaskForOrg(id: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(tasks.id, id)
      : and(eq(tasks.id, id), isNull(tasks.deletedAt))
    const [task] = await tx.select().from(tasks).where(where).limit(1)
    if (!task) return null
    const [blockers, checklist] = await Promise.all([
      tx
        .select({
          dep: taskDependencies,
          blocker: tasks,
        })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedByTaskId))
        .where(eq(taskDependencies.taskId, id)),
      tx
        .select()
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, id))
        .orderBy(taskChecklistItems.order),
    ])
    return { task, blockers, checklist }
  })
}

/** Tasks assigned to one user, filtered by status. Powers "My Tasks". */
export async function listTasksByAssignee(assigneeUserId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.assigneeUserId, assigneeUserId), isNull(tasks.deletedAt)))
      .orderBy(tasks.dueDate, tasks.order)
  })
}

export async function listTasksByStatus(status: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, status), isNull(tasks.deletedAt)))
      .orderBy(tasks.dueDate)
  })
}

/** Tasks that this task blocks (i.e., would unblock when this one is done). */
export async function listTasksBlockedBy(blockerTaskId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select({ task: tasks })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(eq(taskDependencies.blockedByTaskId, blockerTaskId))
  })
}

/** The blockers OF a given task. Symmetric helper to listTasksBlockedBy. */
export async function listTaskBlockers(taskId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select({ task: tasks })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedByTaskId))
      .where(eq(taskDependencies.taskId, taskId))
  })
}

/**
 * Dashboard widget — tasks whose `dueDate` falls within the (inclusive)
 * window [startISO, endISO]. Date inputs are plain YYYY-MM-DD strings;
 * NO Date constructor (Module 14b discipline + LOC1's "no timezone
 * library" rule). Soft-deleted rows excluded. Ordered by dueDate asc.
 * RLS-scoped via withOrgContext. Capped at `opts.limit` (default 100)
 * to keep the dashboard query bounded.
 */
export async function listTasksByDueDateRange(
  startISO: string,
  endISO: string,
  opts: { limit?: number } = {},
): Promise<Task[]> {
  const limit = opts.limit ?? 100
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(tasks)
      .where(and(gte(tasks.dueDate, startISO), lte(tasks.dueDate, endISO), isNull(tasks.deletedAt)))
      .orderBy(tasks.dueDate)
      .limit(limit)
  })
}

export async function listProjectStages(projectId: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(projectStages)
      .where(
        opts.withDeleted
          ? eq(projectStages.projectId, projectId)
          : and(eq(projectStages.projectId, projectId), isNull(projectStages.deletedAt)),
      )
      .orderBy(projectStages.order, projectStages.name)
  })
}

export async function getProjectStage(id: string) {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.id, id), isNull(projectStages.deletedAt)))
      .limit(1)
    return row ?? null
  })
}
