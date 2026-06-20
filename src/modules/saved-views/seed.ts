import { createId } from "@paralleldrive/cuid2"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { savedViews } from "./schema"
import type { ColumnConfigItem } from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Default saved views seeded per organization. Per Requirements §4.10 +
 * §4.11, Team This Week and All Contacts are saved-view CONFIGURATIONS
 * over existing data (tasks, contacts), not bespoke features.
 *
 * ─── DEFAULT-VIEW SEMANTICS ───────────────────────────────────────────
 *
 * `owner_user_id = NULL` + `is_default = true` + `visibility = 'org'`:
 *
 *   - VISIBLE to every org member (RLS SELECT policy has an explicit
 *     branch for is_default-with-null-owner).
 *   - IMMUTABLE — the RLS UPDATE/DELETE policies reject mutations
 *     where owner_user_id ≠ current_user. NULL ≠ any real user id, so
 *     no one can mutate these. The action layer enforces the same.
 *   - CUSTOMIZABLE via `duplicateSavedView` — the clone is private +
 *     owned by the caller.
 *
 * "This week" date placeholders (`<startOfWeek>` / `<endOfWeek>`) are
 * resolved at render time by the list-view renderer in the caller's
 * timezone. Storing concrete dates at seed time would freeze the
 * window to org-create day.
 *
 * PHASE 4 (future) — when that placeholder resolver is built, it MUST use
 * the ISO 8601 Monday–Sunday week (Mike, 2026-06-20), matching the
 * dashboard's `resolveMondaySundayWeek` in src/lib/format. Do NOT
 * reintroduce a Sunday-start week here.
 *
 * ─── IDEMPOTENCY ──────────────────────────────────────────────────────
 *
 * Partial unique index does NOT prevent duplicate inserts with
 * `owner_user_id = NULL` (Postgres treats NULLs as distinct in unique
 * indexes by default). We do an explicit existence check before
 * insert, scoped by (org, object_type, name, is_default, owner_user_id
 * IS NULL, deleted_at IS NULL).
 */

interface DefaultSavedView {
  objectType: string
  name: string
  filters: unknown[]
  sort: Record<string, unknown> | unknown[]
  columnConfig: ColumnConfigItem[]
  grouping: string | null
}

function columnsAsConfig(ids: string[]): ColumnConfigItem[] {
  return ids.map((id, index) => ({ id, visible: true, order: index, width: null }))
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
    columnConfig: columnsAsConfig(["assigneeUserId", "title", "dueDate", "status", "priority"]),
    grouping: "assigneeUserId",
  },
  // P4.2 — the contacts list is saved-view powered. "All Contacts" is the
  // immutable org-wide default tab; users create custom views by
  // duplicating or starting from scratch. The column_config here is the
  // org-wide default; per-user column tweaks land on a duplicated view
  // (per the "force Save as new view on All Contacts" UX rule).
  {
    objectType: "contact",
    name: "All Contacts",
    filters: [],
    sort: { field: "lastName", direction: "asc" },
    columnConfig: columnsAsConfig([
      "displayLabel",
      "primaryEmail",
      "primaryPhone",
      "contactType",
      "lifecycleStatus",
      "tags",
    ]),
    grouping: null,
  },
]

/**
 * Idempotent seed for the V1 default saved views. Bootstrap-trust:
 * caller MUST have set `app.current_org` to `orgId` first — the RLS
 * INSERT policy requires it. Both production callers (the BA
 * org-create hook and the dev seed script) satisfy this.
 *
 * Note on RLS INSERT: the policy allows inserts where owner_user_id
 * IS NULL AND is_default = true regardless of app.current_user_id,
 * so the seed runs even from contexts that don't set that GUC.
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
      visibility: "org",
      filters: view.filters,
      sort: view.sort,
      columnConfig: view.columnConfig,
      grouping: view.grouping,
      isDefault: true,
    })
  }
}
