"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import {
  prepareCustomFieldsForCreate,
  prepareCustomFieldsForUpdate,
} from "@/modules/custom-fields/host-helpers"
import type { CustomFieldChange } from "@/modules/custom-fields/changes"
import { companies } from "./schema"
import {
  createCompanyInput,
  deleteCompanyInput,
  restoreCompanyInput,
  updateCompanyInput,
} from "./types"

const COMPANY_RECORD_TYPE = "company"

/**
 * Companies CRUD. No standalone /companies routes in V1 — the only UI
 * surface is the typeahead-with-inline-create picker embedded in
 * contacts (when that module ships). revalidatePath("/contacts") here
 * is forward-looking; today it's a no-op against a not-yet-rendered
 * route, which is safe and cheaper than guessing wrong about cache
 * boundaries.
 *
 * TODO Push P4.x (Companies UI): wire CustomFieldsRenderer into the
 * company form. Use listActiveFieldDefinitionsForRecordType('company')
 * for the form rendering. The engine + validators are wired here;
 * the UI is the only remaining work.
 *
 * TODO Push P4.x (Companies list UI): the saved-views custom-field
 * column / filter / sort plumbing is entity-agnostic (see
 * src/modules/custom-fields/ui/column-helpers.ts and the contacts
 * list integration in /contacts/page.tsx). The companies list page
 * should call listActiveFieldDefinitionsForRecordType('company') for
 * the Edit Columns + More Filters drawers, and the saved-view
 * filters jsonb will pick up `customField.<fieldId>` entries
 * automatically via the same `field:` namespacing.
 */
export const createCompany = orgAction
  .metadata({ actionName: "companies.create" })
  .inputSchema(createCompanyInput)
  .action(async ({ parsedInput, ctx }) => {
    const id = createId()
    const { value: validatedCustomFields } = await prepareCustomFieldsForCreate(
      ctx.db,
      COMPANY_RECORD_TYPE,
      parsedInput.customFields,
    )
    await ctx.db.insert(companies).values({
      id,
      organizationId: ctx.activeOrg.id,
      name: parsedInput.name,
      website: parsedInput.website ?? null,
      mainPhone: parsedInput.mainPhone ?? null,
      instagramHandle: parsedInput.instagramHandle ?? null,
      category: parsedInput.category ?? null,
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
      "companies.created",
      { resourceType: "company", resourceId: id, metadata: { name: parsedInput.name } },
    )
    revalidatePath("/contacts")
    return { id }
  })

export const updateCompany = orgAction
  .metadata({ actionName: "companies.update" })
  .inputSchema(updateCompanyInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput

    let patchedRest: typeof rest = rest
    let customFieldChanges: CustomFieldChange[] = []
    if ("customFields" in rest) {
      const [existingRow] = await ctx.db
        .select({ customFields: companies.customFields })
        .from(companies)
        .where(
          and(
            eq(companies.id, id),
            eq(companies.organizationId, ctx.activeOrg.id),
            isNull(companies.deletedAt),
          ),
        )
        .limit(1)
      if (!existingRow) {
        throw new ActionError("NOT_FOUND", "Company not found")
      }
      const prep = await prepareCustomFieldsForUpdate(
        ctx.db,
        COMPANY_RECORD_TYPE,
        existingRow.customFields,
        rest.customFields,
      )
      patchedRest = { ...rest, customFields: prep.value }
      customFieldChanges = prep.changes
    }

    const result = await ctx.db
      .update(companies)
      .set({
        ...patchedRest,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(companies.id, id),
          eq(companies.organizationId, ctx.activeOrg.id),
          isNull(companies.deletedAt),
        ),
      )
      .returning({ id: companies.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Company not found")
    }
    const auditMetadata: Record<string, unknown> = { ...rest }
    if (customFieldChanges.length > 0) {
      auditMetadata.customFieldChanges = customFieldChanges
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "companies.updated",
      { resourceType: "company", resourceId: id, metadata: auditMetadata },
    )
    revalidatePath("/contacts")
    return { id }
  })

export const deleteCompany = orgAction
  .metadata({ actionName: "companies.delete" })
  .inputSchema(deleteCompanyInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(companies)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(companies.id, parsedInput.id),
          eq(companies.organizationId, ctx.activeOrg.id),
          isNull(companies.deletedAt),
        ),
      )
      .returning({ id: companies.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Company not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "companies.deleted",
      { resourceType: "company", resourceId: parsedInput.id },
    )
    revalidatePath("/contacts")
    return { id: parsedInput.id }
  })

export const restoreCompany = orgAction
  .metadata({ actionName: "companies.restore" })
  .inputSchema(restoreCompanyInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(companies)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(companies.id, parsedInput.id),
          eq(companies.organizationId, ctx.activeOrg.id),
          isNotNull(companies.deletedAt),
        ),
      )
      .returning({ id: companies.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Deleted company not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "companies.restored",
      { resourceType: "company", resourceId: parsedInput.id },
    )
    revalidatePath("/contacts")
    return { id: parsedInput.id }
  })
