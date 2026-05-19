import { createId } from "@paralleldrive/cuid2"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { savedViews } from "./schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Default saved views seeded per organization. Per Requirements §4.10 +
 * §4.11, Team This Week and Vendor Matrix are saved-view CONFIGURATIONS
 * over existing data (tasks, contacts), not bespoke features.
 *
 * V1 seeds Team This Week only — its column keys (`assigneeUserId`,
 * `title`, `dueDate`, `status`, `priority`) all exist on the tasks
 * schema today. Vendor Matrix is documented in the README example as
 * the equivalent contact config; it can be seeded once the contacts
 * list-view renderer ships and confirms its column keys.
 *
 * ─── DEFAULT-VIEW SEMANTICS ───────────────────────────────────────────
 *
 * `owner_user_id = NULL` + `is_default = true` + `shared = true`:
 *
 *   - VISIBLE to every org member (org RLS + shared=true).
 *   - IMMUTABLE — the owner-only mutation rule throws FORBIDDEN for any
 *     caller because no requester can match a NULL owner. The seeded
 *     default cannot be edited or soft-deleted by users.
 *   - CUSTOMIZABLE via `duplicateSavedView` — the clone is private +
 *     owned by the caller (per `actions.ts:duplicateSavedView`). This
 *     is the V1 workflow for "I want a tweaked version of the default."
 *
 * The "this week" date window is stored as the literal placeholder
 * strings `<startOfWeek>` / `<endOfWeek>`; the Phase 4 task list-view
 * renderer resolves them at render time against the caller's
 * timezone. Storing concrete dates at seed time would freeze the
 * window to org-create day.
 *
 * ─── IDEMPOTENCY ──────────────────────────────────────────────────────
 *
 * The partial unique index on (org, owner_user_id, object_type, name)
 * does NOT prevent duplicate inserts with `owner_user_id = NULL`
 * because Postgres treats NULLs as distinct in unique indexes by
 * default. So we do an explicit existence check instead of
 * onConflictDoNothing.
 */

interface DefaultSavedView {
  objectType: string
  name: string
  filters: unknown[]
  sort: Record<string, unknown> | unknown[]
  visibleColumns: string[]
  grouping: string | null
}

const DEFAULT_SAVED_VIEWS: DefaultSavedView[] = [
  {
    objectType: "task",
    name: "Team This Week",
    filters: [
      { field: "dueDate", op: "gte", value: "<startOfWeek>" },
      { field: "dueDate", op: "lte", value: "<endOfWeek>" },
    ],
    sort: { field: "dueDate", direction: "asc" },
    visibleColumns: ["assigneeUserId", "title", "dueDate", "status", "priority"],
    grouping: "assigneeUserId",
  },
]

/**
 * Idempotent seed for the V1 default saved views. Bootstrap-trust:
 * caller MUST have set `app.current_org` to `orgId` first — RLS WITH
 * CHECK on saved_views requires it. Both production callers (the BA
 * org-create hook and the dev seed script) satisfy this.
 */
export async function seedDefaultSavedViewsForOrg(db: DbHandle, orgId: string): Promise<void> {
  for (const view of DEFAULT_SAVED_VIEWS) {
    const existing = await db
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(
        and(
          eq(savedViews.organizationId, orgId),
          eq(savedViews.objectType, view.objectType),
          eq(savedViews.name, view.name),
          eq(savedViews.isDefault, true),
          isNull(savedViews.ownerUserId),
          isNull(savedViews.deletedAt),
        ),
      )
      .limit(1)
    if (existing.length > 0) continue
    await db.insert(savedViews).values({
      id: createId(),
      organizationId: orgId,
      objectType: view.objectType,
      name: view.name,
      ownerUserId: null,
      shared: true,
      filters: view.filters,
      sort: view.sort,
      visibleColumns: view.visibleColumns,
      grouping: view.grouping,
      isDefault: true,
    })
  }
}
