import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core"

/**
 * Help / FAQ entries — GLOBAL across the product, not per-organization.
 *
 * Unlike every other application table, `faq_entries` has NO
 * `organization_id` column and NO Row-Level Security. The content is
 * product-level documentation that every studio sees identically.
 *
 * Editing FAQ entries is gated at the application layer (admin-only
 * orgAction or a separate console process), not via RLS. Public reads
 * are open to any signed-in user; that's intentional.
 *
 * Lifecycle columns (createdAt, updatedAt, deletedAt) are present so the
 * authoring side can soft-delete or audit changes, but no user/by
 * columns — edits are attributed to "the system" / changelog at the
 * commit level, not to specific user accounts.
 */
export const faqEntries = pgTable(
  "faq_entries",
  {
    id: text("id").primaryKey(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    category: text("category"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("faq_entries_category_order_idx").on(t.category, t.displayOrder, t.deletedAt)],
)

export type FaqEntry = typeof faqEntries.$inferSelect
export type NewFaqEntry = typeof faqEntries.$inferInsert
