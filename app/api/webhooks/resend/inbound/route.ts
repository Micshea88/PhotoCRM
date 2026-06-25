import { log } from "@/lib/log"
import { ingestInboundEmail } from "@/modules/email-log/inbound"

/**
 * Resend inbound-email webhook receiver (Commit 3, Phase C).
 *
 * Resend signs webhooks with Svix (svix-id / svix-timestamp / svix-signature
 * headers over the RAW request body), so we read the body as text — NOT JSON —
 * and hand both to `ingestInboundEmail`, which verifies the signature, fetches
 * the full message from the Received-Emails API, and logs it to known contacts.
 *
 * Like the RC webhook, this route does NO direct DB access (it delegates) and
 * ALWAYS acks 200 — even on failure — so Resend doesn't disable the endpoint
 * over a transient blip. An unverifiable/invalid event is silently dropped
 * inside the ingest (signature failure → no-op), not surfaced as a non-200.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  try {
    await ingestInboundEmail(rawBody, {
      "svix-id": request.headers.get("svix-id"),
      "svix-timestamp": request.headers.get("svix-timestamp"),
      "svix-signature": request.headers.get("svix-signature"),
    })
  } catch (err) {
    log.error({ err }, "resend-inbound: route handler failed")
  }
  return Response.json({ ok: true })
}
