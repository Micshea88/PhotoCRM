"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { savedViews } from "./schema"
import {
  createSavedViewInput,
  deleteSavedViewInput,
  duplicateSavedViewInput,
  restoreSavedViewInput,
  updateSavedViewInput,
} from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Owner-only mutation gate. Loads the view's owner and requester's
 * id, throws FORBIDDEN if they don't match. Used by update / delete /
 * restore. Admins do not override in V1 — Phase 4 settings module
 * can add an admin override action if needed.
 *
 * Returns the row's `objectType` for revalidatePath/audit context.
 */
async function assertOwnedByUser(
  db: DbHandle,
  viewId: string,
  orgId: string,
  userId: string,
  includeDeleted = false,
) {
  const where = includeDeleted
    ? and(eq(savedViews.id, viewId), eq(savedViews.organizationId, orgId))
    : and(
        eq(savedViews.id, viewId),
        eq(savedViews.organizationId, orgId),
        isNull(savedViews.deletedAt),
      )
  const [row] = await db
    .select({
      id: savedViews.id,
      ownerUserId: savedViews.ownerUserId,
      objectType: savedViews.objectType,
    })
    .from(savedViews)
    .where(where)
    .limit(1)
  if (!row) {
    throw new ActionError("NOT_FOUND", "Saved view not found")
  }
  if (row.ownerUserId !== userId) {
    throw new ActionError("FORBIDDEN", "Only the owner can edit or delete this saved view.")
  }
  return row
}

export const createSavedView = orgAction
  .metadata({ actionName: "saved_views.create" })
  .inputSchema(createSavedViewInput)
  .action(async ({ parsedInput, ctx }) => {
    const id = createId()
    await ctx.db.insert(savedViews).values({
      id,
      organizationId: ctx.activeOrg.id,
      objectType: parsedInput.objectType,
      name: parsedInput.name,
      ownerUserId: ctx.session.user.id,
      shared: parsedInput.shared,
      filters: parsedInput.filters ?? null,
      sort: parsedInput.sort ?? null,
      visibleColumns: parsedInput.visibleColumns ?? null,
      grouping: parsedInput.grouping ?? null,
      customFields: parsedInput.customFields ?? null,
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
      "saved_views.created",
      {
        resourceType: "saved_view",
        resourceId: id,
        metadata: { objectType: parsedInput.objectType, name: parsedInput.name },
      },
    )
    revalidatePath(`/${parsedInput.objectType}s`)
    return { id }
  })

export const updateSavedView = orgAction
  .metadata({ actionName: "saved_views.update" })
  .inputSchema(updateSavedViewInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    const ownedRow = await assertOwnedByUser(ctx.db, id, ctx.activeOrg.id, ctx.session.user.id)

    type Patch = Partial<typeof savedViews.$inferInsert>
    const patch: Patch = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.name !== undefined) patch.name = rest.name
    if (rest.shared !== undefined) patch.shared = rest.shared
    if (rest.filters !== undefined) patch.filters = rest.filters
    if (rest.sort !== undefined) patch.sort = rest.sort
    if (rest.visibleColumns !== undefined) patch.visibleColumns = rest.visibleColumns
    if (rest.grouping !== undefined) patch.grouping = rest.grouping
    if ("customFields" in rest) patch.customFields = rest.customFields ?? null

    await ctx.db.update(savedViews).set(patch).where(eq(savedViews.id, id))
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "saved_views.updated",
      { resourceType: "saved_view", resourceId: id, metadata: rest },
    )
    revalidatePath(`/${ownedRow.objectType}s`)
    return { id }
  })

export const deleteSavedView = orgAction
  .metadata({ actionName: "saved_views.delete" })
  .inputSchema(deleteSavedViewInput)
  .action(async ({ parsedInput, ctx }) => {
    const ownedRow = await assertOwnedByUser(
      ctx.db,
      parsedInput.id,
      ctx.activeOrg.id,
      ctx.session.user.id,
    )
    await ctx.db
      .update(savedViews)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(eq(savedViews.id, parsedInput.id))
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "saved_views.deleted",
      { resourceType: "saved_view", resourceId: parsedInput.id },
    )
    revalidatePath(`/${ownedRow.objectType}s`)
    return { id: parsedInput.id }
  })

export const restoreSavedView = orgAction
  .metadata({ actionName: "saved_views.restore" })
  .inputSchema(restoreSavedViewInput)
  .action(async ({ parsedInput, ctx }) => {
    const ownedRow = await assertOwnedByUser(
      ctx.db,
      parsedInput.id,
      ctx.activeOrg.id,
      ctx.session.user.id,
      true, // include soft-deleted
    )
    await ctx.db
      .update(savedViews)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(savedViews.id, parsedInput.id), isNotNull(savedViews.deletedAt)))
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "saved_views.restored",
      { resourceType: "saved_view", resourceId: parsedInput.id },
    )
    revalidatePath(`/${ownedRow.objectType}s`)
    return { id: parsedInput.id }
  })

/**
 * Clone a view (including a shared view created by someone else) into
 * a new private view owned by the current user. Useful starting point
 * for customizing a shared view without affecting the original.
 */
export const duplicateSavedView = orgAction
  .metadata({ actionName: "saved_views.duplicate" })
  .inputSchema(duplicateSavedViewInput)
  .action(async ({ parsedInput, ctx }) => {
    // Load the source view — must be visible to the user (own or shared).
    const [source] = await ctx.db
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.id, parsedInput.id),
          eq(savedViews.organizationId, ctx.activeOrg.id),
          isNull(savedViews.deletedAt),
        ),
      )
      .limit(1)
    if (!source) {
      throw new ActionError("NOT_FOUND", "Saved view not found")
    }
    if (source.ownerUserId !== ctx.session.user.id && !source.shared) {
      throw new ActionError("FORBIDDEN", "Cannot duplicate a private view you don't own.")
    }

    const id = createId()
    await ctx.db.insert(savedViews).values({
      id,
      organizationId: ctx.activeOrg.id,
      objectType: source.objectType,
      name: parsedInput.newName,
      ownerUserId: ctx.session.user.id,
      shared: false,
      filters: source.filters,
      sort: source.sort,
      visibleColumns: source.visibleColumns,
      grouping: source.grouping,
      customFields: source.customFields,
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
      "saved_views.duplicated",
      {
        resourceType: "saved_view",
        resourceId: id,
        metadata: { sourceId: parsedInput.id, newName: parsedInput.newName },
      },
    )
    revalidatePath(`/${source.objectType}s`)
    return { id }
  })
