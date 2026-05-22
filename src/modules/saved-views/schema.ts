import { sql } from "drizzle-orm"
import { pgTable, text, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * Universal saved-query engine per Requirements §4.11. One row per
 * named view; every list in the app (Contacts, Events, Opportunities,
 * Tasks, Companies) reads from this engine. Vendor Matrix and Team
 * This Week are saved-view configurations, not bespoke features.
 *
 * ─── VISIBILITY (3-tier, as of Push 2b) ───────────────────────────────
 *
 *   visibility = 'private'       → only the owner can see / use it
 *   visibility = 'shared_users'  → owner + users listed in
 *                                  shared_with_user_ids can see / use it
 *   visibility = 'org'           → every member of the org can see / use it
 *
 * RLS enforces this AT THE DATABASE LAYER (3-tier policy, not
 * queries-layer). The `app.current_user_id` GUC is set by
 * runWithOrgContext / safe-action — so the RLS policy resolves
 * "is the current user the owner / in shared_with_user_ids" on every
 * SELECT. Mutation policies (INSERT/UPDATE/DELETE) are scoped to
 * owner-only, with an explicit carve-out for system-default rows
 * (owner_user_id IS NULL AND is_default = true) so the
 * seedDefaultSavedViewsForOrg path can insert them.
 *
 * ─── COLUMN CONFIG (per-view layout, as of Push 2b) ───────────────────
 *
 * `column_config jsonb` replaces the old `visible_columns text[]`. Each
 * entry is `{ id, visible, width, order }`. Encodes column order +
 * visibility + width in one structure so the edit-columns drawer and
 * direct table-header drag can both persist into one place.
 *
 * `sort jsonb`: { field: "lastName", direction: "asc" } or an array.
 *
 * `grouping text`: a single column key, or NULL for ungrouped.
 *
 * `filters jsonb`: array of { field, op, value }. See types.ts.
 *
 * ─── SEEDED DEFAULTS ──────────────────────────────────────────────────
 *
 * `owner_user_id IS NULL` + `is_default = true` + `visibility = 'org'`
 * marks an immutable system default ("All Contacts", "Team This Week").
 * Owner-only mutation enforcement at the action layer + RLS WITH CHECK
 * means no user can edit/delete these. The duplicate action gives users
 * a private clone they can customize.
 *
 * ─── INDEXES ──────────────────────────────────────────────────────────
 *
 * Partial unique on (org, owner_user_id, object_type, name) WHERE
 * deleted_at IS NULL prevents same-named views per user per object
 * type. Different users can share names. Soft-deleted names recyclable.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    objectType: text("object_type").notNull(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    visibility: text("visibility").notNull().default("private"),
    sharedWithUserIds: text("shared_with_user_ids").array().$type<string[]>(),
    filters: jsonb("filters").$type<unknown[]>(),
    sort: jsonb("sort").$type<Record<string, unknown> | unknown[]>(),
    columnConfig: jsonb("column_config")
      .$type<{ id: string; visible: boolean; width: number | null; order: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    grouping: text("grouping"),
    isDefault: boolean("is_default").notNull().default(false),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("saved_views_org_owner_object_name_uidx")
      .on(t.organizationId, t.ownerUserId, t.objectType, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index("saved_views_org_object_deleted_idx").on(t.organizationId, t.objectType, t.deletedAt),
    index("saved_views_org_owner_deleted_idx").on(t.organizationId, t.ownerUserId, t.deletedAt),
    index("saved_views_org_visibility_idx").on(t.organizationId, t.visibility),
  ],
)

export type SavedView = typeof savedViews.$inferSelect
export type NewSavedView = typeof savedViews.$inferInsert

/**
 * Per-user, per-object-type list-view preferences. Records:
 *   - `ordered_view_ids` — drag-reorder tab order for the saved-view
 *     tab strip on /<object>s. Views not present in this array render
 *     after the ordered ones (by createdAt ASC), giving a sensible
 *     default for new views the user hasn't reordered yet.
 *   - `last_viewed_view_id` — the view to land on when the user opens
 *     /<object>s without an explicit ?view= param. ON DELETE SET NULL
 *     against saved_views.id, so a deleted view doesn't wedge the
 *     fallback.
 *
 * "All Contacts" (the system default) is NEVER in ordered_view_ids —
 * it is always rendered leftmost separately. Storing it would just
 * couple user prefs to seed identity.
 *
 * RLS: each user sees / writes their own row only.
 */
export const userObjectViewPrefs = pgTable(
  "user_object_view_prefs",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    orderedViewIds: text("ordered_view_ids")
      .array()
      .$type<string[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastViewedViewId: text("last_viewed_view_id").references(() => savedViews.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_object_view_prefs_pk").on(t.organizationId, t.userId, t.objectType)],
)

export type UserObjectViewPrefs = typeof userObjectViewPrefs.$inferSelect
export type NewUserObjectViewPrefs = typeof userObjectViewPrefs.$inferInsert
