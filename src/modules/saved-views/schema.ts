import { sql } from "drizzle-orm"
import { pgTable, text, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * Universal saved-query engine per Requirements §4.11. One row per
 * named view; every list in the app (Contacts, Events, Opportunities,
 * Tasks, Companies) reads from this engine. Vendor Matrix and Team
 * This Week are saved-view configurations, not bespoke features.
 *
 * Visibility model:
 *   - `owner_user_id` is the creator. Private views (`shared=false`)
 *     are visible only to the owner.
 *   - `shared=true` views are visible to every member of the org.
 *
 * RLS gives us org isolation. The owner-vs-shared visibility is
 * enforced at the queries.ts layer (not RLS) because pushing the
 * current user id into the RLS session settings would require another
 * set_config call — and the V1 RLS pattern only carries
 * `app.current_org` + `app.current_role`. Document this in the README;
 * Phase 4 may extend if a hard-policy boundary is needed.
 *
 * Mutation policy: owner-only writes. updateSavedView, deleteSavedView,
 * restoreSavedView throw FORBIDDEN if the requester isn't the owner.
 * Admins do not override in V1 — Phase 4 settings UI can add an admin
 * override action if needed.
 *
 * `filters jsonb` shape (loose; documented in types.ts):
 *   [{ field: "contactType", op: "eq", value: "Vendor" }, ...]
 *
 * `sort jsonb`: { field: "lastName", direction: "asc" } or an array
 * for multi-column.
 *
 * `visible_columns jsonb`: ["firstName", "lastName", "primaryEmail", ...]
 *
 * `grouping text`: a single column key, or NULL for ungrouped.
 *
 * Partial unique on (org, owner_user_id, object_type, name) prevents
 * a user from creating two same-named views of the same object type.
 * Different users can share a name. Soft-deleted names are recyclable.
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
    shared: boolean("shared").notNull().default(false),
    filters: jsonb("filters").$type<unknown[]>(),
    sort: jsonb("sort").$type<Record<string, unknown> | unknown[]>(),
    visibleColumns: jsonb("visible_columns").$type<string[]>(),
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
    // For "list shared views of this object type" — covered by the
    // (org, object_type, deleted_at) index above when combined with
    // a shared=true filter. A separate (org, object_type, shared,
    // deleted_at) index could be added if profiling shows it helps.
  ],
)

export type SavedView = typeof savedViews.$inferSelect
export type NewSavedView = typeof savedViews.$inferInsert
