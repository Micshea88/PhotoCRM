import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * Per-organization overrides for the lead-source dropdown.
 *
 * Background: the LeadSourceCombobox displays a union of (seeded
 * defaults: Vendor referral / Client referral / Google / Instagram /
 * Facebook / Website / Networking event / Other) + (custom values
 * currently in use on contacts in this org). Studios may want to hide
 * some of those — e.g., a wedding studio that doesn't run Facebook
 * ads doesn't want "Facebook" cluttering the picker.
 *
 * This table stores ONE row per org-and-source-name pair that the
 * org has hidden. The combobox + filter chip query this table at
 * render time and exclude any matching name from the visible options.
 *
 * Status column: `'hidden'` is the only V1 value. Modeled as a column
 * (not a boolean) so future status values (e.g., `'pinned'`, `'archived'`)
 * are an additive change rather than a schema refactor.
 *
 * NOT a tombstone of the source value itself — existing contacts that
 * carry the hidden source on their `lead_source` column KEEP that value.
 * The override only affects the dropdown UI. Truly destroying a lead
 * source value (clearing it off every contact + deleting the override)
 * is `deleteLeadSourceValue` in actions.ts, which is a different action.
 */
export const orgLeadSourceOverrides = pgTable(
  "org_lead_source_overrides",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sourceName: text("source_name").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("org_lead_source_overrides_org_name_uidx").on(t.organizationId, t.sourceName),
  ],
)

export type OrgLeadSourceOverride = typeof orgLeadSourceOverrides.$inferSelect
export type NewOrgLeadSourceOverride = typeof orgLeadSourceOverrides.$inferInsert
