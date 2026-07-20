import { log } from "@/lib/log"
import { verifyResendWebhook } from "@/modules/email-log/inbound"
import { enqueueJobInContext } from "@/modules/jobs/queue/runner"

/**
 * Resend webhook receiver (inbound `email.received` + delivery events on the
 * same Svix-signed endpoint).
 *
 * Follows the standard durable-webhook pipeline (policy 2), NOT inline
 * processing. Unlike Nylas, a Resend event's ORG can't be resolved by a cheap
 * edge lookup — inbound needs to fetch the email + contact-match, and delivery
 * correlates to a sent message — so this uses the tenant-agnostic
 * "claim-check" inbox: the edge does the minimum and the WORKER resolves the
 * tenant.
 *
 *   1. VERIFY the Svix signature at the door;
 *   2. ENQUEUE a `resend_webhook` system-inbox job (null org — resolved later)
 *      keyed on the Svix id (idempotent — a redelivery is a no-op). The payload
 *      is thin (raw body of ids + the svix id), never message content, so a
 *      null-org row leaks no tenant data;
 *   3. ACK 200 in milliseconds (Resend/Svix expect <15s).
 *
 * The parse + branch (delivery vs inbound), the Resend API fetch, and
 * processInboundEmail / recordDeliveryEvent all run async in the queue handler
 * (`jobs/queue/handlers.ts`). ALWAYS acks 200 so a transient blip or an
 * unverifiable event never disables the endpoint.
 */
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
    if (event) {
      await enqueueJobInContext({
        organizationId: null, // system-inbox: the worker resolves the tenant
        type: "resend_webhook",
        payload: { rawBody, svixId },
        idempotencyKey: svixId,
      })
    }
    // event === null → bad signature / missing secret: drop (never enqueue).
  } catch (err) {
    log.error({ err }, "resend-inbound: enqueue failed")
  }

  return Response.json({ ok: true })
}
