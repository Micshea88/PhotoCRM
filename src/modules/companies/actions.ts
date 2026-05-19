"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { companies } from "./schema"
import {
  createCompanyInput,
  deleteCompanyInput,
  restoreCompanyInput,
  updateCompanyInput,
} from "./types"

/**
 * Companies CRUD. No standalone /companies routes in V1 — the only UI
 * surface is the typeahead-with-inline-create picker embedded in
 * contacts (when that module ships). revalidatePath("/contacts") here
 * is forward-looking; today it's a no-op against a not-yet-rendered
 * route, which is safe and cheaper than guessing wrong about cache
 * boundaries.
 */
export const createCompany = orgAction
  .metadata({ actionName: "companies.create" })
  .inputSchema(createCompanyInput)
  .action(async ({ parsedInput, ctx }) => {
    const id = createId()
    await ctx.db.insert(companies).values({
      id,
      organizationId: ctx.activeOrg.id,
      name: parsedInput.name,
      website: parsedInput.website ?? null,
      mainPhone: parsedInput.mainPhone ?? null,
      instagramHandle: parsedInput.instagramHandle ?? null,
      category: parsedInput.category ?? null,
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
    const result = await ctx.db
      .update(companies)
      .set({
        ...rest,
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
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "companies.updated",
      { resourceType: "company", resourceId: id, metadata: rest },
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
