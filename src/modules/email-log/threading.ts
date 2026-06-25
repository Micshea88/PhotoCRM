/**
 * Pure email-threading helpers (Mike-locked 2026-06-24). No I/O — the DB
 * lookup that resolves an inherited thread_id is done by the caller (inbound
 * ingest), which passes the result in. Unit-tested directly.
 */

/** Extract RFC-5322 Message-ID tokens (`<...>`) from an In-Reply-To /
 *  References header. References lists multiple, space-separated. */
export function parseMessageIdList(header: string | null | undefined): string[] {
  if (!header) return []
  const matches = header.match(/<[^>]+>/g)
  if (matches) return matches.map((s) => s.trim())
  // Fallback: bare tokens with no angle brackets.
  return header
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * The thread_id for an incoming/outgoing message: inherit the existing thread
 * when this message replies into one (caller looked up email_log for any
 * In-Reply-To/References Message-ID and found its thread_id), else this
 * message starts a new thread rooted at its own Message-ID.
 */
export function deriveThreadId(selfMessageId: string, inheritedThreadId: string | null): string {
  return inheritedThreadId ?? selfMessageId
}

export interface ThreadGroup<T> {
  threadId: string
  /** All messages in the thread, oldest first. */
  messages: T[]
  /** Earliest message (the thread root). */
  root: T
  /** messages.length - 1. */
  replyCount: number
}

/**
 * Group emails into threads by `threadId` (a message with no threadId is its
 * own singleton thread keyed by id). Within a thread, messages are sorted
 * oldest→newest; groups are ordered by their most-recent message, newest first
 * (matches the feed's reverse-chronological order).
 */
export function groupEmailsByThread<
  T extends { id: string; threadId?: string | null; timestamp: Date },
>(emails: T[]): ThreadGroup<T>[] {
  const byThread = new Map<string, T[]>()
  for (const e of emails) {
    const key = e.threadId ?? e.id
    const list = byThread.get(key)
    if (list) list.push(e)
    else byThread.set(key, [e])
  }
  const groups: ThreadGroup<T>[] = []
  for (const [threadId, list] of byThread) {
    const messages = [...list].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    const root = messages[0]
    if (!root) continue
    groups.push({ threadId, messages, root, replyCount: messages.length - 1 })
  }
  // Most-recently-active thread first.
  groups.sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1]?.timestamp.getTime() ?? 0
    const bLast = b.messages[b.messages.length - 1]?.timestamp.getTime() ?? 0
    return bLast - aLast
  })
  return groups
}
