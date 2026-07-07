import { sql } from "drizzle-orm"
import { pgTable, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * Push 3 (C2) — generic key/value preference store, user-scoped with
 * optional org scoping.
 *
 * `organization_id` is nullable. NULL = the pref is global to the
 * user across orgs (used for UI prefs like sidebar collapse state
 * that should follow the user regardless of which workspace they
 * switch into). When set, the pref is org-scoped (useful for
 * per-org view defaults a future module needs).
 *
 * No soft-delete columns. Prefs are key/value records — recreate
 * them as needed; rows that drop out of relevance are deleted.
 * Mirrors the precedent set by `terminology_map` (configuration
 * table, no soft-delete).
 *
 * Uniqueness is split into two partial indexes to handle the
 * NULL-organization_id case portably across pg versions. PG 15+
 * has `NULLS NOT DISTINCT` but the codebase targets earlier-
 * compatible syntax:
 *   - `(user_id, organization_id, key)` UNIQUE WHERE org IS NOT NULL
 *   - `(user_id, key)` UNIQUE WHERE org IS NULL
 *
 * RLS: enabled via migration. SELECT/INSERT/UPDATE/DELETE all
 * scoped to `user_id = current_setting('app.current_user_id', true)`.
 * orgAction / authAction set that GUC alongside `app.current_org`,
 * so the action layer continues working without changes.
 */
export const userPreferences = pgTable(
  "user_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_preferences_user_org_key_uidx")
      .on(t.userId, t.organizationId, t.key)
      .where(sql`${t.organizationId} IS NOT NULL`),
    uniqueIndex("user_preferences_user_key_global_uidx")
      .on(t.userId, t.key)
      .where(sql`${t.organizationId} IS NULL`),
    index("user_preferences_user_org_idx").on(t.userId, t.organizationId),
  ],
).enableRLS()

export type UserPreference = typeof userPreferences.$inferSelect
export type NewUserPreference = typeof userPreferences.$inferInsert
