import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { tasks, taskDependencies, taskChecklistItems, projectStages } from "./schema"

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
