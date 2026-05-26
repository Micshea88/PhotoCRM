import {
  pgTable,
  text,
  jsonb,
  timestamp,
  date,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
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
    // Push 4 (A1) — IDs of records merged INTO this contact. Append-
    // only audit trail; the actual merge action (B2) writes the loser
    // ids here on each merge so the merge history is recoverable
    // alongside audit_log.
    mergedRecordIds: jsonb("merged_record_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
    // P4.2 push 2a.5 — Archived state, separate from soft-delete. Archived
    // contacts are hidden from the main list + filters, surface only on
    // /contacts/archived, and are NOT auto-purged. Soft-delete still
    // applies (deleted_at) — archive is a less-destructive halfway state.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: text("archived_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("contacts_org_deleted_created_idx").on(t.organizationId, t.deletedAt, t.createdAt.desc()),
    index("contacts_org_type_deleted_idx").on(t.organizationId, t.contactType, t.deletedAt),
    index("contacts_org_company_deleted_idx").on(t.organizationId, t.companyId, t.deletedAt),
    // GIN index for tag containment queries (tags @> ARRAY['vip']).
    // Drizzle doesn't have first-class GIN-on-array; raw SQL via name().
    index("contacts_tags_gin_idx").using("gin", t.tags),
    // Push 4 (A4) — GIN index on custom_fields jsonb. Backs the
    // /contacts list's custom-field filters (contains / eq / in /
    // gte / lte) via the ->> + ? path operators.
    index("contacts_custom_fields_gin_idx").using("gin", t.customFields),
    // Email index for duplicate detection (Requirements §6.1).
    index("contacts_org_email_idx").on(t.organizationId, t.primaryEmail),
    // P4.2 push 2a.5 — fast filter for the main list query which excludes
    // archived contacts by default.
    index("contacts_org_archived_deleted_idx").on(t.organizationId, t.archivedAt, t.deletedAt),
  ],
)

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert

/**
 * Many-to-many contact↔company linkage with a role string per
 * association. Mirrors the project_contacts pattern.
 *
 * The existing `contacts.company_id` column stays as the "primary" /
 * default company (fast-path indexed FK for list display). Additional
 * associations — e.g., a person who's a Vendor for one company AND a
 * Client of another — go here with their own roles.
 *
 * UI rule: when rendering a contact's company in lists, prefer
 * `contacts.company_id` (the primary). On the detail page, render the
 * Companies tab as the full union of primary + associations.
 *
 * UNIQUE (organization_id, contact_id, company_id, role) prevents
 * inserting the exact same association twice. Different roles
 * between the same pair are allowed (e.g., a person can be both
 * "Owner" and "Billing Contact" of the same company).
 */
export const contactCompanyAssociations = pgTable(
  "contact_company_associations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    contactId: text("contact_id")
      .notNull()
      .references((): AnyPgColumn => contacts.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Free-form role label. NULLABLE — a person can be associated with
    // a company without a specific role label assigned.
    role: text("role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // Uniqueness: (org, contact, company, COALESCE(role, '')).
    // The COALESCE collapses NULL roles to '' for dedup purposes, so
    // the same (contact, company) pair can only have ONE no-role
    // association. Distinct non-null roles are still allowed (e.g.,
    // the same person can be "Owner" AND "Billing Contact" of the
    // same company simultaneously). Same effect as NULLS NOT DISTINCT
    // without depending on PG 15+ syntax or drizzle CREATE-INDEX
    // option support.
    uniqueIndex("contact_company_assoc_uidx").on(
      t.organizationId,
      t.contactId,
      t.companyId,
      sql`COALESCE(${t.role}, '')`,
    ),
    index("contact_company_assoc_org_contact_idx").on(t.organizationId, t.contactId),
    index("contact_company_assoc_org_company_idx").on(t.organizationId, t.companyId),
  ],
)

export type ContactCompanyAssociation = typeof contactCompanyAssociations.$inferSelect
export type NewContactCompanyAssociation = typeof contactCompanyAssociations.$inferInsert

/**
 * Timestamped notes for the contact activity feed. The legacy
 * `contacts.notes` / `contacts.internal_notes` scalar columns stay in
 * the schema for back-compat but the P4.2 UI writes only to this
 * table (one row per note, timestamped, attributable to a user).
 *
 * Soft-deleted so a user can recover a note they removed by mistake.
 * Hard-purged by the deleted-content cron.
 */
export const contactNotes = pgTable(
  "contact_notes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    contactId: text("contact_id")
      .notNull()
      .references((): AnyPgColumn => contacts.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("contact_notes_org_contact_deleted_idx").on(
      t.organizationId,
      t.contactId,
      t.deletedAt,
      t.createdAt.desc(),
    ),
  ],
)

export type ContactNote = typeof contactNotes.$inferSelect
export type NewContactNote = typeof contactNotes.$inferInsert
