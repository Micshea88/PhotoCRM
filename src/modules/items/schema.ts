import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("items_org_deleted_created_idx").on(t.organizationId, t.deletedAt, t.createdAt.desc()),
  ],
)

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
