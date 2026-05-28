/**
 * Push 3 (C6c) — pure utilities for the AI cache columns.
 *
 * Lives separately from regenerate.ts (which is a server-action
 * module — Next requires every export there to be async). These
 * helpers are pure + can be imported anywhere (client or server).
 */
export type { ContactFacts } from "./lead-status-rules"
export type { AiInsight } from "./insights-detector"

/**
 * Cache freshness checker. Returns true when the cached values are
 * stale (> staleAfterMs) or missing. Used by the detail page loader
 * to decide whether to surface a "stale" hint next to the summary.
 */
export function isAiCacheStale(
  cachedAt: Date | null,
  staleAfterMs = 7 * 24 * 60 * 60 * 1000,
): boolean {
  if (!cachedAt) return true
  return Date.now() - cachedAt.getTime() > staleAfterMs
}
