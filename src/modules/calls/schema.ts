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
 * `source` taxonomy (three values — keep all three distinct):
 *   - `source = "manual"`      → user-entered via the Log Call form.
 *                                `external_id` + `external_metadata` are
 *                                null.
 *   - `source = "ringcentral"` → **Pathway-witnessed** call auto-logged by
 *                                the inline dialer (the existing
 *                                recordOutboundCall / recordInboundCall
 *                                paths). The disposition is the heuristic
 *                                badge shown the instant the user hangs up
 *                                (`disposition_source = "heuristic"`).
 *   - `source = "rc_sync"`     → created by the RC call-log sync layer from
 *                                RingCentral's authoritative call log — the
 *                                cell-answered / Kelly-answered / desk-app
 *                                calls Pathway never witnessed. Always
 *                                `disposition_source = "rc_authoritative"`.
 *
 * RC-sync columns (`rc_*`, `transcript*`, `ai_notes*`, `disposition_source`)
 * are populated by the rc-sync module. A Pathway-witnessed row keeps its
 * heuristic disposition until a sync job overwrites it with RC truth
 * (matched on `rc_call_id`, guarded by `rc_last_modified_time` monotonicity).
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
    /**
     * Outcome of the call as a structured value. Drives the
     * activity-feed badge UI and is the unifying enum for
     * system-detected (auto-log from dialer) and user-selected
     * (manual logCall composer) outcomes. See
     * `RECORDED_CALL_DISPOSITIONS` in `./types.ts` for the eight
     * canonical values.
     *
     * Nullable for graceful degradation: pre-existing rows from
     * before the 2026-06-11 disposition push have NULL here. The
     * activity feed renders no badge for null. Auto-log rows
     * written before 2026-06-11 carry their original value in
     * `external_metadata.disposition` and are backfilled to this
     * column via a one-time post-deploy SQL operation (documented
     * in the commit message).
     */
    disposition: text("disposition"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationSeconds: integer("duration_seconds"),
    notes: text("notes"),
    recordingFileId: text("recording_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull(),
    externalId: text("external_id"),
    externalMetadata: jsonb("external_metadata").$type<Record<string, unknown>>(),
    // ─── RC call-log sync (module rc-sync) ───────────────────────────
    /** RingCentral's authoritative call id. The dedup + reconciliation
     *  key; partial-unique per org (see index below). Null until a sync
     *  job links/creates the row. */
    rcCallId: text("rc_call_id"),
    /** Telephony session id captured from the SDK at hangup on a
     *  Pathway-witnessed call. The PRECISE Layer-2 reconciliation key
     *  (Rule 0): the sync worker matches the RC record to THIS exact row
     *  by session id rather than the fuzzy phone+time merge. Non-unique
     *  (RC can emit >1 call-log record per session, e.g. transfers). */
    telephonySessionId: text("telephony_session_id"),
    /** RC's `lastModifiedTime` for this record. Monotonicity guard so a
     *  stale reconciliation sweep can never overwrite newer RC truth. */
    rcLastModifiedTime: timestamp("rc_last_modified_time", { withTimezone: true }),
    /** Provenance of `disposition`: "heuristic" (Pathway's instant badge)
     *  or "rc_authoritative" (overwritten by RC's measured result). */
    dispositionSource: text("disposition_source").notNull().default("heuristic"),
    /** RC's raw result string, e.g. "Call connected" / "Missed" / "Voicemail". */
    rcResult: text("rc_result"),
    /** Expiring RC-hosted recording link — NOT a source of truth (RC purges it). */
    rcRecordingUrl: text("rc_recording_url"),
    /** Stable RC recording id — the re-fetchable handle for transcription. */
    rcRecordingId: text("rc_recording_id"),
    /** Call transcript (RC Audio AI speech-to-text — Build 4). */
    transcript: text("transcript"),
    /** "pending" | "ready" | "unavailable" | "failed". */
    transcriptStatus: text("transcript_status"),
    /** Editable structured AI notes (JSON string) — Build 5. */
    aiNotes: text("ai_notes"),
    /** Immutable first Haiku output (JSON string), preserved for audit/diff
     *  even after the user edits `ai_notes`. Written once, never updated. */
    aiNotesOriginal: text("ai_notes_original"),
    /** "pending" | "ready" | "failed" | "manual_override". */
    aiNotesStatus: text("ai_notes_status"),
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
    // RC-sync dedup + reconciliation key. Partial unique — one row per
    // (org, rc_call_id) so webhook + targeted-pull + sweep can ON CONFLICT
    // upsert without ever creating duplicate rows for the same RC call.
    uniqueIndex("call_log_org_rc_call_id_uidx")
      .on(t.organizationId, t.rcCallId)
      .where(sql`${t.rcCallId} IS NOT NULL`),
    // Layer-2 precise reconciliation lookup (Rule 0). NON-unique partial
    // (RC may emit >1 call-log record per telephony session, e.g. a
    // transferred call) — fast lookup, mirrors the rc_call_id partial.
    index("call_log_org_telephony_session_idx")
      .on(t.organizationId, t.telephonySessionId)
      .where(sql`${t.telephonySessionId} IS NOT NULL`),
  ],
)

export type CallLog = typeof callLog.$inferSelect
export type NewCallLog = typeof callLog.$inferInsert
