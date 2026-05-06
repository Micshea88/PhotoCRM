import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    pathname: text("pathname").notNull(),
    url: text("url").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("files_org_deleted_created_idx").on(t.organizationId, t.deletedAt, t.createdAt.desc()),
  ],
)

export type File = typeof files.$inferSelect
export type NewFile = typeof files.$inferInsert
