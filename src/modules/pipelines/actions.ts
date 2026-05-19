"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { pipelines, pipelineStages } from "./schema"
import {
  createPipelineInput,
  createPipelineStageInput,
  deletePipelineInput,
  deletePipelineStageInput,
  reorderPipelineStagesInput,
  restorePipelineInput,
  updatePipelineInput,
  updatePipelineStageInput,
} from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Defensive check: verify a pipeline_id belongs to the active org and
 * isn't soft-deleted. RLS already scopes pipelines to org, but a stale
 * id from another org would pass the FK validation without this — the
 * FK is just "does this id exist anywhere," not "is it in our org."
 */
async function assertPipelineInOrg(db: DbHandle, pipelineId: string, orgId: string) {
  const [row] = await db
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(
      and(
        eq(pipelines.id, pipelineId),
        eq(pipelines.organizationId, orgId),
        isNull(pipelines.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Pipeline not found in this organization.")
  }
}

// ─── PIPELINE CRUD ─────────────────────────────────────────────────────

export const createPipeline = orgAction
  .metadata({ actionName: "pipelines.create" })
  .inputSchema(createPipelineInput)
  .action(async ({ parsedInput, ctx }) => {
    const id = createId()
    await ctx.db.insert(pipelines).values({
      id,
      organizationId: ctx.activeOrg.id,
      name: parsedInput.name,
      type: parsedInput.type,
      displayOrder: parsedInput.displayOrder,
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
      "pipelines.created",
      { resourceType: "pipeline", resourceId: id, metadata: { name: parsedInput.name } },
    )
    revalidatePath("/pipelines")
    return { id }
  })

export const updatePipeline = orgAction
  .metadata({ actionName: "pipelines.update" })
  .inputSchema(updatePipelineInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const result = await ctx.db
      .update(pipelines)
      .set({
        ...rest,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(pipelines.id, id),
          eq(pipelines.organizationId, ctx.activeOrg.id),
          isNull(pipelines.deletedAt),
        ),
      )
      .returning({ id: pipelines.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Pipeline not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "pipelines.updated",
      { resourceType: "pipeline", resourceId: id, metadata: rest },
    )
    revalidatePath("/pipelines")
    revalidatePath(`/pipelines/${id}`)
    return { id }
  })

export const deletePipeline = orgAction
  .metadata({ actionName: "pipelines.delete" })
  .inputSchema(deletePipelineInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(pipelines)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(pipelines.id, parsedInput.id),
          eq(pipelines.organizationId, ctx.activeOrg.id),
          isNull(pipelines.deletedAt),
        ),
      )
      .returning({ id: pipelines.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Pipeline not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "pipelines.deleted",
      { resourceType: "pipeline", resourceId: parsedInput.id },
    )
    revalidatePath("/pipelines")
    return { id: parsedInput.id }
  })

export const restorePipeline = orgAction
  .metadata({ actionName: "pipelines.restore" })
  .inputSchema(restorePipelineInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(pipelines)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(pipelines.id, parsedInput.id),
          eq(pipelines.organizationId, ctx.activeOrg.id),
          isNotNull(pipelines.deletedAt),
        ),
      )
      .returning({ id: pipelines.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Deleted pipeline not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "pipelines.restored",
      { resourceType: "pipeline", resourceId: parsedInput.id },
    )
    revalidatePath("/pipelines")
    return { id: parsedInput.id }
  })

// ─── PIPELINE STAGE CRUD ────────────────────────────────────────────────

export const createPipelineStage = orgAction
  .metadata({ actionName: "pipeline_stages.create" })
  .inputSchema(createPipelineStageInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertPipelineInOrg(ctx.db, parsedInput.pipelineId, ctx.activeOrg.id)
    const id = createId()
    await ctx.db.insert(pipelineStages).values({
      id,
      organizationId: ctx.activeOrg.id,
      pipelineId: parsedInput.pipelineId,
      name: parsedInput.name,
      order: parsedInput.order,
      probability: parsedInput.probability ?? null,
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
      "pipeline_stages.created",
      {
        resourceType: "pipeline_stage",
        resourceId: id,
        metadata: { name: parsedInput.name, pipelineId: parsedInput.pipelineId },
      },
    )
    revalidatePath(`/pipelines/${parsedInput.pipelineId}`)
    return { id }
  })

export const updatePipelineStage = orgAction
  .metadata({ actionName: "pipeline_stages.update" })
  .inputSchema(updatePipelineStageInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const result = await ctx.db
      .update(pipelineStages)
      .set({
        ...rest,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(pipelineStages.id, id),
          eq(pipelineStages.organizationId, ctx.activeOrg.id),
          isNull(pipelineStages.deletedAt),
        ),
      )
      .returning({ id: pipelineStages.id, pipelineId: pipelineStages.pipelineId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Stage not found")
    }
    const pipelineId = first.pipelineId
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "pipeline_stages.updated",
      { resourceType: "pipeline_stage", resourceId: id, metadata: rest },
    )
    revalidatePath(`/pipelines/${pipelineId}`)
    return { id }
  })

export const deletePipelineStage = orgAction
  .metadata({ actionName: "pipeline_stages.delete" })
  .inputSchema(deletePipelineStageInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(pipelineStages)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(pipelineStages.id, parsedInput.id),
          eq(pipelineStages.organizationId, ctx.activeOrg.id),
          isNull(pipelineStages.deletedAt),
        ),
      )
      .returning({ id: pipelineStages.id, pipelineId: pipelineStages.pipelineId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Stage not found or already deleted")
    }
    const pipelineId = first.pipelineId
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "pipeline_stages.deleted",
      { resourceType: "pipeline_stage", resourceId: parsedInput.id },
    )
    revalidatePath(`/pipelines/${pipelineId}`)
    return { id: parsedInput.id }
  })

/**
 * Reorder stages within one pipeline. Accepts the new ordered list of
 * `{id, order}` pairs and batches the UPDATEs. Validates that every id
 * exists in the active org AND belongs to the named pipeline — a stage
 * id from a different pipeline (or another org) is a VALIDATION error.
 *
 * Why: the drag-and-drop kanban UI emits one stable shape per drop and
 * the caller shouldn't have to send N separate updateStage actions.
 */
export const reorderPipelineStages = orgAction
  .metadata({ actionName: "pipeline_stages.reorder" })
  .inputSchema(reorderPipelineStagesInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertPipelineInOrg(ctx.db, parsedInput.pipelineId, ctx.activeOrg.id)

    const stageIds = parsedInput.stageOrders.map((s) => s.id)
    const found = await ctx.db
      .select({ id: pipelineStages.id, pipelineId: pipelineStages.pipelineId })
      .from(pipelineStages)
      .where(
        and(
          inArray(pipelineStages.id, stageIds),
          eq(pipelineStages.organizationId, ctx.activeOrg.id),
          eq(pipelineStages.pipelineId, parsedInput.pipelineId),
          isNull(pipelineStages.deletedAt),
        ),
      )
    if (found.length !== stageIds.length) {
      throw new ActionError("VALIDATION", "One or more stage ids do not belong to this pipeline.")
    }

    for (const { id, order } of parsedInput.stageOrders) {
      await ctx.db
        .update(pipelineStages)
        .set({ order, updatedAt: new Date(), updatedBy: ctx.session.user.id })
        .where(eq(pipelineStages.id, id))
    }

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "pipeline_stages.reordered",
      {
        resourceType: "pipeline",
        resourceId: parsedInput.pipelineId,
        metadata: { count: stageIds.length },
      },
    )
    revalidatePath(`/pipelines/${parsedInput.pipelineId}`)
    return { count: stageIds.length }
  })
