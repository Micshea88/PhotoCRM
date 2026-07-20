/**
 * Tunables for the generic durable job queue.
 *
 * BACKOFF: delay (seconds) before a failed/reclaimed job becomes eligible
 * again, indexed by the attempt number that just finished (attempt 1 failed →
 * wait BACKOFF[1] before attempt 2). Capped at the last entry.
 *
 * LEASE_DURATION_SECONDS: how long a claim holds the row before the reaper may
 * reclaim it. MUST exceed the longest possible handler runtime (policy 3 —
 * `retry_after` > max runtime); otherwise the reaper hands the row to a second
 * worker while the first is still running it → double side-effect. 300s (5 min)
 * comfortably exceeds a single email send / webhook ingest.
 */
export const BACKGROUND_JOB_BACKOFF_SECONDS = [10, 10, 30, 120, 300, 900] as const
export const DEFAULT_MAX_ATTEMPTS = 5
export const LEASE_DURATION_SECONDS = 300

/**
 * Retention for the prune-terminal-jobs GC (the `prune-jobs` cron).
 *
 * `done` rows are operational noise — a completed workflow send / webhook
 * ingest — so they get a SHORT window (long enough to debug "did last night's
 * run go out?"). `dead` rows are the DLQ: the forensic record of retry-exhausted
 * work, so they're kept LONGER for reconcile before GC. Both are overridable via
 * env on the cron route without a deploy.
 */
export const DONE_RETENTION_DAYS = 7
export const DEAD_RETENTION_DAYS = 30
/** Rows pruned per status per run; a larger backlog drains over successive runs
 *  (bounded like `purge-deleted`, so one run can't lock the table for long). */
export const PRUNE_BATCH_LIMIT = 5000

/** Backoff for the given completed-attempt number, capped at the last entry. */
export function backoffSecondsForAttempt(attempt: number): number {
  const i = Math.max(0, Math.min(attempt, BACKGROUND_JOB_BACKOFF_SECONDS.length - 1))
  return BACKGROUND_JOB_BACKOFF_SECONDS[i] ?? 900
}
