/**
 * Pure reconciliation rules + retry backoff for rc-sync. NO server-only
 * dependencies (no db, no SDK) so unit tests import these directly without
 * dragging in the server import chain. `reconcile.ts` + `queries.ts` import
 * from here.
 */

/**
 * Retry backoff (Mike-locked): delay before each attempt, in seconds.
 * Index 0 = the initial schedule at enqueue (+3s); indices 1..9 = the delay
 * before re-running after that attempt fails. After 10 attempts (~46 min
 * total) the job is `dead` — Build 3's cron sweep re-drives from Layer 1
 * events, so the bounded total is safe.
 */
export const RC_SYNC_BACKOFF_SECONDS = [3, 10, 30, 60, 90, 180, 300, 480, 720, 900] as const
export const RC_SYNC_MAX_ATTEMPTS = RC_SYNC_BACKOFF_SECONDS.length

/** RC's `result` string → our RecordedCallDisposition taxonomy. The raw
 *  `result` is ALWAYS stored verbatim in rc_result; this only drives the
 *  badge. CONFIRM the mapping against real RC results during UAT (RC's exact
 *  result vocabulary varies); unmapped values fall back to a duration check. */
export function mapRcResultToDisposition(
  rcResult: string | undefined,
  durationSeconds: number | undefined,
): string {
  const r = (rcResult ?? "").toLowerCase()
  if (r.includes("connected") || r === "accepted" || r === "answered" || r === "call connected") {
    return "completed"
  }
  if (r.includes("voicemail") || r.includes("voice mail")) return "voicemail"
  if (r.includes("busy")) return "busy"
  if (r.includes("missed") || r.includes("no answer")) return "no_answer"
  if (r.includes("rejected") || r.includes("declined")) return "no_answer"
  if (r.includes("hang up") || r.includes("abandoned") || r.includes("stopped")) return "cancelled"
  return (durationSeconds ?? 0) > 0 ? "completed" : "no_answer"
}

export type ReconcileDecision =
  | { action: "update"; targetId: string; via: "session" | "rc_call_id" | "fuzzy"; stale: boolean }
  | { action: "insert"; via: "ambiguous_fuzzy" | "no_match" }

/**
 * Decide the reconciliation action from the three lookup results. Pure — the
 * caller does the DB lookups and executes the decision.
 *
 * Rule order: 0 precise session id → 1 rc_call_id → 2 fuzzy (single merge /
 * ambiguous insert) → 3 insert.
 */
export function decideReconcileAction(input: {
  sessionMatch: { id: string; rcLastModifiedTime: Date | null } | null
  rcCallIdMatch: { id: string; rcLastModifiedTime: Date | null } | null
  fuzzyMatchIds: string[]
  incomingLastModified: Date | null
}): ReconcileDecision {
  const isStale = (existing: Date | null): boolean =>
    existing !== null &&
    input.incomingLastModified !== null &&
    existing >= input.incomingLastModified

  if (input.sessionMatch) {
    return {
      action: "update",
      targetId: input.sessionMatch.id,
      via: "session",
      stale: isStale(input.sessionMatch.rcLastModifiedTime),
    }
  }
  if (input.rcCallIdMatch) {
    return {
      action: "update",
      targetId: input.rcCallIdMatch.id,
      via: "rc_call_id",
      stale: isStale(input.rcCallIdMatch.rcLastModifiedTime),
    }
  }
  if (input.fuzzyMatchIds.length === 1 && input.fuzzyMatchIds[0]) {
    return { action: "update", targetId: input.fuzzyMatchIds[0], via: "fuzzy", stale: false }
  }
  if (input.fuzzyMatchIds.length > 1) {
    return { action: "insert", via: "ambiguous_fuzzy" }
  }
  return { action: "insert", via: "no_match" }
}
