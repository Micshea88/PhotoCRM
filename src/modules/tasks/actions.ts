"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { log } from "@/lib/log"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { projects } from "@/modules/projects/schema"
import { member } from "@/modules/auth/schema"
import { listFieldDefinitionsForRecordType } from "@/modules/custom-fields/queries"
import { validateCustomFieldsPayload } from "@/modules/custom-fields/validators"
import { tasks, taskDependencies, taskChecklistItems, projectStages } from "./schema"
import { recomputeTaskStatus, sweepDependentsAfterStatusChange } from "./dependency-flip"
import {
  addTaskChecklistItemInput,
  addTaskDependencyInput,
  createProjectStageInput,
  createTaskInput,
  deleteProjectStageInput,
  deleteTaskInput,
  markTaskDoneInput,
  markTaskInProgressInput,
  markTaskNotDoneInput,
  markTaskNotStartedInput,
  removeTaskChecklistItemInput,
  removeTaskDependencyInput,
  restoreTaskInput,
  updateProjectStageInput,
  updateTaskChecklistItemInput,
  updateTaskInput,
} from "./types"

const TASK_RECORD_TYPE = "task"

type DbHandle = NodePgDatabase<typeof schema>

// ─── Defensive checks ──────────────────────────────────────────────────

async function assertProjectInOrg(db: DbHandle, projectId: string, orgId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, orgId),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Project not found in this organization.")
  }
}

async function assertTaskInOrg(db: DbHandle, taskId: string, orgId: string) {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId), isNull(tasks.deletedAt)))
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Task not found in this organization.")
  }
}

async function assertProjectStageInOrg(db: DbHandle, stageId: string, orgId: string) {
  const [row] = await db
    .select({ id: projectStages.id })
    .from(projectStages)
    .where(
      and(
        eq(projectStages.id, stageId),
        eq(projectStages.organizationId, orgId),
        isNull(projectStages.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Project stage not found in this organization.")
  }
}

async function assertMemberOfOrg(db: DbHandle, userId: string, orgId: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "User is not a member of this organization.")
  }
}

async function validateTaskCustomFields(
  customFields: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!customFields || Object.keys(customFields).length === 0) return null
  const defs = await listFieldDefinitionsForRecordType(TASK_RECORD_TYPE)
  const defMap = new Map(defs.map((d) => [d.id, d]))
  try {
    return validateCustomFieldsPayload(defMap, customFields, {
      onUnknownKey: (defId) => {
        log.warn(
          { defId, recordType: TASK_RECORD_TYPE },
          "custom_fields: dropped value for unknown definition id",
        )
      },
    })
  } catch (err) {
    throw new ActionError(
      "VALIDATION",
      err instanceof Error ? err.message : "Invalid custom field value",
    )
  }
}

// ─── TASK CRUD ─────────────────────────────────────────────────────────

export const createTask = orgAction
  .metadata({ actionName: "tasks.create" })
  .inputSchema(createTaskInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertProjectInOrg(ctx.db, parsedInput.projectId, ctx.activeOrg.id)
    if (parsedInput.projectStageId) {
      await assertProjectStageInOrg(ctx.db, parsedInput.projectStageId, ctx.activeOrg.id)
    }
    if (parsedInput.assigneeUserId) {
      await assertMemberOfOrg(ctx.db, parsedInput.assigneeUserId, ctx.activeOrg.id)
    }
    const validatedCustomFields = await validateTaskCustomFields(parsedInput.customFields)
    const id = createId()
    await ctx.db.insert(tasks).values({
      id,
      organizationId: ctx.activeOrg.id,
      projectId: parsedInput.projectId,
      projectStageId: parsedInput.projectStageId ?? null,
      title: parsedInput.title,
      description: parsedInput.description ?? null,
      assigneeUserId: parsedInput.assigneeUserId ?? null,
      assigneeRole: parsedInput.assigneeRole ?? null,
      dueDate: parsedInput.dueDate ?? null,
      priority: parsedInput.priority ?? null,
      order: parsedInput.order,
      customFields: validatedCustomFields,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "tasks.created",
      {
        resourceType: "task",
        resourceId: id,
        metadata: { projectId: parsedInput.projectId, title: parsedInput.title },
      },
    )
    revalidatePath(`/events/${parsedInput.projectId}`)
    return { id }
  })

export const updateTask = orgAction
  .metadata({ actionName: "tasks.update" })
  .inputSchema(updateTaskInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    if (rest.projectStageId !== undefined && rest.projectStageId !== null) {
      await assertProjectStageInOrg(ctx.db, rest.projectStageId, ctx.activeOrg.id)
    }
    if (rest.assigneeUserId !== undefined && rest.assigneeUserId !== null) {
      await assertMemberOfOrg(ctx.db, rest.assigneeUserId, ctx.activeOrg.id)
    }

    type Patch = Partial<typeof tasks.$inferInsert>
    const patch: Patch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.projectStageId !== undefined) patch.projectStageId = rest.projectStageId
    if (rest.title !== undefined) patch.title = rest.title
    if (rest.description !== undefined) patch.description = rest.description
    if (rest.assigneeUserId !== undefined) patch.assigneeUserId = rest.assigneeUserId
    if (rest.assigneeRole !== undefined) patch.assigneeRole = rest.assigneeRole
    if (rest.dueDate !== undefined) {
      patch.dueDate = rest.dueDate
      // Manual due-date override protects from the recompute engine.
      patch.dueDateOverridden = true
    }
    if (rest.priority !== undefined) patch.priority = rest.priority
    if (rest.order !== undefined) patch.order = rest.order
    if ("customFields" in rest) {
      patch.customFields = await validateTaskCustomFields(rest.customFields)
    }

    const result = await ctx.db
      .update(tasks)
      .set(patch)
      .where(
        and(eq(tasks.id, id), eq(tasks.organizationId, ctx.activeOrg.id), isNull(tasks.deletedAt)),
      )
      .returning({ id: tasks.id, projectId: tasks.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Task not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "tasks.updated",
      { resourceType: "task", resourceId: id, metadata: rest },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id }
  })

// ─── STATUS MUTATORS (dependency-flip aware) ───────────────────────────

export const markTaskDone = orgAction
  .metadata({ actionName: "tasks.mark_done" })
  .inputSchema(markTaskDoneInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(tasks)
      .set({
        status: "done",
        completedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(tasks.id, parsedInput.id),
          eq(tasks.organizationId, ctx.activeOrg.id),
          isNull(tasks.deletedAt),
        ),
      )
      .returning({ id: tasks.id, projectId: tasks.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Task not found")
    }
    // Dependency-flip: any dependent whose blockers are all done now
    // transitions from blocked → ready.
    await sweepDependentsAfterStatusChange(ctx.db, parsedInput.id)
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "tasks.done",
      { resourceType: "task", resourceId: parsedInput.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: parsedInput.id }
  })

export const markTaskNotDone = orgAction
  .metadata({ actionName: "tasks.mark_not_done" })
  .inputSchema(markTaskNotDoneInput)
  .action(async ({ parsedInput, ctx }) => {
    // Un-completing a task. Recompute the task's own status first (in case
    // it has blockers that are still active), then sweep dependents — any
    // dependent that was 'ready' because this task was done should flip
    // back to 'blocked'.
    const result = await ctx.db
      .update(tasks)
      .set({
        status: "not_started",
        completedAt: null,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(tasks.id, parsedInput.id),
          eq(tasks.organizationId, ctx.activeOrg.id),
          isNull(tasks.deletedAt),
        ),
      )
      .returning({ id: tasks.id, projectId: tasks.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Task not found")
    }
    await recomputeTaskStatus(ctx.db, parsedInput.id)
    await sweepDependentsAfterStatusChange(ctx.db, parsedInput.id)
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "tasks.not_done",
      { resourceType: "task", resourceId: parsedInput.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: parsedInput.id }
  })

export const markTaskInProgress = orgAction
  .metadata({ actionName: "tasks.mark_in_progress" })
  .inputSchema(markTaskInProgressInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(tasks)
      .set({
        status: "in_progress",
        completedAt: null,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(tasks.id, parsedInput.id),
          eq(tasks.organizationId, ctx.activeOrg.id),
          isNull(tasks.deletedAt),
        ),
      )
      .returning({ id: tasks.id, projectId: tasks.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Task not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "tasks.in_progress",
      { resourceType: "task", resourceId: parsedInput.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: parsedInput.id }
  })

export const markTaskNotStarted = orgAction
  .metadata({ actionName: "tasks.mark_not_started" })
  .inputSchema(markTaskNotStartedInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(tasks)
      .set({
        status: "not_started",
        completedAt: null,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(tasks.id, parsedInput.id),
          eq(tasks.organizationId, ctx.activeOrg.id),
          isNull(tasks.deletedAt),
        ),
      )
      .returning({ id: tasks.id, projectId: tasks.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Task not found")
    }
    // Recompute in case the task has blockers (the user might be moving
    // a `ready` task backward; recompute decides whether it should be
    // blocked instead of not_started).
    await recomputeTaskStatus(ctx.db, parsedInput.id)
    await sweepDependentsAfterStatusChange(ctx.db, parsedInput.id)
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "tasks.not_started",
      { resourceType: "task", resourceId: parsedInput.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: parsedInput.id }
  })

export const deleteTask = orgAction
  .metadata({ actionName: "tasks.delete" })
  .inputSchema(deleteTaskInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(tasks)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(tasks.id, parsedInput.id),
          eq(tasks.organizationId, ctx.activeOrg.id),
          isNull(tasks.deletedAt),
        ),
      )
      .returning({ id: tasks.id, projectId: tasks.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Task not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "tasks.deleted",
      { resourceType: "task", resourceId: parsedInput.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: parsedInput.id }
  })

export const restoreTask = orgAction
  .metadata({ actionName: "tasks.restore" })
  .inputSchema(restoreTaskInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(tasks)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(tasks.id, parsedInput.id),
          eq(tasks.organizationId, ctx.activeOrg.id),
          isNotNull(tasks.deletedAt),
        ),
      )
      .returning({ id: tasks.id, projectId: tasks.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Deleted task not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "tasks.restored",
      { resourceType: "task", resourceId: parsedInput.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: parsedInput.id }
  })

// ─── DEPENDENCIES ──────────────────────────────────────────────────────

export const addTaskDependency = orgAction
  .metadata({ actionName: "task_dependencies.add" })
  .inputSchema(addTaskDependencyInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertTaskInOrg(ctx.db, parsedInput.taskId, ctx.activeOrg.id)
    await assertTaskInOrg(ctx.db, parsedInput.blockedByTaskId, ctx.activeOrg.id)
    const id = createId()
    await ctx.db.insert(taskDependencies).values({
      id,
      organizationId: ctx.activeOrg.id,
      taskId: parsedInput.taskId,
      blockedByTaskId: parsedInput.blockedByTaskId,
      createdBy: ctx.session.user.id,
    })
    // Recompute the dependent task's status — if the new blocker isn't
    // done, the task becomes blocked. If the new blocker IS done and the
    // task has no other not-done blockers, status is preserved.
    await recomputeTaskStatus(ctx.db, parsedInput.taskId)
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "task_dependencies.added",
      {
        resourceType: "task_dependency",
        resourceId: id,
        metadata: {
          taskId: parsedInput.taskId,
          blockedByTaskId: parsedInput.blockedByTaskId,
        },
      },
    )
    return { id }
  })

export const removeTaskDependency = orgAction
  .metadata({ actionName: "task_dependencies.remove" })
  .inputSchema(removeTaskDependencyInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.id, parsedInput.id),
          eq(taskDependencies.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({ id: taskDependencies.id, taskId: taskDependencies.taskId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Dependency not found")
    }
    // Recompute the dependent task — removing a blocker may flip it from
    // blocked → ready.
    await recomputeTaskStatus(ctx.db, first.taskId)
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "task_dependencies.removed",
      { resourceType: "task_dependency", resourceId: first.id },
    )
    return { id: first.id }
  })

// ─── CHECKLIST ITEMS ───────────────────────────────────────────────────

export const addTaskChecklistItem = orgAction
  .metadata({ actionName: "task_checklist_items.add" })
  .inputSchema(addTaskChecklistItemInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertTaskInOrg(ctx.db, parsedInput.taskId, ctx.activeOrg.id)
    if (parsedInput.assigneeUserId) {
      await assertMemberOfOrg(ctx.db, parsedInput.assigneeUserId, ctx.activeOrg.id)
    }
    const id = createId()
    await ctx.db.insert(taskChecklistItems).values({
      id,
      organizationId: ctx.activeOrg.id,
      taskId: parsedInput.taskId,
      label: parsedInput.label,
      assigneeUserId: parsedInput.assigneeUserId ?? null,
      order: parsedInput.order,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "task_checklist_items.added",
      {
        resourceType: "task_checklist_item",
        resourceId: id,
        metadata: { taskId: parsedInput.taskId, label: parsedInput.label },
      },
    )
    return { id }
  })

export const updateTaskChecklistItem = orgAction
  .metadata({ actionName: "task_checklist_items.update" })
  .inputSchema(updateTaskChecklistItemInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    type Patch = Partial<typeof taskChecklistItems.$inferInsert>
    const patch: Patch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.label !== undefined) patch.label = rest.label
    if (rest.done !== undefined) patch.done = rest.done
    if (rest.assigneeUserId !== undefined) {
      if (rest.assigneeUserId !== null) {
        await assertMemberOfOrg(ctx.db, rest.assigneeUserId, ctx.activeOrg.id)
      }
      patch.assigneeUserId = rest.assigneeUserId
    }
    if (rest.order !== undefined) patch.order = rest.order

    const result = await ctx.db
      .update(taskChecklistItems)
      .set(patch)
      .where(
        and(eq(taskChecklistItems.id, id), eq(taskChecklistItems.organizationId, ctx.activeOrg.id)),
      )
      .returning({ id: taskChecklistItems.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Checklist item not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "task_checklist_items.updated",
      { resourceType: "task_checklist_item", resourceId: id, metadata: rest },
    )
    return { id }
  })

export const removeTaskChecklistItem = orgAction
  .metadata({ actionName: "task_checklist_items.remove" })
  .inputSchema(removeTaskChecklistItemInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .delete(taskChecklistItems)
      .where(
        and(
          eq(taskChecklistItems.id, parsedInput.id),
          eq(taskChecklistItems.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({ id: taskChecklistItems.id })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Checklist item not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "task_checklist_items.removed",
      { resourceType: "task_checklist_item", resourceId: first.id },
    )
    return { id: first.id }
  })

// ─── PROJECT STAGES ────────────────────────────────────────────────────

export const createProjectStage = orgAction
  .metadata({ actionName: "project_stages.create" })
  .inputSchema(createProjectStageInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertProjectInOrg(ctx.db, parsedInput.projectId, ctx.activeOrg.id)
    const id = createId()
    await ctx.db.insert(projectStages).values({
      id,
      organizationId: ctx.activeOrg.id,
      projectId: parsedInput.projectId,
      name: parsedInput.name,
      order: parsedInput.order,
      color: parsedInput.color ?? null,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_stages.created",
      {
        resourceType: "project_stage",
        resourceId: id,
        metadata: { projectId: parsedInput.projectId, name: parsedInput.name },
      },
    )
    revalidatePath(`/events/${parsedInput.projectId}`)
    return { id }
  })

export const updateProjectStage = orgAction
  .metadata({ actionName: "project_stages.update" })
  .inputSchema(updateProjectStageInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    type Patch = Partial<typeof projectStages.$inferInsert>
    const patch: Patch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.name !== undefined) patch.name = rest.name
    if (rest.order !== undefined) patch.order = rest.order
    if (rest.color !== undefined) patch.color = rest.color

    const result = await ctx.db
      .update(projectStages)
      .set(patch)
      .where(
        and(
          eq(projectStages.id, id),
          eq(projectStages.organizationId, ctx.activeOrg.id),
          isNull(projectStages.deletedAt),
        ),
      )
      .returning({ id: projectStages.id, projectId: projectStages.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Project stage not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_stages.updated",
      { resourceType: "project_stage", resourceId: id, metadata: rest },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id }
  })

export const deleteProjectStage = orgAction
  .metadata({ actionName: "project_stages.delete" })
  .inputSchema(deleteProjectStageInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(projectStages)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(projectStages.id, parsedInput.id),
          eq(projectStages.organizationId, ctx.activeOrg.id),
          isNull(projectStages.deletedAt),
        ),
      )
      .returning({ id: projectStages.id, projectId: projectStages.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Project stage not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_stages.deleted",
      { resourceType: "project_stage", resourceId: first.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id: first.id }
  })
