"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { contacts } from "@/modules/contacts/schema"
import { touchContactActivity } from "@/modules/contacts/ai/cache-invalidation"
import { emailLog } from "./schema"
import { deleteEmailInput, logEmailInput, updateEmailInput } from "./types"

/**
 * Backlog Item 2 — manual "Log Email" entry point. Mirrors the
 * call_log.logCall shape: pre-flight contact check, insert, atomic
 * AI cache invalidation, audit, revalidate. Source is "manual";
 * provider rows (gmail/outlook/resend) come in through their own
 * ingest pipelines later.
 */
export const logEmail = orgAction
  .metadata({ actionName: "email_log.create_manual" })
  .inputSchema(logEmailInput)
  .action(async ({ parsedInput, ctx }) => {
    // Pre-flight: verify contact belongs to active org + isn't soft-
    // deleted. RLS would also block it but a pre-flight produces a
    // better error message.
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
    await ctx.db.insert(emailLog).values({
      id,
      organizationId: ctx.activeOrg.id,
      contactId: parsedInput.contactId,
      userId: ctx.session.user.id,
      direction: parsedInput.direction,
      sentAt: new Date(parsedInput.sentAt),
      subject: parsedInput.subject ?? null,
      body: parsedInput.body ?? null,
      attachments: parsedInput.attachments ?? null,
      source: "manual",
      externalId: null,
      externalMetadata: null,
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
      "email_log.logged_manual",
      {
        resourceType: "email_log",
        resourceId: id,
        metadata: {
          contactId: parsedInput.contactId,
          direction: parsedInput.direction,
          hasAttachments: (parsedInput.attachments?.length ?? 0) > 0,
        },
      },
    )

    revalidatePath(`/contacts/${parsedInput.contactId}`)
    return { id }
  })

export const updateEmail = orgAction
  .metadata({ actionName: "email_log.update" })
  .inputSchema(updateEmailInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.sentAt !== undefined) patch.sentAt = new Date(rest.sentAt)
    if (rest.direction !== undefined) patch.direction = rest.direction
    if (rest.subject !== undefined) patch.subject = rest.subject
    if (rest.body !== undefined) patch.body = rest.body
    if (rest.attachments !== undefined) patch.attachments = rest.attachments

    const result = await ctx.db
      .update(emailLog)
      .set(patch)
      .where(
        and(
          eq(emailLog.id, id),
          eq(emailLog.organizationId, ctx.activeOrg.id),
          isNull(emailLog.deletedAt),
        ),
      )
      .returning({ id: emailLog.id, contactId: emailLog.contactId })

    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Email not found")
    }
    if (result[0]?.contactId) {
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
      "email_log.updated",
      { resourceType: "email_log", resourceId: id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id }
  })

export const deleteEmail = orgAction
  .metadata({ actionName: "email_log.delete" })
  .inputSchema(deleteEmailInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(emailLog)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(emailLog.id, parsedInput.id),
          eq(emailLog.organizationId, ctx.activeOrg.id),
          isNull(emailLog.deletedAt),
        ),
      )
      .returning({ id: emailLog.id, contactId: emailLog.contactId })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Email not found or already deleted")
    }
    if (result[0]?.contactId) {
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
      "email_log.deleted",
      { resourceType: "email_log", resourceId: parsedInput.id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id: parsedInput.id }
  })
