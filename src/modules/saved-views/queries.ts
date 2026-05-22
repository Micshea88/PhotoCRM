import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { savedViews, userObjectViewPrefs } from "./schema"

interface ListOptions {
  withDeleted?: boolean
}

/**
 * All saved views of one object type that the user can see. RLS at the
 * DB layer (saved_views_select policy) does the heavy lifting now —
 * the 3-tier visibility filter is enforced by the policy using
 * `app.current_user_id`. This query only adds the soft-delete filter +
 * object_type filter on top.
 *
 * The `userId` parameter remains in the signature for back-compat and
 * for testing contexts that want to assert visibility against a
 * specific user — but is no longer used to construct the WHERE clause.
 * The user identity comes from the RLS GUC.
 */
export async function listSavedViewsForObject(
  objectType: string,
  _userId: string,
  opts: ListOptions = {},
) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(savedViews.objectType, objectType)
      : and(eq(savedViews.objectType, objectType), isNull(savedViews.deletedAt))
    return tx.select().from(savedViews).where(where).orderBy(savedViews.name)
  })
}

/**
 * Single view by id. RLS gates visibility — returns null if the row
 * exists but the user can't see it.
 */
export async function getSavedViewForUser(id: string, _userId: string) {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(savedViews)
      .where(and(eq(savedViews.id, id), isNull(savedViews.deletedAt)))
      .limit(1)
    return row ?? null
  })
}

/**
 * Org-visible views for the active org, scoped by object type.
 * RLS will additionally let through 'shared_users' views the caller is
 * a member of and the caller's own views — use listSavedViewsForObject
 * if you want everything the caller can see; this one narrows to the
 * org-wide set only.
 */
export async function listSharedSavedViews(objectType: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.objectType, objectType),
          eq(savedViews.visibility, "org"),
          isNull(savedViews.deletedAt),
        ),
      )
      .orderBy(savedViews.name)
  })
}

/** A user's own views (private + the ones they own with shared visibility). */
export async function listMySavedViews(userId: string, objectType?: string) {
  return withOrgContext(async (tx) => {
    const where = objectType
      ? and(
          eq(savedViews.ownerUserId, userId),
          eq(savedViews.objectType, objectType),
          isNull(savedViews.deletedAt),
        )
      : and(eq(savedViews.ownerUserId, userId), isNull(savedViews.deletedAt))
    return tx.select().from(savedViews).where(where).orderBy(savedViews.objectType, savedViews.name)
  })
}

/**
 * Admin helper — list every view in the org regardless of owner /
 * visibility. RLS would normally hide private views from non-owners;
 * this helper is intended for an admin UI that runs with elevated
 * context. In V1 we have no such UI; the helper is provided for
 * completeness and tests.
 */
export async function listAllSavedViewsForOrg(opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(savedViews)
      .where(opts.withDeleted ? undefined : isNull(savedViews.deletedAt))
      .orderBy(savedViews.objectType, savedViews.name)
  })
}

/**
 * Returns the seeded org-default saved view for one object type, or
 * `null` if the org wasn't seeded. Default views have `is_default=true`
 * AND `owner_user_id IS NULL` AND `visibility='org'` per seed.ts —
 * they are immutable and visible to every member of the org. The RLS
 * SELECT policy includes a `is_default AND owner_user_id IS NULL`
 * branch so default views remain visible regardless of `app.current_user_id`.
 *
 * V1 seeds: `Team This Week` (objectType="task") and `All Contacts`
 * (objectType="contact"). The dashboard's "Team This Week" widget
 * calls this with "task" to load the spec.
 *
 * RLS-scoped via withOrgContext.
 */
export async function getDefaultSavedView(
  objectType: string,
): Promise<typeof savedViews.$inferSelect | null> {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.objectType, objectType),
          eq(savedViews.isDefault, true),
          isNull(savedViews.ownerUserId),
          isNull(savedViews.deletedAt),
        ),
      )
      .limit(1)
    return row ?? null
  })
}

/**
 * Per-user list-view preferences for one object type. Returns null if
 * the user has no prefs row yet (which is the common case for any user
 * who hasn't reordered tabs or visited /<object>s before).
 *
 * RLS: the user_object_view_prefs SELECT policy gates to own row
 * (user_id = app.current_user_id), so we don't need a manual
 * userId-filter here.
 */
export async function getUserViewPrefs(userId: string, objectType: string) {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(userObjectViewPrefs)
      .where(
        and(eq(userObjectViewPrefs.userId, userId), eq(userObjectViewPrefs.objectType, objectType)),
      )
      .limit(1)
    return row ?? null
  })
}

// Re-exported convenience; eslint flags it if entirely unused. Tests use it.
export const _sql = sql
