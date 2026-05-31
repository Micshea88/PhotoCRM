"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { contacts } from "@/modules/contacts/schema"
import { invalidateContactAiCache } from "@/modules/contacts/ai/cache-invalidation"
import { smsMessages } from "./schema"

/**
 * P-activities — log/edit/delete an SMS message against a contact.
 *
 * V1 is manual: the user types a past text into the inline composer
 * after the fact. The activity feed already reads from this table
 * (loadContactActivity). Provider integration (real outbound +
 * inbound webhook ingest) ships in Push 5+.
 *
 * Every write busts the contact's AI cache atomically (Fix 8
 * contract) so the next page render auto-regens.
 */

const logSmsInput = z.object({
  contactId: z.string().min(1),
  body: z.string().min(1).max(10_000),
  direction: z.enum(["inbound", "outbound"]).default("outbound"),
  sentAt: z.string().optional(),
})

const updateSmsInput = z.object({
  id: z.string().min(1),
  body: z.string().min(1).max(10_000).optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  sentAt: z.string().optional(),
})

const deleteSmsInput = z.object({ id: z.string().min(1) })

export const logSms = orgAction
  .metadata({ actionName: "sms_messages.log" })
  .inputSchema(logSmsInput)
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
    await ctx.db.insert(smsMessages).values({
      id,
      organizationId: ctx.activeOrg.id,
      contactId: parsedInput.contactId,
      direction: parsedInput.direction,
      body: parsedInput.body,
      sentAt: parsedInput.sentAt ? new Date(parsedInput.sentAt) : new Date(),
      sentByUserId: ctx.session.user.id,
    })
    await invalidateContactAiCache(ctx.db, ctx.activeOrg.id, parsedInput.contactId)
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "sms_messages.logged",
      {
        resourceType: "sms_message",
        resourceId: id,
        metadata: { contactId: parsedInput.contactId },
      },
    )
    revalidatePath(`/contacts/${parsedInput.contactId}`)
    return { id }
  })

export const updateSms = orgAction
  .metadata({ actionName: "sms_messages.update" })
  .inputSchema(updateSmsInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
    }
    if (rest.body !== undefined) patch.body = rest.body
    if (rest.direction !== undefined) patch.direction = rest.direction
    if (rest.sentAt !== undefined) patch.sentAt = new Date(rest.sentAt)
    const result = await ctx.db
      .update(smsMessages)
      .set(patch)
      .where(
        and(
          eq(smsMessages.id, id),
          eq(smsMessages.organizationId, ctx.activeOrg.id),
          isNull(smsMessages.deletedAt),
        ),
      )
      .returning({ id: smsMessages.id, contactId: smsMessages.contactId })
    if (result.length === 0) throw new ActionError("NOT_FOUND", "SMS not found")
    if (result[0]) {
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
      "sms_messages.updated",
      { resourceType: "sms_message", resourceId: id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id }
  })

export const deleteSms = orgAction
  .metadata({ actionName: "sms_messages.delete" })
  .inputSchema(deleteSmsInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(smsMessages)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(smsMessages.id, parsedInput.id),
          eq(smsMessages.organizationId, ctx.activeOrg.id),
          isNull(smsMessages.deletedAt),
        ),
      )
      .returning({ id: smsMessages.id, contactId: smsMessages.contactId })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "SMS not found or already deleted")
    }
    if (result[0]) {
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
      "sms_messages.deleted",
      { resourceType: "sms_message", resourceId: parsedInput.id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id: parsedInput.id }
  })
