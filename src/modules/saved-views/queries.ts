import "server-only"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { savedViews } from "./schema"

interface ListOptions {
  withDeleted?: boolean
}

/**
 * All saved views of one object type that the user can see — i.e.,
 * their own + every shared view in the org. RLS scopes to org; the
 * owner-vs-shared filter is applied here.
 *
 * `userId` is the authenticated user resolving the list. The action
 * layer passes `ctx.session.user.id`; tests can pass any string.
 */
export async function listSavedViewsForObject(
  objectType: string,
  userId: string,
  opts: ListOptions = {},
) {
  return withOrgContext(async (tx) => {
    const visibility = or(eq(savedViews.ownerUserId, userId), eq(savedViews.shared, true))
    const where = opts.withDeleted
      ? and(eq(savedViews.objectType, objectType), visibility)
      : and(eq(savedViews.objectType, objectType), visibility, isNull(savedViews.deletedAt))
    return tx.select().from(savedViews).where(where).orderBy(savedViews.name)
  })
}

/**
 * Single view, scoped by the same owner-or-shared visibility. Returns
 * null if the view exists but the user can't see it (private + not
 * the owner).
 */
export async function getSavedViewForUser(id: string, userId: string) {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.id, id),
          or(eq(savedViews.ownerUserId, userId), eq(savedViews.shared, true)),
          isNull(savedViews.deletedAt),
        ),
      )
      .limit(1)
    return row ?? null
  })
}

/** Shared views for the active org, scoped by object type. */
export async function listSharedSavedViews(objectType: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(savedViews)
      .where(
        and(
          eq(savedViews.objectType, objectType),
          eq(savedViews.shared, true),
          isNull(savedViews.deletedAt),
        ),
      )
      .orderBy(savedViews.name)
  })
}

/** A user's own views (private + shared). */
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
 * shared. Used by the Phase 4 settings admin UI; do NOT use from
 * user-facing routes.
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
 * `null` if the org wasn't seeded (no auto-seed for organizations
 * created before the default-view seed shipped). Default views have
 * `is_default=true` AND `owner_user_id IS NULL` AND `shared=true` per
 * seed.ts's "default-view semantics" docblock — they are immutable and
 * visible to every member of the org.
 *
 * V1 has one seed: `Team This Week` (objectType="task"). The P4.1
 * dashboard's "Team This Week" widget calls this with `"task"` to
 * load the spec, then resolves the `<startOfWeek>` / `<endOfWeek>`
 * placeholders against the current US Sunday-Saturday week (LOC1).
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

// Re-exported convenience; eslint flags it if entirely unused. Tests use it.
export const _sql = sql
