"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { contacts } from "@/modules/contacts/schema"
import { member } from "@/modules/auth/schema"
import { projects } from "@/modules/projects/schema"
import { pipelines, pipelineStages } from "@/modules/pipelines/schema"
import {
  prepareCustomFieldsForCreate,
  prepareCustomFieldsForUpdate,
} from "@/modules/custom-fields/host-helpers"
import type { CustomFieldChange } from "@/modules/custom-fields/changes"
import { opportunities } from "./schema"

const OPPORTUNITY_RECORD_TYPE = "opportunity"
import {
  createOpportunityInput,
  deleteOpportunityInput,
  markOpportunityLostInput,
  markOpportunityWonInput,
  moveOpportunityStageInput,
  restoreOpportunityInput,
  updateOpportunityInput,
} from "./types"

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

async function assertContactInOrg(db: DbHandle, contactId: string, orgId: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Contact not found in this organization.")
  }
}

async function assertOwnerInOrg(db: DbHandle, userId: string, orgId: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Owner user is not a member of this organization.")
  }
}

/**
 * Verify the stage belongs to the named pipeline in the active org AND
 * fetch its default probability. Used by createOpportunity to seed
 * `probability_bps` from the stage when the caller didn't provide one.
 */
async function fetchStageInPipeline(
  db: DbHandle,
  stageId: string,
  pipelineId: string,
  orgId: string,
) {
  const [row] = await db
    .select({
      id: pipelineStages.id,
      probability: pipelineStages.probability,
    })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.id, stageId),
        eq(pipelineStages.pipelineId, pipelineId),
        eq(pipelineStages.organizationId, orgId),
        isNull(pipelineStages.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError(
      "VALIDATION",
      "Stage not found in the specified pipeline for this organization.",
    )
  }
  return row
}

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

// ─── ACTIONS ───────────────────────────────────────────────────────────
//
// TODO Push P4.x (Pipeline UI): wire CustomFieldsRenderer into the
// opportunity form. Use listActiveFieldDefinitionsForRecordType('opportunity')
// for the form rendering. The engine + validators are wired here; the
// UI is the only remaining work.

export const createOpportunity = orgAction
  .metadata({ actionName: "opportunities.create" })
  .inputSchema(createOpportunityInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertProjectInOrg(ctx.db, parsedInput.projectId, ctx.activeOrg.id)
    await assertPipelineInOrg(ctx.db, parsedInput.pipelineId, ctx.activeOrg.id)
    if (parsedInput.contactId) {
      await assertContactInOrg(ctx.db, parsedInput.contactId, ctx.activeOrg.id)
    }
    if (parsedInput.ownerUserId) {
      await assertOwnerInOrg(ctx.db, parsedInput.ownerUserId, ctx.activeOrg.id)
    }
    const stage = await fetchStageInPipeline(
      ctx.db,
      parsedInput.stageId,
      parsedInput.pipelineId,
      ctx.activeOrg.id,
    )

    // Default probability: copy from stage if caller didn't provide.
    // Stage's `probability` column is integer percent (0-100 per Requirements
    // §6.3 / §6.15); convert to basis points (× 100) for storage.
    const probabilityBps =
      parsedInput.probabilityBps ?? (stage.probability !== null ? stage.probability * 100 : null)

    const id = createId()
    const { value: validatedCustomFields } = await prepareCustomFieldsForCreate(
      ctx.db,
      OPPORTUNITY_RECORD_TYPE,
      parsedInput.customFields,
    )
    await ctx.db.insert(opportunities).values({
      id,
      organizationId: ctx.activeOrg.id,
      projectId: parsedInput.projectId,
      contactId: parsedInput.contactId ?? null,
      pipelineId: parsedInput.pipelineId,
      stageId: parsedInput.stageId,
      valueCents: parsedInput.valueCents ?? null,
      probabilityBps,
      status: "open",
      ownerUserId: parsedInput.ownerUserId ?? ctx.session.user.id,
      expectedCloseDate: parsedInput.expectedCloseDate ?? null,
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
      "opportunities.created",
      {
        resourceType: "opportunity",
        resourceId: id,
        metadata: {
          projectId: parsedInput.projectId,
          pipelineId: parsedInput.pipelineId,
          stageId: parsedInput.stageId,
        },
      },
    )
    revalidatePath(`/events/${parsedInput.projectId}`)
    revalidatePath(`/pipelines/${parsedInput.pipelineId}`)
    return { id }
  })

export const updateOpportunity = orgAction
  .metadata({ actionName: "opportunities.update" })
  .inputSchema(updateOpportunityInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    if (rest.contactId !== undefined && rest.contactId !== null) {
      await assertContactInOrg(ctx.db, rest.contactId, ctx.activeOrg.id)
    }
    if (rest.ownerUserId !== undefined && rest.ownerUserId !== null) {
      await assertOwnerInOrg(ctx.db, rest.ownerUserId, ctx.activeOrg.id)
    }

    type Patch = Partial<typeof opportunities.$inferInsert>
    const patch: Patch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.contactId !== undefined) patch.contactId = rest.contactId
    if (rest.valueCents !== undefined) patch.valueCents = rest.valueCents
    if (rest.probabilityBps !== undefined) patch.probabilityBps = rest.probabilityBps
    if (rest.ownerUserId !== undefined) patch.ownerUserId = rest.ownerUserId
    if (rest.expectedCloseDate !== undefined) patch.expectedCloseDate = rest.expectedCloseDate

    let opportunityCustomFieldChanges: CustomFieldChange[] = []
    if ("customFields" in rest) {
      const [existingRow] = await ctx.db
        .select({ customFields: opportunities.customFields })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.id, id),
            eq(opportunities.organizationId, ctx.activeOrg.id),
            isNull(opportunities.deletedAt),
          ),
        )
        .limit(1)
      if (!existingRow) {
        throw new ActionError("NOT_FOUND", "Opportunity not found")
      }
      const prep = await prepareCustomFieldsForUpdate(
        ctx.db,
        OPPORTUNITY_RECORD_TYPE,
        existingRow.customFields,
        rest.customFields,
      )
      patch.customFields = prep.value
      opportunityCustomFieldChanges = prep.changes
    }

    const result = await ctx.db
      .update(opportunities)
      .set(patch)
      .where(
        and(
          eq(opportunities.id, id),
          eq(opportunities.organizationId, ctx.activeOrg.id),
          isNull(opportunities.deletedAt),
        ),
      )
      .returning({ id: opportunities.id, projectId: opportunities.projectId })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Opportunity not found")
    }
    const auditMetadata: Record<string, unknown> = { ...rest }
    if (opportunityCustomFieldChanges.length > 0) {
      auditMetadata.customFieldChanges = opportunityCustomFieldChanges
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "opportunities.updated",
      { resourceType: "opportunity", resourceId: id, metadata: auditMetadata },
    )
    revalidatePath(`/events/${first.projectId}`)
    return { id }
  })

export const moveOpportunityStage = orgAction
  .metadata({ actionName: "opportunities.move_stage" })
  .inputSchema(moveOpportunityStageInput)
  .action(async ({ parsedInput, ctx }) => {
    // Lookup the opportunity to get its pipeline_id (and prior stage for audit).
    const [opp] = await ctx.db
      .select({
        id: opportunities.id,
        pipelineId: opportunities.pipelineId,
        stageId: opportunities.stageId,
        projectId: opportunities.projectId,
      })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, parsedInput.id),
          eq(opportunities.organizationId, ctx.activeOrg.id),
          isNull(opportunities.deletedAt),
        ),
      )
      .limit(1)
    if (!opp) {
      throw new ActionError("NOT_FOUND", "Opportunity not found")
    }
    // Target stage must belong to the SAME pipeline. Cross-pipeline moves
    // are a different operation (auto-create on stage event, Phase 4).
    await fetchStageInPipeline(ctx.db, parsedInput.toStageId, opp.pipelineId, ctx.activeOrg.id)

    const fromStageId = opp.stageId
    await ctx.db
      .update(opportunities)
      .set({
        stageId: parsedInput.toStageId,
        stageChangedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(eq(opportunities.id, parsedInput.id))

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "opportunities.stage_moved",
      {
        resourceType: "opportunity",
        resourceId: parsedInput.id,
        metadata: { fromStageId, toStageId: parsedInput.toStageId },
      },
    )
    revalidatePath(`/events/${opp.projectId}`)
    revalidatePath(`/pipelines/${opp.pipelineId}`)
    return { id: parsedInput.id }
  })

export const markOpportunityWon = orgAction
  .metadata({ actionName: "opportunities.mark_won" })
  .inputSchema(markOpportunityWonInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(opportunities)
      .set({
        status: "won",
        stageChangedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(opportunities.id, parsedInput.id),
          eq(opportunities.organizationId, ctx.activeOrg.id),
          isNull(opportunities.deletedAt),
        ),
      )
      .returning({
        id: opportunities.id,
        projectId: opportunities.projectId,
        pipelineId: opportunities.pipelineId,
      })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Opportunity not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "opportunities.won",
      { resourceType: "opportunity", resourceId: first.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    revalidatePath(`/pipelines/${first.pipelineId}`)
    return { id: first.id }
  })

export const markOpportunityLost = orgAction
  .metadata({ actionName: "opportunities.mark_lost" })
  .inputSchema(markOpportunityLostInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(opportunities)
      .set({
        status: "lost",
        lostReason: parsedInput.lostReason ?? null,
        stageChangedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(opportunities.id, parsedInput.id),
          eq(opportunities.organizationId, ctx.activeOrg.id),
          isNull(opportunities.deletedAt),
        ),
      )
      .returning({
        id: opportunities.id,
        projectId: opportunities.projectId,
        pipelineId: opportunities.pipelineId,
      })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Opportunity not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "opportunities.lost",
      {
        resourceType: "opportunity",
        resourceId: first.id,
        metadata: { lostReason: parsedInput.lostReason },
      },
    )
    revalidatePath(`/events/${first.projectId}`)
    revalidatePath(`/pipelines/${first.pipelineId}`)
    return { id: first.id }
  })

export const deleteOpportunity = orgAction
  .metadata({ actionName: "opportunities.delete" })
  .inputSchema(deleteOpportunityInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(opportunities)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(opportunities.id, parsedInput.id),
          eq(opportunities.organizationId, ctx.activeOrg.id),
          isNull(opportunities.deletedAt),
        ),
      )
      .returning({
        id: opportunities.id,
        projectId: opportunities.projectId,
        pipelineId: opportunities.pipelineId,
      })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Opportunity not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "opportunities.deleted",
      { resourceType: "opportunity", resourceId: first.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    revalidatePath(`/pipelines/${first.pipelineId}`)
    return { id: first.id }
  })

export const restoreOpportunity = orgAction
  .metadata({ actionName: "opportunities.restore" })
  .inputSchema(restoreOpportunityInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(opportunities)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(opportunities.id, parsedInput.id),
          eq(opportunities.organizationId, ctx.activeOrg.id),
          isNotNull(opportunities.deletedAt),
        ),
      )
      .returning({
        id: opportunities.id,
        projectId: opportunities.projectId,
        pipelineId: opportunities.pipelineId,
      })
    const first = result[0]
    if (!first) {
      throw new ActionError("NOT_FOUND", "Deleted opportunity not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "opportunities.restored",
      { resourceType: "opportunity", resourceId: first.id },
    )
    revalidatePath(`/events/${first.projectId}`)
    revalidatePath(`/pipelines/${first.pipelineId}`)
    return { id: first.id }
  })
