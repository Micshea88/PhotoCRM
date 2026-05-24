"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
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
  MAX_PINNED_VIEWS,
  restoreSavedViewInput,
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
    const id = createId()
    // Push 2c.6.2 — explicit-construction defaults moved from the
    // Zod *ForCreate schemas (which previously had .default(null))
    // into the handler body. Production logs after the 2c.6.1
    // Zod-level fix still showed empty params for these 4 columns
    // — Zod defaults weren't propagating to Drizzle through
    // next-safe-action. Building the values object as a separate
    // typed variable + an explicit `?? null` / `?? []` on every
    // nullable column is the bulletproof form: no inline expression
    // gymnastics, no dependence on Zod default semantics, no
    // ambiguity about what Drizzle receives.
    const sharedWithUserIds: string[] | null =
      parsedInput.visibility === "shared_users" ? (parsedInput.sharedWithUserIds ?? []) : null
    const filters = parsedInput.filters ?? null
    const sort = parsedInput.sort ?? null
    const columnConfig = parsedInput.columnConfig ?? []
    const grouping = parsedInput.grouping ?? null
    const customFields = parsedInput.customFields ?? null

    const values: typeof savedViews.$inferInsert = {
      id,
      organizationId: ctx.activeOrg.id,
      objectType: parsedInput.objectType,
      name: parsedInput.name,
      ownerUserId: ctx.session.user.id,
      visibility: parsedInput.visibility,
      sharedWithUserIds,
      filters,
      sort,
      columnConfig,
      grouping,
      customFields,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    }
    await ctx.db.insert(savedViews).values(values)
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
// user_object_view_prefs — per-user pinned tabs, default, last-viewed,
// page size.
// ──────────────────────────────────────────────────────────────────────

const updateViewPrefsInput = z.object({
  objectType: savedViewObjectTypeSchema,
  pinnedViewIds: z.array(z.string().min(1).max(64)).max(MAX_PINNED_VIEWS).optional(),
  lastViewedViewId: z.string().min(1).max(64).nullable().optional(),
  defaultViewId: z.string().min(1).max(64).nullable().optional(),
  contactPageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
})

/**
 * Upsert the caller's view prefs for one object type. Every field is
 * optional — pass only what's changing. The Drizzle composite-PK
 * upsert atomically inserts a row on first call and patches only the
 * provided fields on subsequent calls, so an "update only last_viewed"
 * doesn't blow away pinnedViewIds (and vice versa).
 *
 * The Zod schema caps pinnedViewIds at MAX_PINNED_VIEWS so a raw POST
 * with 50 ids fails Zod-side before reaching the DB. The dedicated
 * pinView action is the friendly-error path for "you already pinned
 * 6 — unpin one first".
 *
 * No audit: this is per-user UX state, not org-shared data.
 */
export const updateUserViewPrefs = orgAction
  .metadata({ actionName: "saved_views.prefs.update" })
  .inputSchema(updateViewPrefsInput)
  .action(async ({ parsedInput, ctx }) => {
    const insertValues = {
      organizationId: ctx.activeOrg.id,
      userId: ctx.session.user.id,
      objectType: parsedInput.objectType,
      pinnedViewIds: parsedInput.pinnedViewIds ?? [],
      lastViewedViewId: parsedInput.lastViewedViewId ?? null,
      defaultViewId: parsedInput.defaultViewId ?? null,
      contactPageSize: parsedInput.contactPageSize ?? 50,
      updatedAt: new Date(),
    }
    type Patch = Partial<typeof userObjectViewPrefs.$inferInsert>
    const updateSet: Patch = { updatedAt: new Date() }
    if (parsedInput.pinnedViewIds !== undefined) {
      updateSet.pinnedViewIds = parsedInput.pinnedViewIds
    }
    if (parsedInput.lastViewedViewId !== undefined) {
      updateSet.lastViewedViewId = parsedInput.lastViewedViewId
    }
    if (parsedInput.defaultViewId !== undefined) {
      updateSet.defaultViewId = parsedInput.defaultViewId
    }
    if (parsedInput.contactPageSize !== undefined) {
      updateSet.contactPageSize = parsedInput.contactPageSize
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

const pinViewInput = z.object({
  objectType: savedViewObjectTypeSchema,
  viewId: z.string().min(1).max(64),
})

/**
 * Add a view to the caller's pinned-tab list for one object_type.
 * Idempotent — re-pinning an already-pinned id is a no-op (no error).
 * 6-pinned-cap enforced here with a friendly error.
 *
 * The caller must be able to SEE the view via RLS — we re-select the
 * row first to fail-fast with NOT_FOUND instead of letting a stale
 * client-side id silently pin.
 */
export const pinView = orgAction
  .metadata({ actionName: "saved_views.pin" })
  .inputSchema(pinViewInput)
  .action(async ({ parsedInput, ctx }) => {
    const [view] = await ctx.db
      .select({ id: savedViews.id, objectType: savedViews.objectType })
      .from(savedViews)
      .where(
        and(
          eq(savedViews.id, parsedInput.viewId),
          eq(savedViews.organizationId, ctx.activeOrg.id),
          eq(savedViews.objectType, parsedInput.objectType),
          isNull(savedViews.deletedAt),
        ),
      )
      .limit(1)
    if (!view) throw new ActionError("NOT_FOUND", "Saved view not found")

    const [existing] = await ctx.db
      .select({ pinned: userObjectViewPrefs.pinnedViewIds })
      .from(userObjectViewPrefs)
      .where(
        and(
          eq(userObjectViewPrefs.organizationId, ctx.activeOrg.id),
          eq(userObjectViewPrefs.userId, ctx.session.user.id),
          eq(userObjectViewPrefs.objectType, parsedInput.objectType),
        ),
      )
      .limit(1)
    const current = existing?.pinned ?? []
    if (current.includes(parsedInput.viewId)) {
      return { ok: true as const }
    }
    if (current.length >= MAX_PINNED_VIEWS) {
      throw new ActionError(
        "CONFLICT",
        `You already pinned ${String(MAX_PINNED_VIEWS)} views. Unpin one before pinning another.`,
      )
    }
    const next = [...current, parsedInput.viewId]
    await ctx.db
      .insert(userObjectViewPrefs)
      .values({
        organizationId: ctx.activeOrg.id,
        userId: ctx.session.user.id,
        objectType: parsedInput.objectType,
        pinnedViewIds: next,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          userObjectViewPrefs.organizationId,
          userObjectViewPrefs.userId,
          userObjectViewPrefs.objectType,
        ],
        set: { pinnedViewIds: next, updatedAt: new Date() },
      })
    revalidatePath(`/${parsedInput.objectType}s`)
    return { ok: true as const }
  })

const unpinViewInput = z.object({
  objectType: savedViewObjectTypeSchema,
  viewId: z.string().min(1).max(64),
})

/**
 * Remove a view from the caller's pinned-tab list. Idempotent — if the
 * id isn't currently pinned, this is a no-op (no error). Unpinning does
 * NOT delete the saved view itself; it just hides it from the tab strip.
 * The view stays accessible via Manage views.
 *
 * If the unpinned view was also the caller's default_view_id, we
 * deliberately leave default_view_id alone — the page-load fallback
 * still resolves correctly via getSavedViewForUser, and re-pinning
 * later resurrects the tab.
 */
export const unpinView = orgAction
  .metadata({ actionName: "saved_views.unpin" })
  .inputSchema(unpinViewInput)
  .action(async ({ parsedInput, ctx }) => {
    const [existing] = await ctx.db
      .select({ pinned: userObjectViewPrefs.pinnedViewIds })
      .from(userObjectViewPrefs)
      .where(
        and(
          eq(userObjectViewPrefs.organizationId, ctx.activeOrg.id),
          eq(userObjectViewPrefs.userId, ctx.session.user.id),
          eq(userObjectViewPrefs.objectType, parsedInput.objectType),
        ),
      )
      .limit(1)
    const current = existing?.pinned ?? []
    if (!current.includes(parsedInput.viewId)) {
      return { ok: true as const }
    }
    const next = current.filter((id) => id !== parsedInput.viewId)
    await ctx.db
      .update(userObjectViewPrefs)
      .set({ pinnedViewIds: next, updatedAt: new Date() })
      .where(
        and(
          eq(userObjectViewPrefs.organizationId, ctx.activeOrg.id),
          eq(userObjectViewPrefs.userId, ctx.session.user.id),
          eq(userObjectViewPrefs.objectType, parsedInput.objectType),
        ),
      )
    revalidatePath(`/${parsedInput.objectType}s`)
    return { ok: true as const }
  })

const setDefaultViewInput = z.object({
  objectType: savedViewObjectTypeSchema,
  viewId: z.string().min(1).max(64).nullable(),
})

/**
 * Set the caller's default_view_id for one object_type. Pass `viewId:
 * null` to clear (falls back to the system All Contacts default at
 * page-load).
 *
 * The viewId, when non-null, must point at a view the caller can SEE
 * (RLS-gated) and that matches the object_type. We don't enforce
 * "must be one of your pinned views" — a user can default to a view
 * they have unpinned, and it'll resolve fine at page-load even if not
 * in the tab strip.
 */
export const setDefaultView = orgAction
  .metadata({ actionName: "saved_views.set_default" })
  .inputSchema(setDefaultViewInput)
  .action(async ({ parsedInput, ctx }) => {
    if (parsedInput.viewId !== null) {
      const [view] = await ctx.db
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(
          and(
            eq(savedViews.id, parsedInput.viewId),
            eq(savedViews.organizationId, ctx.activeOrg.id),
            eq(savedViews.objectType, parsedInput.objectType),
            isNull(savedViews.deletedAt),
          ),
        )
        .limit(1)
      if (!view) throw new ActionError("NOT_FOUND", "Saved view not found")
    }
    await ctx.db
      .insert(userObjectViewPrefs)
      .values({
        organizationId: ctx.activeOrg.id,
        userId: ctx.session.user.id,
        objectType: parsedInput.objectType,
        defaultViewId: parsedInput.viewId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          userObjectViewPrefs.organizationId,
          userObjectViewPrefs.userId,
          userObjectViewPrefs.objectType,
        ],
        set: { defaultViewId: parsedInput.viewId, updatedAt: new Date() },
      })
    revalidatePath(`/${parsedInput.objectType}s`)
    return { ok: true as const }
  })

// Re-exported for eslint completeness — same trick as queries._sql.
export const _sql = sql
