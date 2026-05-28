import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core"
import { organization, user } from "@/modules/auth/schema"
import { contacts } from "@/modules/contacts/schema"

/**
 * Push 3 (C6a) — meetings placeholder table.
 *
 * V1 contract: log a meeting against a contact for the activity feed
 * on the detail page. Calendar integration + invites land in Push 8
 * (Calendar). For now, the row carries enough to render an activity
 * entry: when, with whom, who logged it, optional notes.
 *
 * RLS scopes to org via FOR ALL policy using app.current_org GUC
 * (same pattern as call_log / contact_notes / projects).
 */
export const meetings = pgTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Free-form subject — e.g. "Initial consult", "Mood board review". */
    subject: text("subject"),
    /** Notes captured during/after the meeting. */
    notes: text("notes"),
    /** Scheduled / actual start. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** Optional end — null until the meeting concludes or the user
     *  doesn't bother to log it. */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Optional location string (physical address, video link, etc.). */
    location: text("location"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("meetings_org_contact_starts_idx").on(t.organizationId, t.contactId, t.startsAt.desc()),
    index("meetings_org_starts_idx").on(t.organizationId, t.deletedAt, t.startsAt.desc()),
  ],
)

export type Meeting = typeof meetings.$inferSelect
export type NewMeeting = typeof meetings.$inferInsert
