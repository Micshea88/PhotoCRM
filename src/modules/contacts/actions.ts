"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { log } from "@/lib/log"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { companies } from "@/modules/companies/schema"
import { listFieldDefinitionsForRecordType } from "@/modules/custom-fields/queries"
import { validateCustomFieldsPayload } from "@/modules/custom-fields/validators"
import { contacts, contactCompanyAssociations, contactNotes } from "./schema"
import {
  addContactCompanyAssociationInput,
  archiveContactInput,
  bulkAddTagInput,
  bulkChangeOwnerInput,
  bulkChangeStatusInput,
  bulkDeleteContactsInput,
  bulkRemoveTagInput,
  bulkRestoreContactsInput,
  createContactInput,
  createContactNoteInput,
  deleteContactInput,
  deleteContactNoteInput,
  removeContactCompanyAssociationInput,
  restoreContactInput,
  unarchiveContactInput,
  updateContactCompanyAssociationInput,
  updateContactInput,
  updateContactNoteInput,
} from "./types"
import { sql } from "drizzle-orm"

const CONTACT_RECORD_TYPE = "contact"

/** Loose db type — accepts the pool-backed db or a PgTransaction. */
type DbHandle = NodePgDatabase<typeof schema>

/**
 * Validate custom_fields payload against the org's custom_field_definitions
 * for `record_type='contact'`. Returns the parsed payload (with unknown
 * keys dropped) or throws ActionError("VALIDATION") with the offending
 * field name.
 *
 * Skips the DB roundtrip entirely when the payload is empty/null —
 * common case for contacts created without custom data.
 */
async function validateContactCustomFields(
  customFields: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!customFields || Object.keys(customFields).length === 0) return null
  const defs = await listFieldDefinitionsForRecordType(CONTACT_RECORD_TYPE)
  const defMap = new Map(defs.map((d) => [d.id, d]))
  try {
    return validateCustomFieldsPayload(defMap, customFields, {
      onUnknownKey: (defId) => {
        log.warn(
          { defId, recordType: CONTACT_RECORD_TYPE },
          "custom_fields: dropped value for unknown definition id (likely soft-deleted)",
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

/**
 * Verify a company reference points at a non-deleted company in the active
 * org. Belt-and-suspenders: RLS already scopes companies to org, but the
 * FK is ON DELETE SET NULL (not CASCADE), so a stale or wrong id would
 * pass the FK without this check. Returns silently if `companyId` is
 * null/undefined.
 */
async function assertCompanyInOrg(
  db: DbHandle,
  companyId: string | null | undefined,
  orgId: string,
) {
  if (!companyId) return
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.id, companyId),
        eq(companies.organizationId, orgId),
        isNull(companies.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ActionError("VALIDATION", "Company not found in this organization.")
  }
}

export const createContact = orgAction
  .metadata({ actionName: "contacts.create" })
  .inputSchema(createContactInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertCompanyInOrg(ctx.db, parsedInput.companyId, ctx.activeOrg.id)
    const validatedCustomFields = await validateContactCustomFields(parsedInput.customFields)
    const id = createId()
    await ctx.db.insert(contacts).values({
      id,
      organizationId: ctx.activeOrg.id,
      firstName: parsedInput.firstName,
      lastName: parsedInput.lastName,
      companyId: parsedInput.companyId ?? null,
      primaryEmail: parsedInput.primaryEmail ?? null,
      secondaryEmail: parsedInput.secondaryEmail ?? null,
      primaryPhone: parsedInput.primaryPhone ?? null,
      secondaryPhone: parsedInput.secondaryPhone ?? null,
      mailingAddress: parsedInput.mailingAddress ?? null,
      dob: parsedInput.dob ?? null,
      anniversaryDate: parsedInput.anniversaryDate ?? null,
      instagramHandle: parsedInput.instagramHandle ?? null,
      facebookUrl: parsedInput.facebookUrl ?? null,
      website: parsedInput.website ?? null,
      leadSource: parsedInput.leadSource ?? null,
      sourceDetail: parsedInput.sourceDetail ?? null,
      referredByContactId: parsedInput.referredByContactId ?? null,
      contactType: parsedInput.contactType ?? null,
      lifecycleStatus: parsedInput.lifecycleStatus ?? null,
      tags: parsedInput.tags ?? null,
      ownerUserId: parsedInput.ownerUserId ?? ctx.session.user.id,
      notes: parsedInput.notes ?? null,
      internalNotes: parsedInput.internalNotes ?? null,
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
      "contacts.created",
      {
        resourceType: "contact",
        resourceId: id,
        metadata: {
          firstName: parsedInput.firstName,
          lastName: parsedInput.lastName,
          contactType: parsedInput.contactType,
        },
      },
    )
    revalidatePath("/contacts")
    return { id }
  })

export const updateContact = orgAction
  .metadata({ actionName: "contacts.update" })
  .inputSchema(updateContactInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    if (rest.companyId !== undefined) {
      await assertCompanyInOrg(ctx.db, rest.companyId, ctx.activeOrg.id)
    }
    // Only re-validate when the caller is actually mutating custom_fields.
    // If `customFields` is omitted from the update payload, leave existing
    // values untouched.
    let patchedRest: typeof rest = rest
    if ("customFields" in rest) {
      patchedRest = {
        ...rest,
        customFields: await validateContactCustomFields(rest.customFields),
      }
    }
    const result = await ctx.db
      .update(contacts)
      .set({
        ...patchedRest,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(contacts.id, id),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Contact not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contacts.updated",
      { resourceType: "contact", resourceId: id, metadata: rest },
    )
    revalidatePath("/contacts")
    revalidatePath(`/contacts/${id}`)
    return { id }
  })

export const deleteContact = orgAction
  .metadata({ actionName: "contacts.delete" })
  .inputSchema(deleteContactInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(contacts.id, parsedInput.id),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Contact not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contacts.deleted",
      { resourceType: "contact", resourceId: parsedInput.id },
    )
    revalidatePath("/contacts")
    return { id: parsedInput.id }
  })

/**
 * Archive a contact — separate state from soft-delete. Archived
 * contacts disappear from the main list + filter queries but stay
 * recoverable indefinitely (no auto-purge). The Restore button on
 * `/contacts/archived` calls `unarchiveContact`.
 *
 * Unlike soft-delete, archive does NOT need a typed-confirmation
 * modal — easily reversible, low-stakes. Detail page renders an
 * "Archive" button next to "Delete" that calls this directly.
 */
export const archiveContact = orgAction
  .metadata({ actionName: "contacts.archive" })
  .inputSchema(archiveContactInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({ archivedAt: new Date(), archivedBy: ctx.session.user.id })
      .where(
        and(
          eq(contacts.id, parsedInput.id),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
          isNull(contacts.archivedAt),
        ),
      )
      .returning({ id: contacts.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Contact not found or already archived")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contacts.archived",
      { resourceType: "contact", resourceId: parsedInput.id },
    )
    revalidatePath("/contacts")
    revalidatePath("/contacts/archived")
    revalidatePath(`/contacts/${parsedInput.id}`)
    return { id: parsedInput.id }
  })

export const unarchiveContact = orgAction
  .metadata({ actionName: "contacts.unarchive" })
  .inputSchema(unarchiveContactInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({ archivedAt: null, archivedBy: null })
      .where(
        and(
          eq(contacts.id, parsedInput.id),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNotNull(contacts.archivedAt),
        ),
      )
      .returning({ id: contacts.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Archived contact not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contacts.unarchived",
      { resourceType: "contact", resourceId: parsedInput.id },
    )
    revalidatePath("/contacts")
    revalidatePath("/contacts/archived")
    revalidatePath(`/contacts/${parsedInput.id}`)
    return { id: parsedInput.id }
  })

export const restoreContact = orgAction
  .metadata({ actionName: "contacts.restore" })
  .inputSchema(restoreContactInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(contacts.id, parsedInput.id),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNotNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Deleted contact not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contacts.restored",
      { resourceType: "contact", resourceId: parsedInput.id },
    )
    revalidatePath("/contacts")
    return { id: parsedInput.id }
  })

/**
 * Bulk-restore multiple soft-deleted contacts. Used by the /contacts/trash
 * UI's "Restore selected" action. Capped at 100 ids per call by the input
 * schema. Returns the ids that were actually restored (a subset of the
 * input if some were not found / already restored).
 */
export const bulkRestoreContacts = orgAction
  .metadata({ actionName: "contacts.bulk_restore" })
  .inputSchema(bulkRestoreContactsInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          inArray(contacts.id, parsedInput.ids),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNotNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id })
    const restoredIds = result.map((r) => r.id)
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contacts.bulk_restored",
      {
        resourceType: "contact",
        metadata: { requested: parsedInput.ids.length, restored: restoredIds.length },
      },
    )
    revalidatePath("/contacts")
    revalidatePath("/contacts/deleted")
    return { restoredIds }
  })

// ─── Contact notes (P4.2) ─────────────────────────────────────────────

/**
 * Verify a contact exists in the active org. Used before creating a
 * child record (note, association) so a stale contactId in the request
 * doesn't slip past RLS.
 */
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
  if (!row) throw new ActionError("VALIDATION", "Contact not found in this organization.")
}

export const createContactNote = orgAction
  .metadata({ actionName: "contact_notes.create" })
  .inputSchema(createContactNoteInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertContactInOrg(ctx.db, parsedInput.contactId, ctx.activeOrg.id)
    const id = createId()
    await ctx.db.insert(contactNotes).values({
      id,
      organizationId: ctx.activeOrg.id,
      contactId: parsedInput.contactId,
      body: parsedInput.body,
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
      "contact_notes.created",
      {
        resourceType: "contact_note",
        resourceId: id,
        metadata: { contactId: parsedInput.contactId },
      },
    )
    revalidatePath(`/contacts/${parsedInput.contactId}`)
    return { id }
  })

export const updateContactNote = orgAction
  .metadata({ actionName: "contact_notes.update" })
  .inputSchema(updateContactNoteInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contactNotes)
      .set({ body: parsedInput.body, updatedAt: new Date(), updatedBy: ctx.session.user.id })
      .where(
        and(
          eq(contactNotes.id, parsedInput.id),
          eq(contactNotes.organizationId, ctx.activeOrg.id),
          isNull(contactNotes.deletedAt),
        ),
      )
      .returning({ id: contactNotes.id, contactId: contactNotes.contactId })
    if (result.length === 0) throw new ActionError("NOT_FOUND", "Note not found")
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contact_notes.updated",
      { resourceType: "contact_note", resourceId: parsedInput.id },
    )
    if (result[0]) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id: parsedInput.id }
  })

export const deleteContactNote = orgAction
  .metadata({ actionName: "contact_notes.delete" })
  .inputSchema(deleteContactNoteInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contactNotes)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(contactNotes.id, parsedInput.id),
          eq(contactNotes.organizationId, ctx.activeOrg.id),
          isNull(contactNotes.deletedAt),
        ),
      )
      .returning({ id: contactNotes.id, contactId: contactNotes.contactId })
    if (result.length === 0) throw new ActionError("NOT_FOUND", "Note not found")
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contact_notes.deleted",
      { resourceType: "contact_note", resourceId: parsedInput.id },
    )
    if (result[0]) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id: parsedInput.id }
  })

// ─── Contact ↔ company associations (P4.2) ─────────────────────────────

export const addContactCompanyAssociation = orgAction
  .metadata({ actionName: "contact_company_associations.add" })
  .inputSchema(addContactCompanyAssociationInput)
  .action(async ({ parsedInput, ctx }) => {
    await assertContactInOrg(ctx.db, parsedInput.contactId, ctx.activeOrg.id)
    await assertCompanyInOrg(ctx.db, parsedInput.companyId, ctx.activeOrg.id)
    const id = createId()
    try {
      await ctx.db.insert(contactCompanyAssociations).values({
        id,
        organizationId: ctx.activeOrg.id,
        contactId: parsedInput.contactId,
        companyId: parsedInput.companyId,
        role: parsedInput.role ?? null,
        createdBy: ctx.session.user.id,
      })
    } catch (err) {
      // The (org, contact, company, COALESCE(role, '')) unique index
      // catches duplicates. Translate to a friendlier error.
      if (err instanceof Error && /duplicate key/i.test(err.message)) {
        throw new ActionError("VALIDATION", "That contact-company association already exists.")
      }
      throw err
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contact_company_associations.added",
      {
        resourceType: "contact_company_association",
        resourceId: id,
        metadata: {
          contactId: parsedInput.contactId,
          companyId: parsedInput.companyId,
          role: parsedInput.role ?? null,
        },
      },
    )
    revalidatePath(`/contacts/${parsedInput.contactId}`)
    return { id }
  })

export const updateContactCompanyAssociation = orgAction
  .metadata({ actionName: "contact_company_associations.update_role" })
  .inputSchema(updateContactCompanyAssociationInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contactCompanyAssociations)
      .set({ role: parsedInput.role ?? null })
      .where(
        and(
          eq(contactCompanyAssociations.id, parsedInput.id),
          eq(contactCompanyAssociations.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({
        id: contactCompanyAssociations.id,
        contactId: contactCompanyAssociations.contactId,
      })
    if (result.length === 0) throw new ActionError("NOT_FOUND", "Association not found")
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contact_company_associations.role_updated",
      { resourceType: "contact_company_association", resourceId: parsedInput.id },
    )
    if (result[0]) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id: parsedInput.id }
  })

// ─── Bulk actions (P4.2 push 2c) ──────────────────────────────────────

/**
 * Bulk soft-delete N contacts. Emits one audit row per contact actually
 * affected (not per input id — silent on rows that were already deleted
 * or outside the org/RLS scope, matching the single-row deleteContact's
 * NOT_FOUND-then-throw shape).
 *
 * 200-id input cap (see types.ts BULK_ACTION_MAX_IDS). The per-row audit
 * loop bounds writes; for very large bulk ops the right tool is a
 * filter-refine + multiple bulk calls, not a single mega-action.
 */
export const bulkDeleteContacts = orgAction
  .metadata({ actionName: "contacts.bulk_delete" })
  .inputSchema(bulkDeleteContactsInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          inArray(contacts.id, parsedInput.ids),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id })
    for (const row of result) {
      await audit(
        {
          db: ctx.db,
          organizationId: ctx.activeOrg.id,
          actorUserId: ctx.session.user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        "contacts.deleted",
        { resourceType: "contact", resourceId: row.id, metadata: { bulk: true } },
      )
    }
    revalidatePath("/contacts")
    return { deletedIds: result.map((r) => r.id) }
  })

export const bulkChangeOwner = orgAction
  .metadata({ actionName: "contacts.bulk_change_owner" })
  .inputSchema(bulkChangeOwnerInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({
        ownerUserId: parsedInput.ownerUserId,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          inArray(contacts.id, parsedInput.ids),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id })
    for (const row of result) {
      await audit(
        {
          db: ctx.db,
          organizationId: ctx.activeOrg.id,
          actorUserId: ctx.session.user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        "contacts.updated",
        {
          resourceType: "contact",
          resourceId: row.id,
          metadata: { bulk: true, field: "ownerUserId", value: parsedInput.ownerUserId },
        },
      )
    }
    revalidatePath("/contacts")
    return { updatedIds: result.map((r) => r.id) }
  })

export const bulkChangeStatus = orgAction
  .metadata({ actionName: "contacts.bulk_change_status" })
  .inputSchema(bulkChangeStatusInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({
        lifecycleStatus: parsedInput.lifecycleStatus,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          inArray(contacts.id, parsedInput.ids),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
        ),
      )
      .returning({ id: contacts.id })
    for (const row of result) {
      await audit(
        {
          db: ctx.db,
          organizationId: ctx.activeOrg.id,
          actorUserId: ctx.session.user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        "contacts.updated",
        {
          resourceType: "contact",
          resourceId: row.id,
          metadata: {
            bulk: true,
            field: "lifecycleStatus",
            value: parsedInput.lifecycleStatus,
          },
        },
      )
    }
    revalidatePath("/contacts")
    return { updatedIds: result.map((r) => r.id) }
  })

/**
 * Bulk-add a tag. Skips rows where the tag is already present (array
 * containment via the `@>` op) so the per-row audit fires only on rows
 * that actually changed. Stored as `text[]`; we use `array_append`
 * on `COALESCE(tags, '{}'::text[])` so contacts with NULL tags pick up
 * a freshly-typed array.
 */
export const bulkAddTag = orgAction
  .metadata({ actionName: "contacts.bulk_add_tag" })
  .inputSchema(bulkAddTagInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({
        tags: sql`COALESCE(${contacts.tags}, '{}'::text[]) || ARRAY[${parsedInput.tag}]::text[]`,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          inArray(contacts.id, parsedInput.ids),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
          sql`NOT (COALESCE(${contacts.tags}, '{}'::text[]) @> ARRAY[${parsedInput.tag}]::text[])`,
        ),
      )
      .returning({ id: contacts.id })
    for (const row of result) {
      await audit(
        {
          db: ctx.db,
          organizationId: ctx.activeOrg.id,
          actorUserId: ctx.session.user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        "contacts.updated",
        {
          resourceType: "contact",
          resourceId: row.id,
          metadata: { bulk: true, field: "tags", op: "add", value: parsedInput.tag },
        },
      )
    }
    revalidatePath("/contacts")
    return { updatedIds: result.map((r) => r.id) }
  })

/**
 * Bulk-remove a tag. Symmetric to bulkAddTag — skips rows where the tag
 * isn't present so audit fires only on real changes. `array_remove`
 * preserves remaining elements + their order.
 */
export const bulkRemoveTag = orgAction
  .metadata({ actionName: "contacts.bulk_remove_tag" })
  .inputSchema(bulkRemoveTagInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(contacts)
      .set({
        tags: sql`array_remove(${contacts.tags}, ${parsedInput.tag})`,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          inArray(contacts.id, parsedInput.ids),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
          sql`${contacts.tags} @> ARRAY[${parsedInput.tag}]::text[]`,
        ),
      )
      .returning({ id: contacts.id })
    for (const row of result) {
      await audit(
        {
          db: ctx.db,
          organizationId: ctx.activeOrg.id,
          actorUserId: ctx.session.user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        "contacts.updated",
        {
          resourceType: "contact",
          resourceId: row.id,
          metadata: { bulk: true, field: "tags", op: "remove", value: parsedInput.tag },
        },
      )
    }
    revalidatePath("/contacts")
    return { updatedIds: result.map((r) => r.id) }
  })

export const removeContactCompanyAssociation = orgAction
  .metadata({ actionName: "contact_company_associations.remove" })
  .inputSchema(removeContactCompanyAssociationInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .delete(contactCompanyAssociations)
      .where(
        and(
          eq(contactCompanyAssociations.id, parsedInput.id),
          eq(contactCompanyAssociations.organizationId, ctx.activeOrg.id),
        ),
      )
      .returning({
        id: contactCompanyAssociations.id,
        contactId: contactCompanyAssociations.contactId,
      })
    if (result.length === 0) throw new ActionError("NOT_FOUND", "Association not found")
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contact_company_associations.removed",
      { resourceType: "contact_company_association", resourceId: parsedInput.id },
    )
    if (result[0]) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id: parsedInput.id }
  })
