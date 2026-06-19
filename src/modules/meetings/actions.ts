"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { contacts } from "@/modules/contacts/schema"
import { touchContactActivity } from "@/modules/contacts/ai/cache-invalidation"
import { meetings } from "./schema"

/**
 * P-activities — log/edit/delete a meeting against a contact.
 *
 * The activity feed already reads from this table (`loadContactActivity`
 * merges meetings into the unified stream). These actions plug the
 * write side so the new inline composer + pencil-edit + delete paths
 * have somewhere to land.
 *
 * Every write busts the contact's AI cache atomically (Fix 8
 * contract) so the next page render auto-regens with the new
 * activity.
 *
 * Calendar invites / auto-log / real schedule integration ships with
 * Push 8. V1 is manual: a user logs a past meeting against a contact
 * after the fact, or schedules one as a row.
 */

const logMeetingInput = z.object({
  contactId: z.string().min(1),
  startsAt: z.string().min(1),
  subject: z.string().max(200).optional().nullable(),
  notes: z.string().max(10_000).optional().nullable(),
  endsAt: z.string().optional().nullable(),
  location: z.string().max(500).optional().nullable(),
})

const updateMeetingInput = z.object({
  id: z.string().min(1),
  startsAt: z.string().optional(),
  subject: z.string().max(200).optional().nullable(),
  notes: z.string().max(10_000).optional().nullable(),
  endsAt: z.string().optional().nullable(),
  location: z.string().max(500).optional().nullable(),
})

const deleteMeetingInput = z.object({ id: z.string().min(1) })

export const logMeeting = orgAction
  .metadata({ actionName: "meetings.log" })
  .inputSchema(logMeetingInput)
  .action(async ({ parsedInput, ctx }) => {
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
    await ctx.db.insert(meetings).values({
      id,
      organizationId: ctx.activeOrg.id,
      contactId: parsedInput.contactId,
      subject: parsedInput.subject ?? null,
      notes: parsedInput.notes ?? null,
      startsAt: new Date(parsedInput.startsAt),
      endsAt: parsedInput.endsAt ? new Date(parsedInput.endsAt) : null,
      location: parsedInput.location ?? null,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    await touchContactActivity(ctx.db, ctx.activeOrg.id, parsedInput.contactId)
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "meetings.logged",
      {
        resourceType: "meeting",
        resourceId: id,
        metadata: { contactId: parsedInput.contactId },
      },
    )
    revalidatePath(`/contacts/${parsedInput.contactId}`)
    return { id }
  })

export const updateMeeting = orgAction
  .metadata({ actionName: "meetings.update" })
  .inputSchema(updateMeetingInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.startsAt !== undefined) patch.startsAt = new Date(rest.startsAt)
    if (rest.subject !== undefined) patch.subject = rest.subject
    if (rest.notes !== undefined) patch.notes = rest.notes
    if (rest.endsAt !== undefined) patch.endsAt = rest.endsAt ? new Date(rest.endsAt) : null
    if (rest.location !== undefined) patch.location = rest.location
    const result = await ctx.db
      .update(meetings)
      .set(patch)
      .where(
        and(
          eq(meetings.id, id),
          eq(meetings.organizationId, ctx.activeOrg.id),
          isNull(meetings.deletedAt),
        ),
      )
      .returning({ id: meetings.id, contactId: meetings.contactId })
    if (result.length === 0) throw new ActionError("NOT_FOUND", "Meeting not found")
    if (result[0]) {
      await touchContactActivity(ctx.db, ctx.activeOrg.id, result[0].contactId)
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "meetings.updated",
      { resourceType: "meeting", resourceId: id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id }
  })

export const deleteMeeting = orgAction
  .metadata({ actionName: "meetings.delete" })
  .inputSchema(deleteMeetingInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(meetings)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(meetings.id, parsedInput.id),
          eq(meetings.organizationId, ctx.activeOrg.id),
          isNull(meetings.deletedAt),
        ),
      )
      .returning({ id: meetings.id, contactId: meetings.contactId })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Meeting not found or already deleted")
    }
    if (result[0]) {
      await touchContactActivity(ctx.db, ctx.activeOrg.id, result[0].contactId)
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "meetings.deleted",
      { resourceType: "meeting", resourceId: parsedInput.id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id: parsedInput.id }
  })
