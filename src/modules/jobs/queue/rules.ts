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

/** Backoff for the given completed-attempt number, capped at the last entry. */
export function backoffSecondsForAttempt(attempt: number): number {
  const i = Math.max(0, Math.min(attempt, BACKGROUND_JOB_BACKOFF_SECONDS.length - 1))
  return BACKGROUND_JOB_BACKOFF_SECONDS[i] ?? 900
}
