"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { projectTemplates, projectTemplateTaskItems } from "./schema"
import {
  addTemplateTaskItemInput,
  createProjectTemplateInput,
  deleteProjectTemplateInput,
  removeTemplateTaskItemInput,
  reorderTemplateTaskItemsInput,
  restoreProjectTemplateInput,
  updateProjectTemplateInput,
  updateTemplateTaskItemInput,
} from "./types"

type DbHandle = NodePgDatabase<typeof schema>

async function assertTemplateInOrg(db: DbHandle, templateId: string, orgId: string) {
  const [row] = await db
    .select({ id: projectTemplates.id })
    .from(projectTemplates)
    .where(
      and(
        eq(projectTemplates.id, templateId),
        eq(projectTemplates.organizationId, orgId),
        isNull(projectTemplates.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Project template not found in this organization.")
  }
}

/**
 * Verify a template item belongs to the same template AND active org.
 * Used when validating blockedByTemplateItemId references — a cross-
 * template blocker is a logical error (the instantiation engine
 * couldn't resolve it).
 */
async function assertItemInTemplateAndOrg(
  db: DbHandle,
  itemId: string,
  templateId: string,
  orgId: string,
) {
  const [row] = await db
    .select({ id: projectTemplateTaskItems.id })
    .from(projectTemplateTaskItems)
    .where(
      and(
        eq(projectTemplateTaskItems.id, itemId),
        eq(projectTemplateTaskItems.projectTemplateId, templateId),
        eq(projectTemplateTaskItems.organizationId, orgId),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Blocker template item must exist in the same template.")
  }
}

// ─── TEMPLATE CRUD ────────────────────────────────────────────────────

export const createProjectTemplate = orgAction
  .metadata({ actionName: "project_templates.create" })
  .inputSchema(createProjectTemplateInput)
  .action(async ({ parsedInput, ctx }) => {
    const id = createId()
    await ctx.db.insert(projectTemplates).values({
      id,
      organizationId: ctx.activeOrg.id,
      name: parsedInput.name,
      projectType: parsedInput.projectType,
      packageDefaults: parsedInput.packageDefaults ?? null,
      paymentScheduleDefaults: parsedInput.paymentScheduleDefaults ?? null,
      defaultWorkflowIds: parsedInput.defaultWorkflowIds ?? null,
      questionnaireId: parsedInput.questionnaireId ?? null,
      contractTemplateId: parsedInput.contractTemplateId ?? null,
      customFields: parsedInput.customFields ?? null,
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
      "project_templates.created",
      {
        resourceType: "project_template",
        resourceId: id,
        metadata: { name: parsedInput.name, projectType: parsedInput.projectType },
      },
    )
    revalidatePath("/settings/templates")
    return { id }
  })

export const updateProjectTemplate = orgAction
  .metadata({ actionName: "project_templates.update" })
  .inputSchema(updateProjectTemplateInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    type Patch = Partial<typeof projectTemplates.$inferInsert>
    const patch: Patch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.name !== undefined) patch.name = rest.name
    if (rest.projectType !== undefined) patch.projectType = rest.projectType
    if (rest.packageDefaults !== undefined) patch.packageDefaults = rest.packageDefaults
    if (rest.paymentScheduleDefaults !== undefined)
      patch.paymentScheduleDefaults = rest.paymentScheduleDefaults
    if (rest.defaultWorkflowIds !== undefined) patch.defaultWorkflowIds = rest.defaultWorkflowIds
    if (rest.questionnaireId !== undefined) patch.questionnaireId = rest.questionnaireId
    if (rest.contractTemplateId !== undefined) patch.contractTemplateId = rest.contractTemplateId
    if ("customFields" in rest) patch.customFields = rest.customFields ?? null

    const result = await ctx.db
      .update(projectTemplates)
      .set(patch)
      .where(
        and(
          eq(projectTemplates.id, id),
          eq(projectTemplates.organizationId, ctx.activeOrg.id),
          isNull(projectTemplates.deletedAt),
        ),
      )
      .returning({ id: projectTemplates.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Project template not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_templates.updated",
      { resourceType: "project_template", resourceId: id, metadata: rest },
    )
    revalidatePath("/settings/templates")
    revalidatePath(`/settings/templates/${id}`)
    return { id }
  })

export const deleteProjectTemplate = orgAction
  .metadata({ actionName: "project_templates.delete" })
  .inputSchema(deleteProjectTemplateInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(projectTemplates)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(projectTemplates.id, parsedInput.id),
          eq(projectTemplates.organizationId, ctx.activeOrg.id),
          isNull(projectTemplates.deletedAt),
        ),
      )
      .returning({ id: projectTemplates.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Project template not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_templates.deleted",
      { resourceType: "project_template", resourceId: parsedInput.id },
    )
    revalidatePath("/settings/templates")
    return { id: parsedInput.id }
  })

export const restoreProjectTemplate = orgAction
  .metadata({ actionName: "project_templates.restore" })
  .inputSchema(restoreProjectTemplateInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(projectTemplates)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(projectTemplates.id, parsedInput.id),
          eq(projectTemplates.organizationId, ctx.activeOrg.id),
          isNotNull(projectTemplates.deletedAt),
        ),
      )
      .returning({ id: projectTemplates.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Deleted project template not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_templates.restored",
      { resourceType: "project_template", resourceId: parsedInput.id },
    )
    revalidatePath("/settings/templates")
    return { id: parsedInput.id }
  })

// ─── ITEM CRUD ────────────────────────────────────────────────────────

export const addTemplateTaskItem = orgAction
  .metadata({ actionName: "project_template_task_items.add" })
  .inputSchema(addTemplateTaskItemInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertTemplateInOrg(ctx.db, parsedInput.projectTemplateId, ctx.activeOrg.id)
    if (parsedInput.blockedByTemplateItemId) {
      await assertItemInTemplateAndOrg(
        ctx.db,
        parsedInput.blockedByTemplateItemId,
        parsedInput.projectTemplateId,
        ctx.activeOrg.id,
      )
    }
    const id = createId()
    await ctx.db.insert(projectTemplateTaskItems).values({
      id,
      organizationId: ctx.activeOrg.id,
      projectTemplateId: parsedInput.projectTemplateId,
      stageName: parsedInput.stageName,
      title: parsedInput.title,
      description: parsedInput.description ?? null,
      relativeOffsetDays: parsedInput.relativeOffsetDays,
      assigneeRole: parsedInput.assigneeRole ?? null,
      blockedByTemplateItemId: parsedInput.blockedByTemplateItemId ?? null,
      checklistItems: parsedInput.checklistItems ?? null,
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
      "project_template_task_items.added",
      {
        resourceType: "project_template_task_item",
        resourceId: id,
        metadata: {
          projectTemplateId: parsedInput.projectTemplateId,
          title: parsedInput.title,
        },
      },
    )
    revalidatePath(`/settings/templates/${parsedInput.projectTemplateId}`)
    return { id }
  })

export const updateTemplateTaskItem = orgAction
  .metadata({ actionName: "project_template_task_items.update" })
  .inputSchema(updateTemplateTaskItemInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput

    // Look up the current row to verify cross-template blocker constraint.
    const [existing] = await ctx.db
      .select({
        projectTemplateId: projectTemplateTaskItems.projectTemplateId,
      })
      .from(projectTemplateTaskItems)
      .where(
        and(
          eq(projectTemplateTaskItems.id, id),
          eq(projectTemplateTaskItems.organizationId, ctx.activeOrg.id),
        ),
      )
      .limit(1)
    if (!existing) {
      throw new ActionError("NOT_FOUND", "Template task item not found")
    }

    if (rest.blockedByTemplateItemId) {
      await assertItemInTemplateAndOrg(
        ctx.db,
        rest.blockedByTemplateItemId,
        existing.projectTemplateId,
        ctx.activeOrg.id,
      )
    }

    type Patch = Partial<typeof projectTemplateTaskItems.$inferInsert>
    const patch: Patch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.stageName !== undefined) patch.stageName = rest.stageName
    if (rest.title !== undefined) patch.title = rest.title
    if (rest.description !== undefined) patch.description = rest.description
    if (rest.relativeOffsetDays !== undefined) patch.relativeOffsetDays = rest.relativeOffsetDays
    if (rest.assigneeRole !== undefined) patch.assigneeRole = rest.assigneeRole
    if (rest.blockedByTemplateItemId !== undefined)
      patch.blockedByTemplateItemId = rest.blockedByTemplateItemId
    if (rest.checklistItems !== undefined) patch.checklistItems = rest.checklistItems
    if (rest.order !== undefined) patch.order = rest.order

    await ctx.db
      .update(projectTemplateTaskItems)
      .set(patch)
      .where(eq(projectTemplateTaskItems.id, id))

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_template_task_items.updated",
      { resourceType: "project_template_task_item", resourceId: id, metadata: rest },
    )
    revalidatePath(`/settings/templates/${existing.projectTemplateId}`)
    return { id }
  })

export const removeTemplateTaskItem = orgAction
  .metadata({ actionName: "project_template_task_items.remove" })
  .inputSchema(removeTemplateTaskItemInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .delete(projectTemplateTaskItems)
      .where(
        and(
          eq(projectTemplateTaskItems.id, parsedInput.id),
          eq(projectTemplateTaskItems.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({
        id: projectTemplateTaskItems.id,
        projectTemplateId: projectTemplateTaskItems.projectTemplateId,
      })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Template task item not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_template_task_items.removed",
      { resourceType: "project_template_task_item", resourceId: first.id },
    )
    revalidatePath(`/settings/templates/${first.projectTemplateId}`)
    return { id: first.id }
  })

export const reorderTemplateTaskItems = orgAction
  .metadata({ actionName: "project_template_task_items.reorder" })
  .inputSchema(reorderTemplateTaskItemsInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertTemplateInOrg(ctx.db, parsedInput.projectTemplateId, ctx.activeOrg.id)
    const itemIds = parsedInput.itemOrders.map((i) => i.id)
    const found = await ctx.db
      .select({ id: projectTemplateTaskItems.id })
      .from(projectTemplateTaskItems)
      .where(
        and(
          inArray(projectTemplateTaskItems.id, itemIds),
          eq(projectTemplateTaskItems.organizationId, ctx.activeOrg.id),
          eq(projectTemplateTaskItems.projectTemplateId, parsedInput.projectTemplateId),
        ),
      )
    if (found.length !== itemIds.length) {
      throw new ActionError("VALIDATION", "One or more item ids do not belong to this template.")
    }

    for (const { id, order } of parsedInput.itemOrders) {
      await ctx.db
        .update(projectTemplateTaskItems)
        .set({ order, updatedAt: new Date(), updatedBy: ctx.session.user.id })
        .where(eq(projectTemplateTaskItems.id, id))
    }

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "project_template_task_items.reordered",
      {
        resourceType: "project_template",
        resourceId: parsedInput.projectTemplateId,
        metadata: { count: itemIds.length },
      },
    )
    revalidatePath(`/settings/templates/${parsedInput.projectTemplateId}`)
    return { count: itemIds.length }
  })
