import { env } from "@/lib/env"
import { log } from "@/lib/log"
import {
  VALIDATION_TOKEN_HEADER,
  getValidationToken,
  isVerifiedWebhookRequest,
} from "@/lib/ringcentral/verification-token"
import { ingestDisconnectedSessions } from "@/modules/rc-sync/webhook-subscription"

/**
 * RC-sync Layer 1 — account telephony/sessions webhook receiver.
 *
 * One route, org id in the path. The org id selects which org an event belongs
 * to; the GLOBAL verification token (RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN)
 * authenticates that the delivery genuinely came from RC. An attacker cannot
 * forge the token, so a path-supplied org id is safe to trust after the token
 * check passes.
 *
 * This route does NO direct DB access (it lives outside the db-import
 * allowlist) — it delegates to `ingestDisconnectedSessions`, which opens the
 * org-context tx and dedup-enqueues sync jobs.
 *
 * Three request shapes:
 *   1. Subscription handshake — RC sends a `Validation-Token` request header
 *      (no verification token, often no useful body). We echo it back in the
 *      response `Validation-Token` header with a 200 inside RC's 3s window.
 *   2. Event delivery — verify the per-event token, parse Disconnected
 *      sessions, enqueue. ALWAYS 200 (even on internal error) so RC doesn't
 *      disable the subscription over a transient blip; the cron sweep
 *      re-drives anything missed.
 *   3. Unauthenticated — token missing/mismatched → 401, nothing enqueued.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params

  // 1. Validation-Token handshake (subscription create / re-validate).
  const validationToken = getValidationToken(request.headers)
  if (validationToken) {
    return new Response(null, {
      status: 200,
      headers: { [VALIDATION_TOKEN_HEADER]: validationToken },
    })
  }

  // 2. Per-event auth — the ONLY auth on event delivery. Reject mismatches.
  if (!isVerifiedWebhookRequest(request.headers, env.RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN)) {
    log.warn(
      { feature: "rc-sync.webhook", organizationId: orgId },
      "[rc-sync] webhook delivery failed verification-token check — rejecting",
    )
    return new Response("Unauthorized", { status: 401 })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    // Empty / non-JSON body (e.g. a bare re-validation ping). Ack and move on.
    return Response.json({ ok: true, enqueued: 0 })
  }

  try {
    const result = await ingestDisconnectedSessions(orgId, payload)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    // Swallow → 200 so RC keeps the subscription alive; the cron sweep is the
    // durable backstop for anything this delivery failed to enqueue.
    log.error(
      {
        feature: "rc-sync.webhook",
        organizationId: orgId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      },
      "[rc-sync] webhook ingest failed — acking 200, cron sweep will re-drive",
    )
    return Response.json({ ok: true, enqueued: 0, error: "ingest_failed" })
  }
}

export const dynamic = "force-dynamic"
