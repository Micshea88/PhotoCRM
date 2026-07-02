import "server-only"
import { createId } from "@paralleldrive/cuid2"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { env } from "@/lib/env"
import { sendEmail } from "@/lib/email"
import { nylasSendMessage } from "@/lib/email/nylas"
import {
  decryptGrantId,
  getLiveConnectionForUser,
  isSendable,
} from "@/modules/email-connections/queries"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * EmailProvider — the central abstraction (requirement A). Client email + a
 * photographer's automations route through this so a future NATIVE Gmail/MS
 * OAuth implementation can swap in without a schema refactor. Two implementations
 * exist today: the photographer's connected Nylas mailbox, and a Resend
 * fallback dressed to look like the photographer.
 *
 * System mail (auth/invite/passcode) does NOT use this — it keeps calling
 * src/lib/email.ts:sendEmail directly (requirement E).
 */

export interface OutboundMessage {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  /** HTML body — already carries Pathway's OWN tracking pixel + share links
   *  (answer #7: tracking stays Pathway's, not Nylas's). */
  html: string
  /** Direct (inline) attachments already routed per the unchanged 25 MB rule. */
  attachments: { filename: string; content: string; contentType: string }[]
}

export interface SentRef {
  /** email_log.source — "gmail" | "outlook" | "imap" | "resend". */
  source: string
  /** RFC Message-ID: the reply-matching key + Pathway thread root. */
  externalId: string
  /** Pathway's thread key (== externalId at a thread root) — answer #5. */
  threadId: string
  /** Provider ids stored alongside, never used as the key. */
  externalMetadata: Record<string, unknown> | null
}

export interface EmailProvider {
  send(msg: OutboundMessage): Promise<SentRef>
}

/** Best-effort content type for a filename (Nylas send requires one; Resend
 *  infers, so the fallback impl ignores it). Mechanical, not a product value. */
export function guessContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    heic: "image/heic",
    mp4: "video/mp4",
    zip: "application/zip",
    txt: "text/plain",
    csv: "text/csv",
  }
  return map[ext] ?? "application/octet-stream"
}

/** Sanitize a display name for an RFC 5322 mailbox — strip quotes + control
 *  chars so `"Name — Business" <addr>` can't be broken. */
function sanitizeDisplayName(name: string): string {
  return name
    .replace(/["\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** The dressed From header for the fallback — never a bare system address
 *  (answer #2, HoneyBook pattern). */
export function dressedFromHeader(photographerName: string, businessName: string): string {
  const display = sanitizeDisplayName(`${photographerName} — ${businessName}`)
  return `${display} <${env.RESEND_FROM_EMAIL}>`
}

/** Dressed studio From header for automated/workflow email — the studio name
 *  over the system address, never a bare system address (Item 1). No owner is
 *  resolved for automations in this round, so the display name is the business
 *  name alone. */
export function studioFromHeader(businessName: string): string {
  const display = sanitizeDisplayName(businessName) || "Pathway"
  return `${display} <${env.RESEND_FROM_EMAIL}>`
}

/** Nylas implementation — sends as the connected photographer. */
function nylasProvider(grantId: string, sourceValue: string): EmailProvider {
  return {
    async send(msg) {
      const sent = await nylasSendMessage({
        grantId,
        to: msg.to,
        cc: msg.cc,
        bcc: msg.bcc,
        subject: msg.subject,
        html: msg.html,
        attachments: msg.attachments,
      })
      const fromDomain = env.RESEND_FROM_EMAIL.split("@")[1] ?? "mail.invalid"
      // Prefer the provider's real RFC Message-ID (what replies reference). If
      // Nylas didn't surface one, fall back to a minted id so the row is still
      // a valid thread root and dedup key.
      const externalId = sent.rfcMessageId ?? sent.nylasMessageId ?? `<${createId()}@${fromDomain}>`
      return {
        source: sourceValue,
        externalId,
        threadId: externalId,
        externalMetadata: {
          nylasMessageId: sent.nylasMessageId,
          nylasThreadId: sent.nylasThreadId,
        },
      }
    },
  }
}

/** Resend fallback — dressed to look like the photographer. Mints Pathway's own
 *  Message-ID (as the pre-Nylas composer did). */
function resendFallbackProvider(fromHeader: string): EmailProvider {
  return {
    async send(msg) {
      const fromDomain = env.RESEND_FROM_EMAIL.split("@")[1] ?? "mail.invalid"
      const messageId = `<${createId()}@${fromDomain}>`
      await sendEmail({
        to: msg.to,
        cc: msg.cc.length > 0 ? msg.cc : undefined,
        bcc: msg.bcc.length > 0 ? msg.bcc : undefined,
        subject: msg.subject,
        html: msg.html,
        from: fromHeader,
        headers: { "Message-ID": messageId },
        attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content })),
      })
      return {
        source: "resend",
        externalId: messageId,
        threadId: messageId,
        externalMetadata: null,
      }
    },
  }
}

export interface ResolvedSender {
  provider: EmailProvider
  /** True when the user has a connection that is EXPIRED (surface a "reconnect
   *  your email" prompt) — but the send still proceeds via fallback (answer #3). */
  expiredConnection: boolean
}

/**
 * Resolve how to send on behalf of `userId`: their connected mailbox when live,
 * otherwise the dressed Resend fallback. An EXPIRED connection is treated the
 * same as never-connected (answer #3) — fallback, never a blocked send.
 */
export async function resolveSenderForUser(
  db: DbHandle,
  args: { orgId: string; userId: string; photographerName: string; businessName: string },
): Promise<ResolvedSender> {
  const conn = await getLiveConnectionForUser(db, args.orgId, args.userId)
  if (isSendable(conn)) {
    return {
      provider: nylasProvider(decryptGrantId(conn), conn.sourceValue),
      expiredConnection: false,
    }
  }
  const fromHeader = dressedFromHeader(args.photographerName, args.businessName)
  return { provider: resendFallbackProvider(fromHeader), expiredConnection: !!conn }
}
