import { sql } from "drizzle-orm"
import { pgTable, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"

/**
 * Lightweight company reference — explicitly NOT a full CRM company object
 * in V1 (no pipelines, no activity timeline, no record page). See Tech Arch
 * §2.2 and Build Spec §2 for the parked decision rationale.
 *
 * `website` and `main_phone` live HERE (company-level, shared across all
 * contacts at the company), not duplicated onto each contact. A contact's
 * own primary/secondary phones stay on `contacts` (when that module ships).
 * Website is frequently the cleanest disambiguator between same-named
 * vendors ("Kelly Smith @ Evergreen Planning" vs "Kelly Smith @ Bloom").
 *
 * `category` is plain text in V1 — the Vendor Matrix module (Phase 4) will
 * curate a category enum and run a migration to constrain values. Keeping
 * it text here means inline-create-from-typeahead doesn't have to know
 * the categories yet.
 *
 * FK to organization is ON DELETE RESTRICT (matches files/items): an org
 * with companies can't be cascade-deleted into oblivion; admin tooling
 * must explicitly soft-delete or purge first.
 */
export const companies = pgTable(
  "companies",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    website: text("website"),
    mainPhone: text("main_phone"),
    instagramHandle: text("instagram_handle"),
    category: text("category"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // Partial unique on name within an org — typeahead disambiguation. Soft
    // deleting and recreating the same name works because the partial filters
    // out tombstones.
    uniqueIndex("companies_org_name_uidx")
      .on(t.organizationId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    // List-and-filter index, matches the items/files pattern.
    index("companies_org_deleted_created_idx").on(
      t.organizationId,
      t.deletedAt,
      t.createdAt.desc(),
    ),
  ],
)

export type Company = typeof companies.$inferSelect
export type NewCompany = typeof companies.$inferInsert
