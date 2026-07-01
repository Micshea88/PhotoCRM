import { log } from "@/lib/log"
import { ingestNylasWebhook } from "@/modules/email-connections/nylas-inbound"

/**
 * Nylas inbound-email webhook receiver (Commit 4) — runs ALONGSIDE the Resend
 * inbound route.
 *
 * GET: the Nylas challenge handshake. On subscription create/activation Nylas
 * sends a GET with a `challenge` query param; we must echo the exact value in
 * the body (plain text, 200) so Nylas activates the subscription.
 *
 * POST: a signed delivery. Nylas signs with `X-Nylas-Signature` (hex
 * HMAC-SHA256 over the RAW body), so we read the body as text — NOT JSON — and
 * hand both to `ingestNylasWebhook`. Like the RC + Resend routes, this does NO
 * direct DB access (it delegates) and ALWAYS acks 200 so a transient blip
 * doesn't disable the endpoint.
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
    await ingestNylasWebhook(rawBody, signature)
  } catch (err) {
    log.error({ err }, "nylas-inbound: route handler failed")
  }
  return Response.json({ ok: true })
}
