"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { contacts } from "@/modules/contacts/schema"
import { invalidateContactAiCache } from "@/modules/contacts/ai/cache-invalidation"
import { callLog } from "./schema"
import { deleteCallInput, logCallInput, updateCallInput } from "./types"

/**
 * Manual "Log Call" entry point used by the contact detail page's
 * Log Call modal. Source is hard-coded "manual"; external_id and
 * external_metadata are null (reserved for future RingCentral sync).
 *
 * The contact must exist in the active org; otherwise validation
 * rejects with a friendly error (RLS would already block it but a
 * pre-flight check produces a better message).
 */
export const logCall = orgAction
  .metadata({ actionName: "call_log.create_manual" })
  .inputSchema(logCallInput)
  .action(async ({ parsedInput, ctx }) => {
    // Pre-flight: verify contact is in this org and not soft-deleted.
    const [contact] = await ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, parsedInput.contactId),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1)
    if (!contact) {
      throw new ActionError("VALIDATION", "Contact not found in this organization.")
    }

    const id = createId()
    await ctx.db.insert(callLog).values({
      id,
      organizationId: ctx.activeOrg.id,
      contactId: parsedInput.contactId,
      userId: ctx.session.user.id,
      direction: parsedInput.direction,
      startedAt: new Date(parsedInput.startedAt),
      durationSeconds: parsedInput.durationSeconds ?? null,
      notes: parsedInput.notes ?? null,
      recordingFileId: parsedInput.recordingFileId ?? null,
      source: "manual",
      externalId: null,
      externalMetadata: null,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    // P3 polish #5 Fix 8 — null AI cache so the next page render
    // auto-regens with the new activity counts. Atomic with the
    // insert (same orgAction transaction).
    await invalidateContactAiCache(ctx.db, ctx.activeOrg.id, parsedInput.contactId)

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "call_log.logged_manual",
      {
        resourceType: "call_log",
        resourceId: id,
        metadata: {
          contactId: parsedInput.contactId,
          direction: parsedInput.direction,
          hasRecording: parsedInput.recordingFileId != null,
        },
      },
    )

    revalidatePath(`/contacts/${parsedInput.contactId}`)
    return { id }
  })

export const updateCall = orgAction
  .metadata({ actionName: "call_log.update" })
  .inputSchema(updateCallInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.startedAt !== undefined) patch.startedAt = new Date(rest.startedAt)
    if (rest.direction !== undefined) patch.direction = rest.direction
    if (rest.durationSeconds !== undefined) patch.durationSeconds = rest.durationSeconds
    if (rest.notes !== undefined) patch.notes = rest.notes
    if (rest.recordingFileId !== undefined) patch.recordingFileId = rest.recordingFileId

    const result = await ctx.db
      .update(callLog)
      .set(patch)
      .where(
        and(
          eq(callLog.id, id),
          eq(callLog.organizationId, ctx.activeOrg.id),
          isNull(callLog.deletedAt),
        ),
      )
      .returning({ id: callLog.id, contactId: callLog.contactId })

    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Call not found")
    }
    // P-activities — edits to call notes feed the AI summary; bust
    // the cache atomically so the next render auto-regens.
    if (result[0]?.contactId) {
      await invalidateContactAiCache(ctx.db, ctx.activeOrg.id, result[0].contactId)
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "call_log.updated",
      { resourceType: "call_log", resourceId: id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id }
  })

export const deleteCall = orgAction
  .metadata({ actionName: "call_log.delete" })
  .inputSchema(deleteCallInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(callLog)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(callLog.id, parsedInput.id),
          eq(callLog.organizationId, ctx.activeOrg.id),
          isNull(callLog.deletedAt),
        ),
      )
      .returning({ id: callLog.id, contactId: callLog.contactId })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Call not found or already deleted")
    }
    // P-activities — same cache-bust rule applies on delete.
    if (result[0]?.contactId) {
      await invalidateContactAiCache(ctx.db, ctx.activeOrg.id, result[0].contactId)
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "call_log.deleted",
      { resourceType: "call_log", resourceId: parsedInput.id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id: parsedInput.id }
  })
