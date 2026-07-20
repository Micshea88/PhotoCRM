import {
  pgPolicy,
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { organization } from "@/modules/auth/schema"

/**
 * Generic durable job queue — the shared backbone for ALL async, at-least-once
 * background work (workflow execution, inbound-webhook processing, outbound
 * provider sends). This is the real implementation of the "jobs table in
 * Postgres + cron consumer" that the fire-and-forget stub in `../queue.ts`
 * pointed at.
 *
 * The locked pattern (AGENTS.md "Standing backend policies" #3):
 *   - atomic claim: `UPDATE … WHERE status='pending' AND scheduled_for<=now()
 *     RETURNING` — exactly one worker wins a row.
 *   - lease: the winner holds `lease_token` until `lease_expires_at`. Unlike
 *     rc-sync (whose side effect is an idempotent IN-TX db write, so a crash
 *     just rolls back), this queue drives EXTERNAL side effects (client email)
 *     that cannot sit inside a transaction — so the claim COMMITS, the handler
 *     runs outside it, and a crash strands the row in 'running'.
 *   - reaper: reclaims rows whose lease expired (crash/hang) → back to
 *     'pending' with backoff, or 'dead' once `attempts` reaches `max_attempts`.
 *   - fencing: markDone/markFailed match `lease_token`, so a late worker whose
 *     lease was already reclaimed cannot complete or fail someone else's claim.
 *   - idempotency: producers pass `idempotency_key` (e.g. a provider event id);
 *     the partial unique index makes a redelivery a no-op. Handlers MUST be
 *     idempotent (pass the key through to the provider) so a crash AFTER the
 *     side effect + a reaper retry still yields exactly one effect.
 *   - DLQ: retry-exhausted rows land in 'dead' for reconcile / inspection.
 *
 * Machine-written (no user session on cron/webhook/queue paths): writes go
 * through `db.transaction` + `SET LOCAL ROLE app_authenticated` + `set_config(
 * 'app.current_org', ...)` — same as rc-sync / workflow-execute. RLS still
 * isolates by org (policy below); the system context sets the GUC explicitly.
 *
 * Operational, not user data → excluded from `purge-deleted`. Terminal rows
 * (`done`, `dead`) are reaped by the dedicated `prune-jobs` cron
 * (`pruneTerminalJobs`): short retention for `done`, longer for the `dead` DLQ.
 */
export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: text("id").primaryKey(),
    /**
     * The owning org — NULLABLE. Most jobs (workflow_execution, nylas_webhook,
     * resend_delivery) are enqueued org-scoped and their row is RLS-isolated.
     * But a webhook whose tenant needs ENRICHMENT to resolve (resend inbound:
     * fetch the email + contact-match) can't be org-tagged at the edge — it's a
     * tenant-agnostic system-inbox row (the standard "claim-check" webhook
     * pattern), resolved by the worker. Such rows are touched ONLY by the system
     * runner on the base (BYPASSRLS) connection; the handler sets the resolved
     * org's context for the actual tenant writes. Their raw payload is thin
     * (ids + provider metadata, never message content), so a null-org row leaks
     * no tenant data.
     */
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    /** Discriminator for the handler registry: "workflow_execution" |
     *  "nylas_webhook" | "resend_webhook" | … */
    type: text("type").notNull(),
    /** Small type-specific data the handler needs (e.g. `{ executionId }` or
     *  `{ provider, eventId }`). Bulk payloads belong in a domain table linked
     *  by id, not here. */
    payload: jsonb("payload").notNull().default({}),
    /** "pending" | "running" | "done" | "failed" | "dead". */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Per-job retry cap — the row goes 'dead' once `attempts` reaches it. */
    maxAttempts: integer("max_attempts").notNull().default(5),
    /** Dedup / exactly-once key (provider event id, trigger key). The partial
     *  unique index below makes a redelivery of the same key a no-op. */
    idempotencyKey: text("idempotency_key"),
    /** Set at claim; identifies the worker holding the lease (fencing token). */
    leaseToken: text("lease_token"),
    /** When the current lease expires; the reaper reclaims 'running' rows past
     *  this. MUST exceed max handler runtime (policy 3 — `retry_after` > max
     *  runtime), else two workers double-process. */
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    /** Earliest time a worker may claim this row (backoff writes future). */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    // Worker poll: due pending jobs in schedule order.
    index("background_jobs_status_scheduled_idx").on(t.status, t.scheduledFor),
    // Reaper sweep: running jobs past their lease.
    index("background_jobs_status_lease_idx").on(t.status, t.leaseExpiresAt),
    // Idempotency: at most one row per (type, key), GLOBAL — provider event ids
    // (Nylas event id, Svix svix-id) and workflow trigger keys are globally
    // unique, and a global key is what lets a null-org system-inbox row dedup a
    // redelivery (a per-org key can't, since the org is unknown). Redelivery →
    // no-op via onConflictDoNothing.
    uniqueIndex("background_jobs_idempotency_uidx")
      .on(t.type, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    // Org-isolation RLS — mirrors rc_sync_jobs. FORCE RLS is hand-appended to
    // the generated SQL per AGENTS.md §10a.
    pgPolicy("background_jobs_org_isolation", {
      as: "permissive",
      for: "all",
      using: sql`organization_id = current_setting('app.current_org', true)`,
      withCheck: sql`organization_id = current_setting('app.current_org', true)`,
    }),
  ],
).enableRLS()

export type BackgroundJob = typeof backgroundJobs.$inferSelect
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert
