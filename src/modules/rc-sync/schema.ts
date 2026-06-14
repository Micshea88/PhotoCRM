import { pgPolicy, pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization } from "@/modules/auth/schema"

/**
 * Durable job queue for the RingCentral call-log sync (module rc-sync).
 *
 * Every sync unit of work is a row here so retries, backoff, and audit are
 * first-class and survive a cold function. The worker
 * (`app/api/jobs/queue/rc-sync`) claims due rows; the reconciliation cron
 * sweep + the webhook + the targeted post-hangup pull are all just
 * producers that INSERT rows.
 *
 * Machine-written: there is NO user session on the webhook / cron / queue
 * paths, so writes go through the `db.transaction` + `set_config(
 * 'app.current_org', ...)` + `set_config('app.current_role','admin')`
 * pattern (same as workflow-execute) — NOT orgAction. RLS still isolates by
 * org (policy below); the system context sets the GUC explicitly.
 *
 * NOT a soft-delete table — jobs are operational, not user data — so it is
 * intentionally excluded from `purge-deleted`. A future "prune completed
 * jobs older than N days" cron can reap them; that is out of scope here.
 *
 * `id` is text/cuid2 (set in code via createId) to match the rest of the
 * schema — not a DB-generated UUID — so the codebase stays uniform.
 */
export const rcSyncJobs = pgTable(
  "rc_sync_jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /** RC's authoritative call id. Null when a job is created from a webhook
     *  trigger that only knows the telephony session id yet (the call_log
     *  pull resolves the rc_call_id). */
    rcCallId: text("rc_call_id"),
    /** Telephony session id from a webhook `Disconnected` event — the trigger
     *  key before the call-log record (and its rc_call_id) is fetched. */
    telephonySessionId: text("telephony_session_id"),
    /** "call_log" | "transcript" | "ai_notes" — the pipeline stage. */
    kind: text("kind").notNull(),
    /** "pending" | "running" | "done" | "failed" | "dead" (retry-exhausted). */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Earliest time the worker may claim this job (backoff + the +60s
     *  transcript-processing delays write future timestamps here). */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    // Worker poll: due, pending jobs in scheduled order.
    index("rc_sync_jobs_status_scheduled_idx").on(t.status, t.scheduledFor),
    // Lookup all jobs for a given RC call (reconciliation + debugging).
    index("rc_sync_jobs_org_rc_call_idx").on(t.organizationId, t.rcCallId),
    // Org-isolation RLS — mirrors call_log / telephony_connections. FORCE
    // RLS is hand-appended to the generated SQL per AGENTS.md hard rule 10a.
    pgPolicy("rc_sync_jobs_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type RcSyncJob = typeof rcSyncJobs.$inferSelect
export type NewRcSyncJob = typeof rcSyncJobs.$inferInsert
