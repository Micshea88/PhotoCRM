import { log } from "@/lib/log"
import {
  verifyNylasSignature,
  resolveNylasWebhookRouting,
} from "@/modules/email-connections/nylas-inbound"
import { enqueueJobInContext } from "@/modules/jobs/queue/runner"

/**
 * Nylas inbound-email webhook receiver.
 *
 * GET: the Nylas challenge handshake — echo the `challenge` query param.
 *
 * POST: a signed delivery. Follows the standard durable-webhook pipeline
 * (policy 2 — verify → enqueue → ACK → async → idempotent → DLQ), NOT inline
 * processing:
 *
 *   1. VERIFY the `X-Nylas-Signature` (hex HMAC over the raw body) at the door.
 *   2. RESOLVE the org via `grant_id` (a cheap grant_id-hash index lookup) so
 *      the durable job is ORG-SCOPED — the raw payload row stays RLS-isolated.
 *   3. ENQUEUE a `nylas_webhook` job keyed on the Nylas event id (idempotent —
 *      a redelivery is a no-op) and ACK 200 within milliseconds (Nylas times
 *      out at 10s and disables slow endpoints).
 *
 * The heavy work — re-fetching the full message from Nylas and running
 * `processInboundEmail` (contact match, dedup, threading) — happens in the
 * async queue handler (`jobs/queue/handlers.ts` → `ingestNylasWebhook`), which
 * Nylas explicitly recommends ("a separate service that fetches object data").
 *
 * ALWAYS acks 200 — even on a bad signature, an unknown grant, or an internal
 * error — so a transient blip or a foreign webhook never disables the endpoint.
 */
export function GET(request: Request): Response {
  const challenge = new URL(request.url).searchParams.get("challenge")
  if (challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } })
  }
  return new Response("ok", { status: 200 })
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()
  const signature =
    request.headers.get("x-nylas-signature") ?? request.headers.get("X-Nylas-Signature")
  try {
    if (!verifyNylasSignature(rawBody, signature)) {
      // Bad/absent signature — ack + drop (never enqueue an unverified payload).
      return Response.json({ ok: true })
    }
    const routed = await resolveNylasWebhookRouting(rawBody)
    if (routed) {
      await enqueueJobInContext({
        organizationId: routed.organizationId,
        type: "nylas_webhook",
        payload: { rawBody, signature },
        idempotencyKey: routed.idempotencyKey,
      })
    }
    // routed === null → unparseable / no grant / unknown grant: not ours, drop.
  } catch (err) {
    log.error({ err }, "nylas-inbound: enqueue failed")
  }
  return Response.json({ ok: true })
}
