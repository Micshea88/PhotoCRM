import { pgTable, text, integer, jsonb, timestamp, uuid, index } from "drizzle-orm/pg-core"
import { organization } from "@/modules/auth/schema"

/**
 * file_scan_diagnostics — TEMPORARY database-backed observability for the
 * attachment upload → malware-scan → poll pipeline (2026-06-26).
 *
 * Why a table and not just logs: the [SCAN-DIAG] console logs aren't surfacing
 * in Vercel production logs, so we capture each pipeline step as a row instead
 * and view them through an admin page (one URL). This is diagnostic infra ONLY
 * — writes are best-effort (see scan-diagnostics.ts: insert failures are
 * swallowed so they can never block an upload). NOT RLS (org scoping at the
 * query layer; some early steps fire before an org is known, so org_id is
 * nullable and the viewer also reads null-org rows). No soft-delete — this is
 * a throwaway table to be dropped once the scan timing is understood.
 */
export const fileScanDiagnostics = pgTable(
  "file_scan_diagnostics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** May be null — some steps fire before the files row exists. */
    fileId: text("file_id"),
    /** One of: upload_token_requested | upload_token_issued |
     *  upload_completed_callback_fired | cloudmersive_call_started |
     *  cloudmersive_call_completed | cloudmersive_error | scan_status_updated |
     *  poll_received | poll_returned_status. */
    step: text("step").notNull(),
    status: text("status"),
    durationMs: integer("duration_ms"),
    requestId: text("request_id"),
    fileSizeBytes: integer("file_size_bytes"),
    filename: text("filename"),
    errorMessage: text("error_message"),
    responsePayload: jsonb("response_payload"),
    metadata: jsonb("metadata"),
    /** Nullable — not known on every step (e.g. the route entry log). */
    orgId: text("org_id").references(() => organization.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("file_scan_diagnostics_created_idx").on(t.createdAt.desc()),
    index("file_scan_diagnostics_file_idx").on(t.fileId),
  ],
)

export type FileScanDiagnostic = typeof fileScanDiagnostics.$inferSelect
export type NewFileScanDiagnostic = typeof fileScanDiagnostics.$inferInsert
