import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { log } from "@/lib/log"
import { processInboundEmail, type InboundEmail } from "@/modules/email-log/inbound"
import { nylasFetchMessage } from "@/lib/email/nylas"
import { findLiveConnectionByAddressAnyOrg } from "./queries"

/**
 * Nylas inbound ingest (Commit 4) — runs ALONGSIDE the Resend inbound webhook
 * (answer #1). A `message.created` delivery for a photographer's connected
 * mailbox is verified, the full message is re-fetched (payloads may be
 * truncated), the receiving connection is resolved to get its source value
 * ("gmail"/"outlook"/"imap"), and the message is handed to the SAME
 * processInboundEmail (contact match + dedup + threading) the Resend path uses.
 */

/** Verify Nylas's `X-Nylas-Signature` — hex HMAC-SHA256 of the raw body with the
 *  webhook secret. Returns false when the secret is unset or the sig mismatches. */
export function verifyNylasSignature(rawBody: string, signature: string | null): boolean {
  if (!env.NYLAS_WEBHOOK_SECRET) {
    log.warn("nylas-inbound: NYLAS_WEBHOOK_SECRET not set — rejecting")
    return false
  }
  if (!signature) return false
  const expected = createHmac("sha256", env.NYLAS_WEBHOOK_SECRET).update(rawBody).digest("hex")
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

interface NylasWebhookEvent {
  type?: string
  data?: { object?: { grant_id?: string; id?: string; message_id?: string } }
}

/**
 * Full ingest: verify signature, parse the event, fetch the message, resolve the
 * receiving connection's source, process. Swallows errors — the route acks 200
 * regardless so Nylas doesn't disable the webhook. Returns rows written.
 */
export async function ingestNylasWebhook(
  rawBody: string,
  signature: string | null,
): Promise<number> {
  if (!verifyNylasSignature(rawBody, signature)) return 0
  let event: NylasWebhookEvent
  try {
    event = JSON.parse(rawBody) as NylasWebhookEvent
  } catch {
    return 0
  }
  if (event.type !== "message.created") return 0
  const obj = event.data?.object
  const grantId = obj?.grant_id
  const messageId = obj?.id ?? obj?.message_id
  if (!grantId || !messageId) return 0

  const msg = await nylasFetchMessage(grantId, messageId)
  if (!msg) return 0

  // Which connected mailbox received this? That row gives us the source value.
  const conn = await findLiveConnectionByAddressAnyOrg(db, [...msg.to, ...msg.cc])
  if (!conn) {
    log.info("nylas-inbound: no matching connection for recipients — dropped")
    return 0
  }

  const inbound: InboundEmail = {
    messageId: msg.rfcMessageId ?? msg.nylasMessageId,
    from: msg.from,
    to: msg.to,
    cc: msg.cc,
    subject: msg.subject,
    body: msg.body,
    inReplyTo: msg.inReplyTo,
    references: msg.references,
    sentAt: msg.date,
  }
  try {
    return await processInboundEmail(inbound, conn.sourceValue)
  } catch (err) {
    log.error({ err }, "nylas-inbound: processing failed")
    return 0
  }
}
