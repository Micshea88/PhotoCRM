"use server"

import { revalidatePath } from "next/cache"
import { and, count, eq, isNotNull, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { z } from "zod"
import { sql } from "drizzle-orm"
import { savedViews, userObjectViewPrefs } from "./schema"
import {
  createSavedViewInput,
  deleteSavedViewInput,
  duplicateSavedViewInput,
  restoreSavedViewInput,
  SAVED_VIEW_PER_USER_LIMIT,
  savedViewObjectTypeSchema,
  updateSavedViewInput,
} from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Owner-only mutation gate. Loads the view's owner and requester's
 * id, throws FORBIDDEN if they don't match. Used by update / delete /
 * restore. Admins do not override in V1 — Phase 4 settings module
 * can add an admin override action if needed.
 *
 * System defaults (owner_user_id IS NULL, is_default = true) are
 * implicitly protected: the RLS UPDATE/DELETE policies reject any
 * mutation where owner_user_id ≠ current user, AND the strict-!== on
 * null also fails here. Both belt-and-suspenders for immutability.
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
    // 8-view soft limit per user per object_type. System defaults
    // (owner_user_id IS NULL) do not count.
    const countRows = await ctx.db
      .select({ value: count() })
      .from(savedViews)
      .where(
        and(
          eq(savedViews.organizationId, ctx.activeOrg.id),
          eq(savedViews.ownerUserId, ctx.session.user.id),
          eq(savedViews.objectType, parsedInput.objectType),
          isNull(savedViews.deletedAt),
        ),
      )
    const existingCount = countRows[0]?.value ?? 0
    if (existingCount >= SAVED_VIEW_PER_USER_LIMIT) {
      throw new ActionError(
        "CONFLICT",
        `You've reached the maximum of ${String(SAVED_VIEW_PER_USER_LIMIT)} saved views for ${parsedInput.objectType}. Delete one first to save another.`,
      )
    }

    const id = createId()
    await ctx.db.insert(savedViews).values({
      id,
      organizationId: ctx.activeOrg.id,
      objectType: parsedInput.objectType,
      name: parsedInput.name,
      ownerUserId: ctx.session.user.id,
      visibility: parsedInput.visibility,
      sharedWithUserIds:
        parsedInput.visibility === "shared_users" ? (parsedInput.sharedWithUserIds ?? []) : null,
      filters: parsedInput.filters ?? null,
      sort: parsedInput.sort ?? null,
      columnConfig: parsedInput.columnConfig ?? [],
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
        metadata: {
          objectType: parsedInput.objectType,
          name: parsedInput.name,
          visibility: parsedInput.visibility,
        },
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
    if (rest.visibility !== undefined) {
      patch.visibility = rest.visibility
      // When flipping AWAY from shared_users, clear the shared list.
      // When flipping INTO shared_users, the input zod refine already
      // ensured sharedWithUserIds is non-empty.
      patch.sharedWithUserIds =
        rest.visibility === "shared_users" ? (rest.sharedWithUserIds ?? []) : null
    } else if (rest.sharedWithUserIds !== undefined) {
      // Caller is updating just the share list without changing visibility.
      patch.sharedWithUserIds = rest.sharedWithUserIds ?? null
    }
    if (rest.filters !== undefined) patch.filters = rest.filters
    if (rest.sort !== undefined) patch.sort = rest.sort
    if (rest.columnConfig !== undefined) patch.columnConfig = rest.columnConfig ?? []
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
 * Clone a view (including one created by someone else that the caller
 * can see) into a new private view owned by the current user. Useful
 * starting point for customizing a shared/org view without affecting
 * the original. The RLS SELECT policy is what gates whether the caller
 * can see the source row in the first place — the action just checks
 * that they can read it.
 */
export const duplicateSavedView = orgAction
  .metadata({ actionName: "saved_views.duplicate" })
  .inputSchema(duplicateSavedViewInput)
  .action(async ({ parsedInput, ctx }) => {
    // RLS gates the SELECT — if the caller can't see the source they
    // get NOT_FOUND, never FORBIDDEN.
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

    // 8-limit applies to the clone owner too.
    const dupCountRows = await ctx.db
      .select({ value: count() })
      .from(savedViews)
      .where(
        and(
          eq(savedViews.organizationId, ctx.activeOrg.id),
          eq(savedViews.ownerUserId, ctx.session.user.id),
          eq(savedViews.objectType, source.objectType),
          isNull(savedViews.deletedAt),
        ),
      )
    const existingCount = dupCountRows[0]?.value ?? 0
    if (existingCount >= SAVED_VIEW_PER_USER_LIMIT) {
      throw new ActionError(
        "CONFLICT",
        `You've reached the maximum of ${String(SAVED_VIEW_PER_USER_LIMIT)} saved views for ${source.objectType}. Delete one first to save another.`,
      )
    }

    const id = createId()
    await ctx.db.insert(savedViews).values({
      id,
      organizationId: ctx.activeOrg.id,
      objectType: source.objectType,
      name: parsedInput.newName,
      ownerUserId: ctx.session.user.id,
      visibility: "private",
      sharedWithUserIds: null,
      filters: source.filters,
      sort: source.sort,
      columnConfig: source.columnConfig,
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

// ──────────────────────────────────────────────────────────────────────
// user_object_view_prefs — per-user tab order + last-viewed
// ──────────────────────────────────────────────────────────────────────

const updateViewPrefsInput = z.object({
  objectType: savedViewObjectTypeSchema,
  orderedViewIds: z.array(z.string().min(1).max(64)).max(32).optional(),
  lastViewedViewId: z.string().min(1).max(64).nullable().optional(),
})

/**
 * Upsert the caller's view prefs for one object type. Both fields are
 * optional in the input — pass only the one you're changing. The other
 * stays as-is on update; on first-time insert it falls back to the
 * column default.
 *
 * No audit: this is per-user UX state, not org-shared data.
 */
export const updateUserViewPrefs = orgAction
  .metadata({ actionName: "saved_views.prefs.update" })
  .inputSchema(updateViewPrefsInput)
  .action(async ({ parsedInput, ctx }) => {
    // Drizzle's onConflictDoUpdate with composite PK lets us atomically
    // upsert. The .set() target uses excluded.<col> only for fields the
    // caller actually provided, so an "update only last_viewed" call
    // doesn't blow away orderedViewIds (and vice versa).
    const insertValues = {
      organizationId: ctx.activeOrg.id,
      userId: ctx.session.user.id,
      objectType: parsedInput.objectType,
      orderedViewIds: parsedInput.orderedViewIds ?? [],
      lastViewedViewId: parsedInput.lastViewedViewId ?? null,
      updatedAt: new Date(),
    }
    type Patch = Partial<typeof userObjectViewPrefs.$inferInsert>
    const updateSet: Patch = { updatedAt: new Date() }
    if (parsedInput.orderedViewIds !== undefined) {
      updateSet.orderedViewIds = parsedInput.orderedViewIds
    }
    if (parsedInput.lastViewedViewId !== undefined) {
      updateSet.lastViewedViewId = parsedInput.lastViewedViewId
    }
    await ctx.db
      .insert(userObjectViewPrefs)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [
          userObjectViewPrefs.organizationId,
          userObjectViewPrefs.userId,
          userObjectViewPrefs.objectType,
        ],
        set: updateSet,
      })
    revalidatePath(`/${parsedInput.objectType}s`)
    return { ok: true as const }
  })

// Re-exported for eslint completeness — same trick as queries._sql.
export const _sql = sql
