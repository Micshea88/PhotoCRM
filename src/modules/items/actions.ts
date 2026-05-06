"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull, isNotNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { items } from "./schema"
import { createItemInput, deleteItemInput, restoreItemInput, updateItemInput } from "./types"

export const createItem = orgAction
  .metadata({ actionName: "items.create" })
  .inputSchema(createItemInput)
  .action(async ({ parsedInput, ctx }) => {
    const id = createId()
    await ctx.db.insert(items).values({
      id,
      organizationId: ctx.activeOrg.id,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
      name: parsedInput.name,
      description: parsedInput.description,
      status: parsedInput.status,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "item.created",
      { resourceType: "item", resourceId: id },
    )
    revalidatePath("/items")
    return { id }
  })

export const updateItem = orgAction
  .metadata({ actionName: "items.update" })
  .inputSchema(updateItemInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const result = await ctx.db
      .update(items)
      .set({
        ...rest,
        updatedAt: new Date(),
        updatedBy: ctx.session.user.id,
      })
      .where(
        and(eq(items.id, id), eq(items.organizationId, ctx.activeOrg.id), isNull(items.deletedAt)),
      )
      .returning({ id: items.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Item not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "item.updated",
      { resourceType: "item", resourceId: id, metadata: rest },
    )
    revalidatePath("/items")
    revalidatePath(`/items/${id}`)
    return { id }
  })

export const deleteItem = orgAction
  .metadata({ actionName: "items.delete" })
  .inputSchema(deleteItemInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(items)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.session.user.id,
      })
      .where(
        and(
          eq(items.id, parsedInput.id),
          eq(items.organizationId, ctx.activeOrg.id),
          isNull(items.deletedAt),
        ),
      )
      .returning({ id: items.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Item not found or already deleted")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "item.deleted",
      { resourceType: "item", resourceId: parsedInput.id },
    )
    revalidatePath("/items")
    return { id: parsedInput.id }
  })

export const restoreItem = orgAction
  .metadata({ actionName: "items.restore" })
  .inputSchema(restoreItemInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(items)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(items.id, parsedInput.id),
          eq(items.organizationId, ctx.activeOrg.id),
          isNotNull(items.deletedAt),
        ),
      )
      .returning({ id: items.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Deleted item not found")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "item.restored",
      { resourceType: "item", resourceId: parsedInput.id },
    )
    revalidatePath("/items")
    return { id: parsedInput.id }
  })
