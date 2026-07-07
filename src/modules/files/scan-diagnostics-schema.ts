import {
  pgPolicy,
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization } from "@/modules/auth/schema"

/**
 * file_scan_diagnostics — TEMPORARY database-backed observability for the
 * attachment upload → malware-scan → poll pipeline (2026-06-26).
 *
 * Why a table and not just logs: the [SCAN-DIAG] console logs aren't surfacing
 * in Vercel production logs, so we capture each pipeline step as a row instead
 * and view them through an admin page (one URL). This is diagnostic infra ONLY
 * — writes are best-effort (see scan-diagnostics.ts: insert failures are
 * swallowed so they can never block an upload). No soft-delete — this is a
 * throwaway table to be dropped once the scan timing is understood.
 *
 * RLS: org-isolation on `org_id` (NOTE: the column is `org_id`, not the usual
 * `organization_id`). The column is NULLABLE by design — some early steps fire
 * before an org is known (e.g. the pre-auth upload_token_requested route entry).
 * NULL-org rows are INVISIBLE to every scoped reader (`org_id = current_setting`
 * is NULL → not true), which is the desired security posture: null-org rows can
 * be produced by any tenant, so pooling them would leak filenames/sizes across
 * orgs (getScanDiagnostics already excludes them deliberately, review 2026-06-26).
 * Writes go through logScanStep on the bare BYPASSRLS owner connection, so the
 * best-effort inserts (including null-org steps) still land in production.
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
    // Org-isolation RLS policy — mirrors email_log / contacts, but keyed on the
    // `org_id` column (this table does not use `organization_id`). FORCE RLS is
    // hand-appended to the generated migration SQL (drizzle-kit emits ENABLE,
    // not FORCE) per AGENTS.md §10a. NULL-org rows are invisible to all scoped
    // readers by design (see table doc above).
    pgPolicy("file_scan_diagnostics_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`org_id = current_setting('app.current_org', true)`,
      withCheck: sql`org_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type FileScanDiagnostic = typeof fileScanDiagnostics.$inferSelect
export type NewFileScanDiagnostic = typeof fileScanDiagnostics.$inferInsert
