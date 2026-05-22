"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { orgLeadSourceOverrides } from "./schema"
import { contacts } from "@/modules/contacts/schema"
import { deleteLeadSourceValueInput, hideLeadSourceInput, showLeadSourceInput } from "./types"

/**
 * Hide a lead-source value from the dropdown for this org. Works for
 * BOTH seeded defaults (Vendor referral / Google / etc.) AND custom
 * values entered on contacts. Soft action — existing contacts that
 * carry the value KEEP it; only the picker UI filters it out.
 *
 * Upsert semantics: if the override row already exists, this is a
 * no-op (the unique index on (org, source_name) catches the collision
 * and we swallow it). Re-running is safe.
 */
export const hideLeadSource = orgAction
  .metadata({ actionName: "lead_sources.hide" })
  .inputSchema(hideLeadSourceInput)
  .action(async ({ parsedInput, ctx }) => {
    const id = createId()
    await ctx.db
      .insert(orgLeadSourceOverrides)
      .values({
        id,
        organizationId: ctx.activeOrg.id,
        sourceName: parsedInput.sourceName,
        status: "hidden",
        createdBy: ctx.session.user.id,
      })
      .onConflictDoNothing({
        target: [orgLeadSourceOverrides.organizationId, orgLeadSourceOverrides.sourceName],
      })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "lead_sources.hidden",
      {
        resourceType: "lead_source_override",
        metadata: { sourceName: parsedInput.sourceName },
      },
    )
    revalidatePath("/contacts")
    revalidatePath("/contacts/new")
    revalidatePath("/settings/lead-sources")
    return { sourceName: parsedInput.sourceName }
  })

/**
 * Reveal a previously-hidden lead source. Deletes the override row.
 * Idempotent — deleting a non-existent override is a no-op.
 */
export const showLeadSource = orgAction
  .metadata({ actionName: "lead_sources.show" })
  .inputSchema(showLeadSourceInput)
  .action(async ({ parsedInput, ctx }) => {
    await ctx.db
      .delete(orgLeadSourceOverrides)
      .where(
        and(
          eq(orgLeadSourceOverrides.organizationId, ctx.activeOrg.id),
          eq(orgLeadSourceOverrides.sourceName, parsedInput.sourceName),
        ),
      )
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "lead_sources.shown",
      {
        resourceType: "lead_source_override",
        metadata: { sourceName: parsedInput.sourceName },
      },
    )
    revalidatePath("/contacts")
    revalidatePath("/contacts/new")
    revalidatePath("/settings/lead-sources")
    return { sourceName: parsedInput.sourceName }
  })

/**
 * DESTRUCTIVE — clears `lead_source = NULL` on every contact in the
 * org currently using this value AND removes any hide-override row
 * for it. After this runs, the value no longer appears in any
 * combobox (because it's not on any contact and there's no override
 * row preserving it) and the historical attribution on those
 * contacts is lost.
 *
 * Only called from the settings page after the user types "delete"
 * in the typed-confirmation modal. Audit log records the count for
 * forensics.
 */
export const deleteLeadSourceValue = orgAction
  .metadata({ actionName: "lead_sources.delete_value" })
  .inputSchema(deleteLeadSourceValueInput)
  .action(async ({ parsedInput, ctx }) => {
    const cleared = await ctx.db
      .update(contacts)
      .set({
        leadSource: null,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(contacts.organizationId, ctx.activeOrg.id),
          eq(contacts.leadSource, parsedInput.sourceName),
          isNotNull(contacts.leadSource),
        ),
      )
      .returning({ id: contacts.id })

    await ctx.db
      .delete(orgLeadSourceOverrides)
      .where(
        and(
          eq(orgLeadSourceOverrides.organizationId, ctx.activeOrg.id),
          eq(orgLeadSourceOverrides.sourceName, parsedInput.sourceName),
        ),
      )

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "lead_sources.value_deleted",
      {
        resourceType: "lead_source_value",
        metadata: {
          sourceName: parsedInput.sourceName,
          contactsCleared: cleared.length,
        },
      },
    )
    revalidatePath("/contacts")
    revalidatePath("/contacts/new")
    revalidatePath("/settings/lead-sources")
    return { sourceName: parsedInput.sourceName, contactsCleared: cleared.length }
  })
