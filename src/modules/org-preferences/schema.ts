import { pgPolicy, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization } from "@/modules/auth/schema"

/**
 * Per-org preferences (Commit 3). V1 holds the default share-link expiration
 * used by the email composer; future org-wide settings land here too. One row
 * per org. Org-isolation RLS (mirrors email_log / contacts); no triggers
 * (memory #13).
 */
export const orgPreferences = pgTable(
  "org_preferences",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** One of the 16 natural-language options (e.g. "1 month"). Default "1 month". */
    defaultShareLinkExpiration: text("default_share_link_expiration").notNull().default("1 month"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_preferences_org_uidx").on(t.organizationId),
    // Org-isolation RLS policy — mirrors email_log / contacts / etc.
    // FORCE RLS is hand-appended to the generated migration SQL (drizzle-kit
    // emits ENABLE, not FORCE) per AGENTS.md §10a.
    pgPolicy("org_preferences_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type OrgPreferences = typeof orgPreferences.$inferSelect
export type NewOrgPreferences = typeof orgPreferences.$inferInsert
