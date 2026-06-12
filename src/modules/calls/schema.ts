import { pgTable, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization, user } from "@/modules/auth/schema"
import { contacts } from "@/modules/contacts/schema"
import { files } from "@/modules/files/schema"

/**
 * Phone-call log. Shape is designed to support BOTH manual logging
 * (the V1 "Log Call" button on a contact detail) AND a future
 * RingCentral integration without rework.
 *
 *   - `source = "manual"`      → user-entered via the Log Call form.
 *                                `external_id` + `external_metadata` are
 *                                null.
 *   - `source = "ringcentral"` → auto-synced via the RingCentral webhook
 *                                (lands in a later commit). `external_id`
 *                                is RingCentral's call id; the partial
 *                                unique index below prevents duplicate
 *                                webhook deliveries from creating
 *                                duplicate rows. `external_metadata` holds
 *                                any provider-specific payload we want to
 *                                retain (raw event, recording url, etc.).
 *
 * `recording_file_id` FKs to the files table (Vercel Blob). When a manual
 * call is logged with an audio file, the upload goes through the standard
 * /api/blob/upload pipeline and the resulting file_id lands here. ON
 * DELETE SET NULL — purging a recording file detaches it from the call
 * record without losing the call metadata.
 *
 * `contact_id` is nullable (ON DELETE SET NULL) so a call to/from someone
 * who isn't yet a contact can still be logged. The Log Call UI requires
 * a contact for V1, but the schema doesn't.
 */
export const callLog = pgTable(
  "call_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    direction: text("direction").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationSeconds: integer("duration_seconds"),
    notes: text("notes"),
    recordingFileId: text("recording_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull(),
    externalId: text("external_id"),
    externalMetadata: jsonb("external_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // Contact activity feed lookup.
    index("call_log_org_contact_started_idx").on(
      t.organizationId,
      t.contactId,
      t.deletedAt,
      t.startedAt.desc(),
    ),
    // Org-wide call list, most recent first.
    index("call_log_org_started_idx").on(t.organizationId, t.deletedAt, t.startedAt.desc()),
    // RingCentral dedup. Partial unique — only enforced for externally-
    // synced rows (manual rows have external_id NULL and don't need
    // dedup).
    uniqueIndex("call_log_org_source_external_uidx")
      .on(t.organizationId, t.source, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
  ],
)

export type CallLog = typeof callLog.$inferSelect
export type NewCallLog = typeof callLog.$inferInsert
