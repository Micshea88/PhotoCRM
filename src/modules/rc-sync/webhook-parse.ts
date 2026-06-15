/**
 * Pure parser for RingCentral account-level telephony/sessions webhook
 * deliveries. NO server-only dependencies (only a type-only import of the RC
 * event shape) so unit tests import it directly without the server chain —
 * same discipline as rules.ts.
 *
 * The subscription is created with the `?statusCode=Disconnected` filter, so RC
 * SHOULD only deliver finished-call events. We still verify defensively: a
 * payload is only actionable when it carries a telephony session id and, when
 * party status is present, at least one party reached `Disconnected`. Mid-call
 * events (Setup / Proceeding / Answered) that slip through the filter produce
 * an empty result and are ignored.
 */
import type { RcTelephonySessionEvent } from "@/lib/ringcentral/types"

/**
 * Extract the telephony session id(s) to sync from a webhook payload. Returns
 * `[]` for anything that isn't an actionable Disconnected event (so the route
 * can ack-200 without enqueuing). Returns a single-element array today (one
 * event per delivery); typed as an array so a future batched-delivery shape
 * folds in without a signature change.
 */
export function parseDisconnectedSessions(payload: unknown): string[] {
  const event = payload as RcTelephonySessionEvent | null | undefined
  const body = event?.body
  if (!body) return []

  const sessionId = body.telephonySessionId ?? body.sessionId
  if (!sessionId || typeof sessionId !== "string") return []

  const parties = body.parties ?? []
  // When party status is present, require at least one Disconnected so a
  // mid-call event that bypassed the filter is ignored. When parties are
  // omitted entirely, trust the subscription's statusCode=Disconnected filter.
  if (parties.length > 0) {
    const anyDisconnected = parties.some(
      (p) => (p.status?.code ?? "").toLowerCase() === "disconnected",
    )
    if (!anyDisconnected) return []
  }

  return [sessionId]
}
