import "server-only"
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { Resend } from "resend"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { log } from "@/lib/log"
import { contacts } from "@/modules/contacts/schema"
import { emailLog } from "./schema"
import { deriveThreadId, parseMessageIdList } from "./threading"
import { emitNotification } from "@/modules/notifications/dispatch"
import { memberRole } from "@/modules/rbac/schema"

/**
 * Resend inbound-email ingest (Commit 3, Phase C). The webhook is metadata-only
 * (email.received), so we fetch the full message (body + threading headers) from
 * the Received-Emails API, resolve the sender to a known contact, and log the
 * email to every known participant.
 *
 * Locked behavior (Mike, 2026-06-24):
 *  - Unknown sender → DROP (no log, no auto-create). HubSpot "log replies only".
 *  - Known sender (reply OR brand-new OR forward) → log to that contact; we
 *    trust the From header (no body-parsing for forward detection).
 *  - Multi-recipient: also log to known To/Cc contacts; never to Bcc.
 *  - Threading: inherit an existing thread via In-Reply-To/References, else the
 *    message starts a new thread rooted at its own Message-ID.
 *  - Dedup: re-delivered webhooks are skipped (existing external_id check +
 *    the (org, source, external_id) unique index backstop).
 *  - Single-tenant V1: the org is the sender contact's org.
 *
 * RLS writes follow the server-to-server pattern (SET LOCAL ROLE + GUCs), since
 * the webhook has no session.
 */

let resendClient: Resend | null = null
function resend(): Resend {
  resendClient ??= new Resend(env.RESEND_API_KEY)
  return resendClient
}

export interface InboundEmail {
  messageId: string
  from: string
  to: string[]
  cc: string[]
  subject: string | null
  body: string | null
  inReplyTo: string | null
  references: string | null
  sentAt: Date
}

export interface SvixHeaders {
  "svix-id": string | null
  "svix-timestamp": string | null
  "svix-signature": string | null
}

/** Svix-verify the raw webhook body. Returns the parsed event, or null when the
 *  signature is invalid or the secret isn't configured. */
export function verifyResendWebhook(rawBody: string, headers: SvixHeaders): unknown {
  if (!env.RESEND_WEBHOOK_SECRET) {
    log.warn("resend-webhook: RESEND_WEBHOOK_SECRET not set — rejecting")
    return null
  }
  try {
    const verify = (resend().webhooks as { verify: (a: unknown) => unknown }).verify
    return verify({
      payload: rawBody,
      headers: {
        "svix-id": headers["svix-id"] ?? "",
        "svix-timestamp": headers["svix-timestamp"] ?? "",
        "svix-signature": headers["svix-signature"] ?? "",
      },
      secret: env.RESEND_WEBHOOK_SECRET,
    })
  } catch (err) {
    log.warn({ err }, "resend-webhook: signature verification failed")
    return null
  }
}

/** Fetch the full received message (body + headers) from Resend. The webhook
 *  payload is metadata-only. Endpoint/shape per Resend's Received-Emails API;
 *  parsed defensively. */
async function fetchReceivedEmail(emailId: string): Promise<InboundEmail | null> {
  try {
    const res = await fetch(`https://api.resend.com/emails/received/${emailId}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    })
    if (!res.ok) {
      log.error({ status: res.status, emailId }, "resend-inbound: received-email fetch failed")
      return null
    }
    const d = (await res.json()) as Record<string, unknown>
    const headers = (d.headers ?? {}) as Record<string, string>
    const str = (v: unknown): string => (typeof v === "string" ? v : "")
    const arr = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : typeof v === "string"
          ? [v]
          : []
    const firstNonEmpty = (...vals: string[]): string => vals.find((v) => v.length > 0) ?? ""
    const messageId = firstNonEmpty(
      headers["message-id"] ?? "",
      headers["Message-ID"] ?? "",
      str(d.message_id),
    )
    if (!messageId) return null
    return {
      messageId,
      from: str(d.from),
      to: arr(d.to),
      cc: arr(d.cc),
      subject: typeof d.subject === "string" ? d.subject : null,
      body: typeof d.text === "string" ? d.text : typeof d.html === "string" ? d.html : null,
      inReplyTo: headers["in-reply-to"] ?? headers["In-Reply-To"] ?? null,
      references: headers.references ?? headers.References ?? null,
      sentAt: new Date(),
    }
  } catch (err) {
    log.error({ err, emailId }, "resend-inbound: received-email fetch threw")
    return null
  }
}

/** Bare email address out of a possible "Name <email>" header value. */
function bareEmail(value: string): string {
  const m = /<([^>]+)>/.exec(value)
  return (m?.[1] ?? value).trim().toLowerCase()
}

interface ContactRow {
  id: string
  organizationId: string
  firstName: string
  lastName: string
}

/** Cross-org sender lookup (owner connection — the webhook has no org context;
 *  single-tenant V1 → effectively one org). Most-recent on multi-match. */
async function findContactAnyOrg(email: string): Promise<ContactRow | null> {
  const lowered = bareEmail(email)
  if (!lowered) return null
  const [row] = await db
    .select({
      id: contacts.id,
      organizationId: contacts.organizationId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    })
    .from(contacts)
    .where(
      and(
        isNull(contacts.deletedAt),
        or(
          eq(sql`lower(${contacts.primaryEmail})`, lowered),
          eq(sql`lower(${contacts.secondaryEmail})`, lowered),
        ),
      ),
    )
    .orderBy(sql`${contacts.updatedAt} desc`)
    .limit(1)
  return row ?? null
}

/** Known contact for an email WITHIN a specific org. */
async function findContactInOrg(orgId: string, email: string): Promise<ContactRow | null> {
  const lowered = bareEmail(email)
  if (!lowered) return null
  const [row] = await db
    .select({
      id: contacts.id,
      organizationId: contacts.organizationId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, orgId),
        isNull(contacts.deletedAt),
        or(
          eq(sql`lower(${contacts.primaryEmail})`, lowered),
          eq(sql`lower(${contacts.secondaryEmail})`, lowered),
        ),
      ),
    )
    .orderBy(sql`${contacts.updatedAt} desc`)
    .limit(1)
  return row ?? null
}

/**
 * Process a parsed inbound email: resolve sender → org, dedup, derive thread,
 * and insert one email_log row per known participant. Separated from fetching
 * so it's testable. Returns the count of rows written (0 = dropped/dedup).
 *
 * `source` is the provider taxonomy value (answer #4): "resend" for the studio-
 * domain inbound webhook (default), or "gmail" / "outlook" / "imap" for a
 * photographer's Nylas-connected mailbox. Both dedup and the stored row key on
 * it, so Resend-logged and Nylas-logged mail coexist cleanly.
 *
 * `opts.recipientUserIds` — the mailbox owner(s) to notify on reply.  The
 * Nylas lane passes `[conn.userId]`; the Resend lane omits opts, causing a
 * fallback query to the org's owners + admins via memberRole.
 */
export async function processInboundEmail(
  email: InboundEmail,
  source = "resend",
  opts?: { recipientUserIds?: string[] },
): Promise<number> {
  const sender = await findContactAnyOrg(email.from)
  if (!sender) {
    log.info("resend-inbound: unknown sender — dropped")
    return 0
  }
  const orgId = sender.organizationId

  // Dedup: skip if this Message-ID is already logged for the org.
  const [existing] = await db
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.organizationId, orgId),
        eq(emailLog.source, source),
        eq(emailLog.externalId, email.messageId),
      ),
    )
    .limit(1)
  if (existing) return 0

  // Threading: inherit from any referenced Message-ID, else root at self.
  const refIds = [email.inReplyTo, ...parseMessageIdList(email.references)].filter(
    (v): v is string => !!v,
  )
  let inheritedThreadId: string | null = null
  if (refIds.length > 0) {
    const matches = await db
      .select({ threadId: emailLog.threadId })
      .from(emailLog)
      .where(and(eq(emailLog.organizationId, orgId), inArray(emailLog.externalId, refIds)))
      .limit(1)
    inheritedThreadId = matches[0]?.threadId ?? null
  }
  const threadId = deriveThreadId(email.messageId, inheritedThreadId)

  // Participants: sender (always) + known To/Cc contacts (never Bcc — not in
  // inbound headers anyway). Dedup by contact id.
  const recipientContacts: ContactRow[] = []
  for (const addr of [...email.to, ...email.cc]) {
    const c = await findContactInOrg(orgId, addr)
    if (c) recipientContacts.push(c)
  }
  const logged = new Set<string>()

  const { written, emailLogId } = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
    await tx.execute(sql`SELECT set_config('app.current_org', ${orgId}, true)`)
    await tx.execute(sql`SELECT set_config('app.current_role', 'admin', true)`)

    // Sender row carries the Message-ID (dedup key + threading anchor).
    logged.add(sender.id)
    const inserted = await tx
      .insert(emailLog)
      .values({
        id: createId(),
        organizationId: orgId,
        contactId: sender.id,
        direction: "inbound",
        subject: email.subject,
        body: email.body,
        sentAt: email.sentAt,
        source,
        externalId: email.messageId,
        threadId,
      })
      .onConflictDoNothing()
      .returning({ id: emailLog.id })

    let txWritten = inserted.length
    const txEmailLogId: string | null = inserted[0]?.id ?? null

    // Other participants: external_id null (the unique index allows it).
    for (const c of recipientContacts) {
      if (logged.has(c.id)) continue
      logged.add(c.id)
      await tx.insert(emailLog).values({
        id: createId(),
        organizationId: orgId,
        contactId: c.id,
        direction: "inbound",
        subject: email.subject,
        body: email.body,
        sentAt: email.sentAt,
        source,
        externalId: null,
        threadId,
      })
      txWritten += 1
    }

    return { written: txWritten, emailLogId: txEmailLogId }
  })

  // Emit email.reply_received ONLY when:
  //   1. A new row was written (dedup-safe — the guard above already returns 0
  //      if this messageId was previously logged).
  //   2. The sender row was inserted (emailLogId is non-null).
  //   3. The inbound is a REPLY: inReplyTo is set, OR we threaded onto an
  //      existing conversation (inheritedThreadId found in our log).
  //      Cold new inbound (no in-reply-to, no thread match) is a fresh inquiry
  //      → does NOT fire reply_received; that's a future lead.new_inquiry.
  if (
    written > 0 &&
    emailLogId !== null &&
    (email.inReplyTo !== null || inheritedThreadId !== null)
  ) {
    try {
      // Resolve notification recipients.
      let recipientUserIds: string[]
      if (opts?.recipientUserIds && opts.recipientUserIds.length > 0) {
        // Nylas lane: caller supplies the mailbox owner explicitly.
        recipientUserIds = [...new Set(opts.recipientUserIds)]
      } else {
        // Resend lane (no per-user connection context): notify org owners+admins.
        const adminRows = await db
          .select({ userId: memberRole.userId })
          .from(memberRole)
          .where(
            and(eq(memberRole.organizationId, orgId), inArray(memberRole.role, ["owner", "admin"])),
          )
        recipientUserIds = [...new Set(adminRows.map((r) => r.userId))]
      }

      if (recipientUserIds.length > 0) {
        const senderName = [sender.firstName, sender.lastName]
          .map((s) => s.trim())
          .filter(Boolean)
          .join(" ")
        const senderDisplay = senderName || bareEmail(email.from)
        const title = `${senderDisplay} replied`
        const bodyPreview = buildBodyPreview(email.body)
        const bodyParts = [email.subject, bodyPreview].filter(Boolean)
        const body = bodyParts.length > 0 ? bodyParts.join(" — ") : null

        await emitNotification({
          organizationId: orgId,
          type: "email.reply_received",
          recipientUserIds,
          actorUserId: null,
          contactId: sender.id,
          title,
          body,
          linkPath: `/contacts/${sender.id}`,
          payload: { threadId, emailLogId, messageId: email.messageId },
          sourceModule: "email",
        })
      }
    } catch (err) {
      // Notification failure must not block or fail the ingest — a missed
      // notification is recoverable; a dropped email_log row is not.
      log.error({ err }, "inbound: failed to emit email.reply_received — notification skipped")
    }
  }

  return written
}

/**
 * Strip HTML tags and quoted-reply lines from an email body, then trim to
 * `maxLen` characters.  Used to build the reply-received notification body
 * preview.  Pure — no side effects, exported for unit testing.
 *
 * Order matters: split on newlines first (to detect > quoted lines), then
 * strip HTML tags from the remaining lines so that HTML attributes containing
 * ">" are not mistakenly treated as quoted-reply markers.
 */
export function buildBodyPreview(body: string | null, maxLen = 140): string | null {
  if (!body) return null
  // Split on newlines BEFORE stripping HTML so that quoted-reply lines
  // ("> Some quoted text") can be reliably detected by their leading ">".
  const withoutQuotes = body
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join(" ")
  // Strip HTML tags from the remaining text, then collapse whitespace.
  const stripped = withoutQuotes
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!stripped) return null
  return stripped.length > maxLen ? stripped.slice(0, maxLen - 1) + "…" : stripped
}

/**
 * Process a pre-verified Resend event as an inbound email. Handles only the
 * `email.received` type — all other types are silently dropped (no-op). This
 * is the inner logic extracted from `ingestInboundEmail` so the route can
 * verify ONCE and branch by type without double-verifying.
 */
export async function ingestInboundFromEvent(event: unknown): Promise<void> {
  if (!event || typeof event !== "object") return
  const evt = event as { type?: string; data?: { email_id?: string } }
  if (evt.type !== "email.received" || !evt.data?.email_id) return
  const email = await fetchReceivedEmail(evt.data.email_id)
  if (!email) return
  try {
    await processInboundEmail(email)
  } catch (err) {
    log.error({ err }, "resend-inbound: processing failed")
  }
}

/** Full ingest: verify the raw body, then delegate to `ingestInboundFromEvent`.
 *  Kept for backward-compat; the route now calls `verifyResendWebhook` + branch
 *  directly so it can handle delivery events on the same endpoint. */
export async function ingestInboundEmail(rawBody: string, headers: SvixHeaders): Promise<void> {
  const event = verifyResendWebhook(rawBody, headers)
  if (!event) return
  await ingestInboundFromEvent(event)
}
