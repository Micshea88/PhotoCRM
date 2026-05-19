"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { log } from "@/lib/log"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { companies } from "@/modules/companies/schema"
import { listFieldDefinitionsForRecordType } from "@/modules/custom-fields/queries"
import { validateCustomFieldsPayload } from "@/modules/custom-fields/validators"
import { contacts } from "./schema"
import {
  createContactInput,
  deleteContactInput,
  restoreContactInput,
  updateContactInput,
} from "./types"

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
