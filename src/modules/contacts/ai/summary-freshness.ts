/**
 * Pure staleness check for the AI summary — shared by the contact page (server)
 * and `refreshContactAiSummary` (action) so they agree. No server-only deps so
 * it unit-tests directly.
 *
 * Stale (a refresh is due) when:
 *   - the summary was never generated, OR
 *   - activity is newer than the summary (last_activity_at > ai_generated_at), OR
 *   - 1 hour has elapsed since the summary was generated.
 */
export const SUMMARY_MAX_AGE_MS = 60 * 60 * 1000

export function isSummaryStale(
  generatedAt: Date | null,
  lastActivityAt: Date | null,
  nowMs: number = Date.now(),
): boolean {
  if (generatedAt === null) return true
  if (lastActivityAt !== null && lastActivityAt.getTime() > generatedAt.getTime()) return true
  return nowMs - generatedAt.getTime() > SUMMARY_MAX_AGE_MS
}
