import { log } from "@/lib/log"
import { ingestInboundFromEvent, verifyResendWebhook } from "@/modules/email-log/inbound"
import { ingestResendDeliveryEvent } from "@/modules/email-delivery/resend-delivery"

/**
 * Resend webhook receiver (Task 6 Part 3 — branched handler).
 *
 * Handles both inbound-email events (`email.received`) and outbound delivery
 * events (`email.bounced`, `email.complained`, `email.delivered`) on the same
 * endpoint. Resend signs ALL webhooks with Svix, so we verify ONCE here and
 * branch by `event.type` — no double-verify:
 *
 *   - Delivery types  → `ingestResendDeliveryEvent` (Task 6 Part 3 / Task 4)
 *   - Inbound type    → `ingestInboundFromEvent` (Task 3 / Commit 3 Phase C)
 *   - Anything else   → no-op (ack 200, drop silently)
 *
 * ALWAYS acks 200 — even on error — so Resend does not disable the endpoint
 * over a transient blip. Unverifiable events (bad signature / missing secret)
 * are silently dropped inside `verifyResendWebhook`.
 *
 * Manual dashboard step (done by Mike after deployment): add the three
 * delivery event types (`email.bounced`, `email.complained`, `email.delivered`)
 * to the existing Resend webhook endpoint alongside `email.received`.
 */

const DELIVERY_TYPES = new Set(["email.bounced", "email.complained", "email.delivered"])

export async function POST(request: Request) {
  const rawBody = await request.text()
  const svixId = request.headers.get("svix-id")
  const headers = {
    "svix-id": svixId,
    "svix-timestamp": request.headers.get("svix-timestamp"),
    "svix-signature": request.headers.get("svix-signature"),
  }

  try {
    const event = verifyResendWebhook(rawBody, headers)
    if (!event) return Response.json({ ok: true })

    const evt = event as { type?: string }

    if (evt.type && DELIVERY_TYPES.has(evt.type)) {
      await ingestResendDeliveryEvent(event, svixId)
    } else {
      await ingestInboundFromEvent(event)
    }
  } catch (err) {
    log.error({ err }, "resend-inbound: route handler failed")
  }

  return Response.json({ ok: true })
}
