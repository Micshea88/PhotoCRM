import "server-only"

/**
 * Throttle visibility (step 6). When the gateway delays/queues a studio's sends,
 * it emits a ThrottleEvent so the studio isn't left wondering why an email is
 * slow. Two sides:
 *   - the EMIT: the gateway fires an `onThrottle` listener (see gateway.ts).
 *   - the READ: `ThrottleLog` keeps a small, bounded, time-windowed record per
 *     org that a "sends are catching up" indicator / notification can poll.
 *
 * In-memory + per-region on purpose: this is an ADVISORY UX hint, not a source of
 * truth. Losing it on a redeploy or across regions is harmless — the send itself
 * is already durable (interactive retries; bulk requeues via the A3 queue).
 */
export interface ThrottleEvent {
  provider: string
  orgId: string
  /** Why the send was delayed: rate-limited, or the provider's breaker is open. */
  status: "throttled" | "circuit_open"
  /** Roughly how long until capacity/recovery. */
  retryAfterMs: number
  /** When it happened (ms epoch) — injected by the gateway's clock. */
  at: number
}

export type ThrottleListener = (event: ThrottleEvent) => void

export class ThrottleLog {
  private readonly byOrg = new Map<string, ThrottleEvent[]>()

  constructor(
    /** Keep at most this many recent events per org (ring). */
    private readonly maxPerOrg = 20,
    /** Events older than this are considered stale (not "catching up"). */
    private readonly windowMs = 60_000,
  ) {}

  record(event: ThrottleEvent): void {
    const list = this.byOrg.get(event.orgId) ?? []
    list.push(event)
    if (list.length > this.maxPerOrg) list.splice(0, list.length - this.maxPerOrg)
    this.byOrg.set(event.orgId, list)
  }

  /** Events for an org within the freshness window, newest last. */
  recent(orgId: string, now: number = Date.now()): ThrottleEvent[] {
    const list = this.byOrg.get(orgId)
    if (!list) return []
    return list.filter((e) => now - e.at <= this.windowMs)
  }

  /** True when this org has been throttled recently — the "sends are catching
   *  up" signal a UI indicator / notification can show. */
  isCatchingUp(orgId: string, now: number = Date.now()): boolean {
    return this.recent(orgId, now).length > 0
  }
}
