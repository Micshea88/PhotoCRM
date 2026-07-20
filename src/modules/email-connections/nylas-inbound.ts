import "server-only"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { log } from "@/lib/log"
import { processInboundEmail, type InboundEmail } from "@/modules/email-log/inbound"
import { nylasFetchMessage } from "@/lib/email/nylas"
import { findLiveConnectionByAddressAnyOrg, findConnectionByGrantIdAnyOrg } from "./queries"
import { emailConnections } from "./schema"
import { findEmailLogByNylasMessageIdAnyOrg } from "@/modules/email-log/queries"
import { classifyBounceClass, recordDeliveryEvent } from "@/modules/email-delivery/ingest"
import { emitNotificationInTx } from "@/modules/notifications/dispatch"
import { memberRole } from "@/modules/rbac/schema"

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

/**
 * Nylas v3 webhook event shape.
 *
 * NOTE — payload field uncertainty:
 * - `id`: top-level event ID (uncertain; used as dedup key when present).
 * - `data.object.message_id`: the ID of the bounced/failed message (may be
 *   `id` instead — see nylasMessageId extraction below).
 * - `data.object.bounce_type` / `data.object.type`: bounce class hint
 *   (uncertain; classifyBounceClass handles both shapes defensively).
 * - `data.object.date`: event timestamp as Unix seconds (uncertain; may be
 *   absent or use a different field name such as `timestamp`).
 * These fields MUST be verified against real payloads when the webhook is
 * connected (build-completion gate — see task-7-report.md).
 */
interface NylasWebhookEvent {
  /** Top-level Nylas v3 event ID — used as dedup key (field name uncertain). */
  id?: string
  type?: string
  data?: {
    object?: {
      grant_id?: string
      /** Primary object ID — for message.created this is the Nylas message id. */
      id?: string
      /**
       * ID of the message this delivery event is about (bounce / send_failed).
       * Nylas v3 may use `message_id` for delivery events and `id` for message
       * events — we try both (uncertain; flag for connect-time verification).
       */
      message_id?: string
      /**
       * Bounce/failure type hint.
       * Nylas v3 may use `bounce_type`, `type`, or nested `detail.type`.
       * `classifyBounceClass` handles all known shapes defensively.
       */
      bounce_type?: string
      type?: string
      /** Event timestamp as Unix seconds (field name uncertain). */
      date?: number
    }
  }
}

// ─── Edge routing (durable-queue producer) ──────────────────────────────────

/**
 * Resolve the org for a verified Nylas webhook so the edge can enqueue an
 * ORG-SCOPED durable job (raw payload stays RLS-isolated) and ACK in
 * milliseconds — the heavy work (message fetch + processInboundEmail) then runs
 * in the async handler via `ingestNylasWebhook`.
 *
 * Org resolution is a cheap indexed lookup: every Nylas `message.*` / `grant.*`
 * event carries `data.object.grant_id`, and `findConnectionByGrantIdAnyOrg`
 * hits the grant_id-hash index. Returns null (→ ACK + drop) when the body isn't
 * parseable, has no grant_id, or the grant maps to no known connection — none
 * of which are ours to process.
 *
 * Idempotency key = Nylas's stable top-level event `id` when present (their
 * documented dedup key, stable across the 3 retries), else a SHA-256 of the raw
 * body (redeliveries are byte-identical, so this dedups them too).
 */
export async function resolveNylasWebhookRouting(
  rawBody: string,
  dbHandle: Parameters<typeof findConnectionByGrantIdAnyOrg>[0] = db,
): Promise<{ organizationId: string; idempotencyKey: string } | null> {
  let event: NylasWebhookEvent
  try {
    event = JSON.parse(rawBody) as NylasWebhookEvent
  } catch {
    return null
  }
  const grantId = event.data?.object?.grant_id
  if (!grantId) return null
  const conn = await findConnectionByGrantIdAnyOrg(dbHandle, grantId)
  if (!conn) return null
  const idempotencyKey = event.id ?? createHash("sha256").update(rawBody).digest("hex")
  return { organizationId: conn.organizationId, idempotencyKey }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the nylasMessageId from a delivery event's data.object.
 * Tries `message_id` first (expected for bounce/send_failed events), then
 * falls back to `id` (used by message.created).
 * Returns null if neither is present.
 */
type NylasEventObject = NonNullable<NonNullable<NylasWebhookEvent["data"]>["object"]>

function extractNylasMessageId(obj: NylasEventObject | undefined): string | null {
  return obj?.message_id ?? obj?.id ?? null
}

/**
 * Derive `occurredAt` from the data object's `date` field (Unix seconds).
 * Falls back to `new Date()` when absent or not a number.
 */
function extractOccurredAt(obj: NylasEventObject | undefined): Date {
  const raw = obj?.date
  return typeof raw === "number" ? new Date(raw * 1000) : new Date()
}

// ─── Inbound message helper (message.created branch) ─────────────────────────

/**
 * Process a Nylas `message.created` event — resolve grant/message, re-fetch
 * the full message, find the receiving connection, and hand off to
 * `processInboundEmail`.  Extracted from the original `ingestNylasWebhook` so
 * the new dispatch structure can call it without duplicating logic.
 *
 * Behavior is UNCHANGED from the pre-refactor implementation.
 */
export async function ingestNylasInboundMessage(event: NylasWebhookEvent): Promise<number> {
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
    // Nylas always returns an HTML body. Store it in both fields:
    // `body` will be cleaned by processInboundEmail; `bodyHtml` preserves
    // the raw source for the activity feed's HTML column.
    body: msg.body,
    bodyHtml: msg.body,
    inReplyTo: msg.inReplyTo,
    references: msg.references,
    sentAt: msg.date,
  }
  try {
    // The receiving mailbox's org is AUTHORITATIVE — pass it so processInboundEmail
    // routes to this tenant directly, never guessing cross-org (T2.2).
    // ownMailboxAddress excludes the studio's own mailbox from the To/Cc fan-out
    // so a reply addressed TO the studio does not create a participant row on the
    // studio's own contact record.
    return await processInboundEmail(inbound, conn.sourceValue, {
      recipientUserIds: [conn.userId],
      organizationId: conn.organizationId,
      ownMailboxAddress: conn.email,
    })
  } catch (err) {
    log.error({ err }, "nylas-inbound: processing failed")
    return 0
  }
}

// ─── Delivery event branches (bounce / send_failed) ───────────────────────────

/**
 * Shared logic for `message.bounce_detected` and `message.send_failed`.
 * Resolves the `email_log` row by `nylasMessageId` and calls
 * `recordDeliveryEvent`.  Returns 1 on success, 0 on any drop condition.
 */
async function handleNylasDeliveryEvent(
  event: NylasWebhookEvent,
  type: "bounced" | "failed",
): Promise<number> {
  const obj = event.data?.object
  const nylasMessageId = extractNylasMessageId(obj)
  if (!nylasMessageId) {
    log.info({ eventType: event.type }, "nylas-delivery: missing nylasMessageId — dropped")
    return 0
  }

  const match = await findEmailLogByNylasMessageIdAnyOrg(db, nylasMessageId)
  if (!match) {
    log.info(
      { nylasMessageId, eventType: event.type },
      "nylas-delivery: no email_log match — dropped (expected for mail sent before this shipped)",
    )
    return 0
  }

  const occurredAt = extractOccurredAt(obj)

  // Dedup key: prefer the top-level event id; fall back to <nylasMessageId>:<type>.
  // UNCERTAIN — Nylas v3 top-level event ID field name has not been confirmed
  // against live payloads. Verify at connect time.
  const providerEventId = event.id ?? `${nylasMessageId}:${type}`

  await recordDeliveryEvent({
    organizationId: match.organizationId,
    emailLogId: match.id,
    path: "nylas",
    type,
    bounceClass: type === "bounced" ? classifyBounceClass(obj) : null,
    detail: obj ?? null,
    providerEventId,
    occurredAt,
  })

  return 1
}

// ─── grant.expired handler ────────────────────────────────────────────────────

/**
 * Handle a Nylas `grant.expired` event.
 *
 * 1. Resolve the connection by grant_id (hash lookup → decrypt-scan fallback).
 * 2. Open a transaction; set `app.current_org` GUC (mirrors ingest.ts).
 * 3. Mark the connection status="expired", stamp expired_at + expired_reason.
 * 4. Emit `email.disconnected` to the mailbox owner + org owners/admins (dedup).
 *
 * Always returns 0 on drop conditions (no grantId in payload / no connection
 * match) so the route acks 200 without writing anything.
 */
export async function handleGrantExpired(
  event: NylasWebhookEvent,
  dbHandle: Parameters<typeof findConnectionByGrantIdAnyOrg>[0] = db,
): Promise<number> {
  const grantId = event.data?.object?.grant_id
  if (!grantId) {
    log.info("nylas: grant.expired — missing grant_id in payload — dropped")
    return 0
  }

  const conn = await findConnectionByGrantIdAnyOrg(dbHandle, grantId)
  if (!conn) {
    log.info("nylas: grant.expired — no connection match — dropped")
    return 0
  }

  await dbHandle.transaction(async (tx) => {
    // Drop into the NOBYPASSRLS app role FIRST (before any GUC) so FORCE RLS
    // genuinely enforces on this system-context write — mirroring
    // processInboundEmail (src/modules/email-log/inbound.ts:260-262). Tables
    // touched (email_connections UPDATE, member_role SELECT) are org-scoped;
    // emitNotificationInTx sets app.current_user_id per-recipient.
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
    // Set org GUC first so every subsequent write satisfies FORCE RLS.
    await tx.execute(sql`SELECT set_config('app.current_org', ${conn.organizationId}, true)`)

    // 1. Mark expired. Also stamp grant_id_hash here (idempotent) — this is the
    //    org-GUC'd home for the opportunistic backfill that the AnyOrg resolver
    //    deliberately does NOT do itself (final-review A.16). `conn.grantIdHash`
    //    is the hash the resolver computed (fast-path or fallback).
    await tx
      .update(emailConnections)
      .set({
        status: "expired",
        expiredAt: new Date(),
        expiredReason:
          "Your email connection was disconnected by the provider and needs to be reconnected.",
        grantIdHash: conn.grantIdHash,
        updatedAt: new Date(),
      })
      .where(eq(emailConnections.id, conn.id))

    // 2. Resolve recipients: connection owner + org owners/admins (dedup).
    const adminRows = await tx
      .select({ userId: memberRole.userId })
      .from(memberRole)
      .where(
        and(
          eq(memberRole.organizationId, conn.organizationId),
          inArray(memberRole.role, ["owner", "admin"]),
        ),
      )

    const recipientSet = new Set<string>()
    recipientSet.add(conn.userId)
    for (const row of adminRows) recipientSet.add(row.userId)
    const recipientUserIds = [...recipientSet]

    // 3. Emit notification.
    await emitNotificationInTx(tx, {
      organizationId: conn.organizationId,
      type: "email.disconnected",
      recipientUserIds,
      actorUserId: null,
      contactId: null,
      title: "Email inbox disconnected",
      body: `Your ${conn.email} connection stopped working. New emails are sending from your studio address until you reconnect.`,
      linkPath: "/settings/integrations",
      payload: { connectionId: conn.id },
      sourceModule: "email",
    })
  })

  return 1
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

/**
 * Full ingest: verify signature, parse the event, dispatch by event.type.
 * Swallows errors — the route acks 200 regardless so Nylas doesn't disable
 * the webhook.  Returns rows written (0 or 1).
 *
 * Dispatch table:
 *   message.created         → ingestNylasInboundMessage (behavior unchanged)
 *   message.bounce_detected → recordDeliveryEvent(type:"bounced")
 *   message.send_failed     → recordDeliveryEvent(type:"failed")
 *   grant.expired           → handleGrantExpired (Task 8)
 *   thread.replied          → NO-OP (reply notification fires via
 *                             message.created → processInboundEmail; Task 12)
 *   <anything else>         → return 0
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

  switch (event.type) {
    case "message.created":
      return ingestNylasInboundMessage(event)

    case "message.bounce_detected":
      return handleNylasDeliveryEvent(event, "bounced")

    case "message.send_failed":
      return handleNylasDeliveryEvent(event, "failed")

    case "grant.expired":
      return handleGrantExpired(event)

    case "thread.replied":
      // Intentionally a no-op. The canonical reply-received trigger is
      // message.created → processInboundEmail, which is dedup-safe (guards on
      // the existing message-id row).  Wiring thread.replied here would
      // double-notify: Nylas sends BOTH message.created AND thread.replied for
      // the same inbound reply.  Task 12 emits email.reply_received inside
      // processInboundEmail — no action needed here.
      return 0

    default:
      return 0
  }
}
