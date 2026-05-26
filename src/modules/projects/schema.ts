import { sql } from "drizzle-orm"
import { pgTable, text, integer, jsonb, timestamp, date, boolean, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"
import { contacts } from "@/modules/contacts/schema"

/**
 * `projects` — the central engagement record (UI label "Event"). Per
 * Requirements §4.1 + §6.2, Tech Arch §2.2, Build Spec §2.
 *
 * MONEY FIELDS ARE INTEGER CENTS. Percentages are integer basis points
 * (bps). Rationale per Tech Arch §4: "Integer-cents internally, never
 * float." The recompute engine (Tech Arch §4 — payment-schedule + task-
 * plan share one helper) lands with the invoices module and writes to
 * the `*_cents` columns based on `line_items`, `discount_*`, and `tax_*`.
 * For V1 today: actions accept these fields and store them as-is; the
 * computed columns (`subtotal_cents`, `tax_amount_cents`, `total_value_cents`)
 * are nullable and stay null until the recompute helper ships.
 *
 * `discount_value` interpretation depends on `discount_type`:
 *   - discount_type = 'percent' → value is basis points (e.g., 1500 = 15.00%)
 *   - discount_type = 'flat'    → value is cents
 *   - discount_type = 'none'    → value is null/ignored
 *
 * `venue_coordinates` is jsonb {lat, lng} (per STEP 2 Q10 — Drizzle 0.45
 * has no first-class pg `point`, and V1 does no PostGIS queries). The
 * sun-calc module (Phase 2) reads coordinates and writes `sun_data jsonb`
 * with sunrise/sunset/golden hour.
 *
 * `anniversary_date` is auto-derived from `primary_date` when
 * `project_type='Wedding'` (action layer, not a DB trigger). Documented
 * in the actions README; if a future use case wants to override the
 * derivation, the action keeps the user's explicit value.
 */
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),

    // Core identity & lifecycle
    name: text("name").notNull(),
    projectType: text("project_type"),
    lifecycleStatus: text("lifecycle_status"),

    // Dates & coverage
    primaryDate: date("primary_date"),
    startDatetime: timestamp("start_datetime", { withTimezone: true }),
    endDatetime: timestamp("end_datetime", { withTimezone: true }),
    hoursOfCoverage: integer("hours_of_coverage"),
    photographerCount: integer("photographer_count"),

    // Venues
    primaryVenueName: text("primary_venue_name"),
    primaryVenueAddress: jsonb("primary_venue_address").$type<Record<string, unknown>>(),
    primaryVenueCoordinates: jsonb("primary_venue_coordinates").$type<{
      lat: number
      lng: number
    }>(),
    ceremonyVenue: jsonb("ceremony_venue").$type<Record<string, unknown>>(),
    receptionVenue: jsonb("reception_venue").$type<Record<string, unknown>>(),
    venueNotes: text("venue_notes"),

    // Money — integer cents (and basis points)
    packageName: text("package_name"),
    packageBasePriceCents: integer("package_base_price_cents"),
    lineItems: jsonb("line_items").$type<unknown[]>(),
    subtotalCents: integer("subtotal_cents"),
    discountType: text("discount_type"),
    discountValue: integer("discount_value"),
    taxRateBps: integer("tax_rate_bps"),
    taxSign: text("tax_sign"),
    taxAmountCents: integer("tax_amount_cents"),
    totalValueCents: integer("total_value_cents"),

    // Computed & cached
    anniversaryDate: date("anniversary_date"),
    sunData: jsonb("sun_data").$type<Record<string, unknown>>(),

    // Source / referral
    leadSource: text("lead_source"),
    referredByContactId: text("referred_by_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),

    // Notes & custom
    projectNotes: text("project_notes"),
    internalNotes: text("internal_notes"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),

    // Template that birthed this project (instantiation engine, future)
    templateId: text("template_id"),

    // Standard lifecycle
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("projects_org_deleted_created_idx").on(t.organizationId, t.deletedAt, t.createdAt.desc()),
    index("projects_org_lifecycle_deleted_idx").on(
      t.organizationId,
      t.lifecycleStatus,
      t.deletedAt,
    ),
    index("projects_org_primary_date_idx").on(t.organizationId, t.primaryDate, t.deletedAt),
    index("projects_org_type_deleted_idx").on(t.organizationId, t.projectType, t.deletedAt),
    // Push 4 (A4) — GIN index on custom_fields jsonb for the future
    // events list's custom-field filters.
    index("projects_custom_fields_gin_idx").using("gin", t.customFields),
  ],
)

/**
 * Per-project contact association. Many-to-many: a contact can appear
 * on multiple projects (Vendor on N events; couples on their own
 * engagement + wedding); a project can have multiple roled contacts
 * (couples = 2× primary/partner; billing contacts separate from
 * primaries).
 *
 * No soft-delete columns. Join tables hard-delete when an association
 * ends — the audit_log captures the removal. The contact_role enum
 * (primary/partner/billing/vendor) is text + Zod.
 *
 * FKs: project_id ON DELETE CASCADE (when a project is purged,
 * associations go too). contact_id ON DELETE RESTRICT (a contact with
 * project associations can't be hard-deleted; admin must reassign or
 * dissociate first).
 */
export const projectContacts = pgTable(
  "project_contacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("project_contacts_project_role_idx").on(t.projectId, t.role),
    index("project_contacts_org_contact_idx").on(t.organizationId, t.contactId),
  ],
)

/**
 * Photographer / team assignment. role = lead / second / backup per
 * Requirements §6.2. confirmation_status = pending / confirmed / declined.
 * FKs: project_id CASCADE; user_id CASCADE (if a user is removed from
 * the system, their assignments go — no orphaned photographer rows).
 */
export const projectPhotographers = pgTable(
  "project_photographers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    confirmationStatus: text("confirmation_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("project_photographers_project_idx").on(t.projectId),
    index("project_photographers_user_idx").on(t.userId),
    index("project_photographers_org_user_idx").on(t.organizationId, t.userId),
  ],
)

/**
 * Multi-event coverage: engagement / rehearsal_dinner / wedding_day /
 * post_wedding_brunch / bridal_portraits / custom. Per Requirements §6.2.
 *
 * `included` defaults to true (the row's existence implies it). Adding
 * a sub-event with `included=false` means "we discussed it but it's not
 * happening" — keep the record for context, hide it from active views.
 *
 * `gallery_delivered_at` is per-sub-event so a couple can have separate
 * engagement and wedding-day galleries delivered on different days.
 */
export const projectSubEvents = pgTable(
  "project_sub_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    included: boolean("included").notNull().default(true),
    eventDate: date("event_date"),
    venue: text("venue"),
    photographerUserId: text("photographer_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    galleryDeliveredAt: timestamp("gallery_delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("project_sub_events_project_idx").on(t.projectId),
    index("project_sub_events_org_date_idx").on(t.organizationId, t.eventDate),
  ],
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ProjectContact = typeof projectContacts.$inferSelect
export type NewProjectContact = typeof projectContacts.$inferInsert
export type ProjectPhotographer = typeof projectPhotographers.$inferSelect
export type NewProjectPhotographer = typeof projectPhotographers.$inferInsert
export type ProjectSubEvent = typeof projectSubEvents.$inferSelect
export type NewProjectSubEvent = typeof projectSubEvents.$inferInsert

// Silence sql import — kept for future schema additions (partial unique on
// any future composite key would use sql for the predicate).
export const _sql = sql
