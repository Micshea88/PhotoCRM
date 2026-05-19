"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { hasPermission } from "@/modules/rbac/queries"
import type * as schema from "@/db/schema"
import { workflows, workflowSteps } from "./schema"
import { actionConfigSchema } from "./types"
import {
  addWorkflowStepInput,
  createWorkflowInput,
  deleteWorkflowInput,
  enableWorkflowInput,
  removeWorkflowStepInput,
  reorderWorkflowStepsInput,
  restoreWorkflowInput,
  updateWorkflowInput,
  updateWorkflowStepInput,
} from "./types"

type DbHandle = NodePgDatabase<typeof schema>

async function assertCanManageWorkflows(userId: string) {
  const allowed = await hasPermission(userId, "manage_workflows")
  if (!allowed) {
    throw new ActionError("FORBIDDEN", "Your role does not have permission to manage workflows.")
  }
}

async function assertWorkflowInOrg(db: DbHandle, id: string, orgId: string) {
  const [row] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(eq(workflows.id, id), eq(workflows.organizationId, orgId), isNull(workflows.deletedAt)),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("NOT_FOUND", "Workflow not found in this organization.")
  }
}

/**
 * Validate the actionType + actionConfig pair against the canonical
 * discriminated-union schema in types.ts. Reused by both manual
 * creation and (future) AI-Workflow-Builder per the locked
 * PIVOTS_LEDGER constraint.
 */
function validateActionShape(
  actionType: string,
  actionConfig: Record<string, unknown> | null,
): void {
  const result = actionConfigSchema.safeParse({
    actionType,
    config: actionConfig,
  })
  if (!result.success) {
    throw new ActionError(
      "VALIDATION",
      `Invalid action shape for "${actionType}": ${result.error.message}`,
    )
  }
}

// ─── WORKFLOW CRUD ─────────────────────────────────────────────────────

export const createWorkflow = orgAction
  .metadata({ actionName: "workflows.create" })
  .inputSchema(createWorkflowInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCanManageWorkflows(ctx.session.user.id)
    const id = createId()
    await ctx.db.insert(workflows).values({
      id,
      organizationId: ctx.activeOrg.id,
      name: parsedInput.name,
      description: parsedInput.description ?? null,
      triggerType: parsedInput.triggerType,
      triggerConfig: parsedInput.triggerConfig ?? null,
      enabled: parsedInput.enabled,
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
      "workflows.created",
      {
        resourceType: "workflow",
        resourceId: id,
        metadata: { name: parsedInput.name, triggerType: parsedInput.triggerType },
      },
    )
    revalidatePath("/workflows")
    return { id }
  })

export const updateWorkflow = orgAction
  .metadata({ actionName: "workflows.update" })
  .inputSchema(updateWorkflowInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCanManageWorkflows(ctx.session.user.id)
    await assertWorkflowInOrg(ctx.db, parsedInput.id, ctx.activeOrg.id)
    const { id, ...rest } = parsedInput
    type Patch = Partial<typeof workflows.$inferInsert>
    const patch: Patch = { updatedAt: new Date(), updatedBy: ctx.session.user.id }
    if (rest.name !== undefined) patch.name = rest.name
    if (rest.description !== undefined) patch.description = rest.description
    if (rest.triggerType !== undefined) patch.triggerType = rest.triggerType
    if (rest.triggerConfig !== undefined) patch.triggerConfig = rest.triggerConfig
    if (rest.enabled !== undefined) patch.enabled = rest.enabled
    if (rest.status !== undefined) patch.status = rest.status

    const result = await ctx.db
      .update(workflows)
      .set(patch)
      .where(and(eq(workflows.id, id), eq(workflows.organizationId, ctx.activeOrg.id)))
      .returning({ id: workflows.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Workflow not found.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "workflows.updated",
      { resourceType: "workflow", resourceId: id, metadata: rest },
    )
    revalidatePath("/workflows")
    revalidatePath(`/workflows/${id}`)
    return { id }
  })

export const enableWorkflow = orgAction
  .metadata({ actionName: "workflows.set_enabled" })
  .inputSchema(enableWorkflowInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCanManageWorkflows(ctx.session.user.id)
    const result = await ctx.db
      .update(workflows)
      .set({
        enabled: parsedInput.enabled,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(workflows.id, parsedInput.id),
          eq(workflows.organizationId, ctx.activeOrg.id),
          isNull(workflows.deletedAt),
        ),
      )
      .returning({ id: workflows.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Workflow not found.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      parsedInput.enabled ? "workflows.enabled" : "workflows.disabled",
      { resourceType: "workflow", resourceId: parsedInput.id },
    )
    revalidatePath("/workflows")
    return { id: parsedInput.id }
  })

export const deleteWorkflow = orgAction
  .metadata({ actionName: "workflows.delete" })
  .inputSchema(deleteWorkflowInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCanManageWorkflows(ctx.session.user.id)
    const result = await ctx.db
      .update(workflows)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(workflows.id, parsedInput.id),
          eq(workflows.organizationId, ctx.activeOrg.id),
          isNull(workflows.deletedAt),
        ),
      )
      .returning({ id: workflows.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Workflow not found or already deleted.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "workflows.deleted",
      { resourceType: "workflow", resourceId: parsedInput.id },
    )
    revalidatePath("/workflows")
    return { id: parsedInput.id }
  })

export const restoreWorkflow = orgAction
  .metadata({ actionName: "workflows.restore" })
  .inputSchema(restoreWorkflowInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCanManageWorkflows(ctx.session.user.id)
    const result = await ctx.db
      .update(workflows)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(workflows.id, parsedInput.id),
          eq(workflows.organizationId, ctx.activeOrg.id),
          isNotNull(workflows.deletedAt),
        ),
      )
      .returning({ id: workflows.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Deleted workflow not found.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "workflows.restored",
      { resourceType: "workflow", resourceId: parsedInput.id },
    )
    revalidatePath("/workflows")
    return { id: parsedInput.id }
  })

// ─── WORKFLOW STEPS ────────────────────────────────────────────────────

export const addWorkflowStep = orgAction
  .metadata({ actionName: "workflow_steps.add" })
  .inputSchema(addWorkflowStepInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCanManageWorkflows(ctx.session.user.id)
    await assertWorkflowInOrg(ctx.db, parsedInput.workflowId, ctx.activeOrg.id)
    validateActionShape(parsedInput.actionType, parsedInput.actionConfig ?? null)

    // Compute next sequenceNo.
    const existing = await ctx.db
      .select({ sequenceNo: workflowSteps.sequenceNo })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowId, parsedInput.workflowId))
      .orderBy(workflowSteps.sequenceNo)
    const nextSeq = existing.length === 0 ? 0 : (existing[existing.length - 1]?.sequenceNo ?? 0) + 1

    const id = createId()
    await ctx.db.insert(workflowSteps).values({
      id,
      organizationId: ctx.activeOrg.id,
      workflowId: parsedInput.workflowId,
      sequenceNo: nextSeq,
      actionType: parsedInput.actionType,
      actionConfig: parsedInput.actionConfig ?? null,
      branchCondition: parsedInput.branchCondition ?? null,
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
      "workflow_steps.added",
      {
        resourceType: "workflow_step",
        resourceId: id,
        metadata: { workflowId: parsedInput.workflowId, actionType: parsedInput.actionType },
      },
    )
    revalidatePath(`/workflows/${parsedInput.workflowId}`)
    return { id, sequenceNo: nextSeq }
  })

export const updateWorkflowStep = orgAction
  .metadata({ actionName: "workflow_steps.update" })
  .inputSchema(updateWorkflowStepInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCanManageWorkflows(ctx.session.user.id)
    const { id, ...rest } = parsedInput
    if (rest.actionType !== undefined) {
      validateActionShape(rest.actionType, rest.actionConfig ?? null)
    }
    type Patch = Partial<typeof workflowSteps.$inferInsert>
    const patch: Patch = { updatedAt: new Date(), updatedBy: ctx.session.user.id }
    if (rest.actionType !== undefined) patch.actionType = rest.actionType
    if (rest.actionConfig !== undefined) patch.actionConfig = rest.actionConfig
    if (rest.branchCondition !== undefined) patch.branchCondition = rest.branchCondition

    const result = await ctx.db
      .update(workflowSteps)
      .set(patch)
      .where(and(eq(workflowSteps.id, id), eq(workflowSteps.organizationId, ctx.activeOrg.id)))
      .returning({ id: workflowSteps.id, workflowId: workflowSteps.workflowId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Workflow step not found.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "workflow_steps.updated",
      { resourceType: "workflow_step", resourceId: id, metadata: rest },
    )
    revalidatePath(`/workflows/${first.workflowId}`)
    return { id }
  })

export const removeWorkflowStep = orgAction
  .metadata({ actionName: "workflow_steps.remove" })
  .inputSchema(removeWorkflowStepInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCanManageWorkflows(ctx.session.user.id)
    const result = await ctx.db
      .delete(workflowSteps)
      .where(
        and(
          eq(workflowSteps.id, parsedInput.id),
          eq(workflowSteps.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({ id: workflowSteps.id, workflowId: workflowSteps.workflowId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Workflow step not found.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "workflow_steps.removed",
      { resourceType: "workflow_step", resourceId: parsedInput.id },
    )
    revalidatePath(`/workflows/${first.workflowId}`)
    return { id: parsedInput.id }
  })

export const reorderWorkflowSteps = orgAction
  .metadata({ actionName: "workflow_steps.reorder" })
  .inputSchema(reorderWorkflowStepsInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCanManageWorkflows(ctx.session.user.id)
    await assertWorkflowInOrg(ctx.db, parsedInput.workflowId, ctx.activeOrg.id)
    for (const { id, sequenceNo } of parsedInput.stepOrders) {
      await ctx.db
        .update(workflowSteps)
        .set({ sequenceNo, updatedAt: new Date(), updatedBy: ctx.session.user.id })
        .where(
          and(
            eq(workflowSteps.id, id),
            eq(workflowSteps.workflowId, parsedInput.workflowId),
            eq(workflowSteps.organizationId, ctx.activeOrg.id),
          ),
        )
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "workflow_steps.reordered",
      {
        resourceType: "workflow",
        resourceId: parsedInput.workflowId,
        metadata: { count: parsedInput.stepOrders.length },
      },
    )
    revalidatePath(`/workflows/${parsedInput.workflowId}`)
    return { count: parsedInput.stepOrders.length }
  })
