import { pgTable, text, jsonb, timestamp, date, index, type AnyPgColumn } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"
import { companies } from "@/modules/companies/schema"

/**
 * Central record of the three-record model (Contact / Project / Opportunity)
 * per Requirements §4.1 + §6.1, Tech Arch §2.2, Build Spec §2.
 *
 * `contact_type` and `lifecycle_status` are stored as text; the V1 enums
 * are validated app-side via Zod in types.ts. Same reasoning as
 * custom_fields.field_type and rbac.role: text + Zod is cheaper to evolve
 * than pg enums.
 *
 * `tags` is `text[]` (Postgres array). A GIN index makes containment
 * queries fast (`tags @> ARRAY['vip']`) which the saved-views engine
 * will rely on for tag-based filtering.
 *
 * `mailing_address` is `jsonb` (loose Record); the Zod
 * `mailingAddressSchema` in types.ts is the parse-time guard.
 *
 * `referred_by_contact_id` is a self-FK (ON DELETE SET NULL) — when a
 * referring contact is hard-deleted by the purge cron, the referral
 * pointer goes null rather than cascading the referred contact.
 *
 * `owner_user_id` is who "owns" the contact for routing / assignment
 * purposes. ON DELETE SET NULL when the user is removed from the system;
 * the contact is preserved but unassigned.
 *
 * `notes` is the user-facing notes field; `internal_notes` is the
 * "honest take, quirks" field per Vendor Matrix spec (Requirements §6.17)
 * — both columns exist on every contact and are surfaced only on the
 * detail view, never in list/picker contexts.
 *
 * FK to organization is ON DELETE RESTRICT (matches companies + items +
 * files). Soft-delete columns standard.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    primaryEmail: text("primary_email"),
    secondaryEmail: text("secondary_email"),
    primaryPhone: text("primary_phone"),
    secondaryPhone: text("secondary_phone"),
    mailingAddress: jsonb("mailing_address").$type<Record<string, unknown>>(),
    dob: date("dob"),
    anniversaryDate: date("anniversary_date"),
    instagramHandle: text("instagram_handle"),
    instagramUserId: text("instagram_user_id"),
    facebookUrl: text("facebook_url"),
    website: text("website"),
    leadSource: text("lead_source"),
    sourceDetail: text("source_detail"),
    referredByContactId: text("referred_by_contact_id").references((): AnyPgColumn => contacts.id, {
      onDelete: "set null",
    }),
    contactType: text("contact_type"),
    lifecycleStatus: text("lifecycle_status"),
    tags: text("tags").array().$type<string[]>(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes"),
    internalNotes: text("internal_notes"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("contacts_org_deleted_created_idx").on(t.organizationId, t.deletedAt, t.createdAt.desc()),
    index("contacts_org_type_deleted_idx").on(t.organizationId, t.contactType, t.deletedAt),
    index("contacts_org_company_deleted_idx").on(t.organizationId, t.companyId, t.deletedAt),
    // GIN index for tag containment queries (tags @> ARRAY['vip']).
    // Drizzle doesn't have first-class GIN-on-array; raw SQL via name().
    index("contacts_tags_gin_idx").using("gin", t.tags),
    // Email index for duplicate detection (Requirements §6.1).
    index("contacts_org_email_idx").on(t.organizationId, t.primaryEmail),
  ],
)

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
