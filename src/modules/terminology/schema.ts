import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core"
import { organization } from "@/modules/auth/schema"

/**
 * Per-org terminology pack. The display label that the UI shows for each
 * conceptual object (e.g., the `project` table is shown as "Event"/"Events"
 * for photographers). The UI label resolver reads this table; no component
 * hard-codes "Event" or "Shoot".
 *
 * No soft-delete columns. This is a configuration table — rows are seeded
 * automatically on org creation and are not exposed to user-facing delete
 * actions in V1 (same precedent as `audit_log`). If a V2 admin UI adds
 * delete behavior, add the standard soft-delete columns in that migration.
 */
export const terminologyMap = pgTable(
  "terminology_map",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    labelSingular: text("label_singular").notNull(),
    labelPlural: text("label_plural").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("terminology_map_org_object_uidx").on(t.organizationId, t.objectKey),
    index("terminology_map_org_idx").on(t.organizationId),
  ],
)

export type TerminologyRow = typeof terminologyMap.$inferSelect
export type NewTerminologyRow = typeof terminologyMap.$inferInsert
