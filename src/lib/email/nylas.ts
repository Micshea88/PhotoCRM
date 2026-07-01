import "server-only"
import { env } from "@/lib/env"

/**
 * Nylas v3 REST calls for sending and fetching a photographer's mail (Commit 4).
 *
 * We call the REST API with `fetch` (no SDK dependency), matching the codebase's
 * existing provider pattern (see the Resend Received-Emails fetch in
 * email-log/inbound.ts). The application API key is the Bearer credential; the
 * per-photographer grant_id scopes the request to that mailbox.
 *
 * `fields=include_basic_headers` makes Nylas return the RFC threading headers
 * (Message-ID, In-Reply-To, References) as a `{ name, value }[]` array, which we
 * need to keep Pathway's OWN threadId/Message-ID scheme as the key (answer #5).
 * Supported on all providers (Google/Microsoft/EWS/EAS/IMAP).
 * Reference: https://developer.nylas.com/docs/v3/email/headers-mime-data/
 */

export class NylasApiNotConfigured extends Error {
  constructor() {
    super("Nylas API is not configured for this environment.")
    this.name = "NylasApiNotConfigured"
  }
}

function requireApi(): { apiUri: string; apiKey: string } {
  const { NYLAS_API_URI, NYLAS_API_KEY } = env
  if (!NYLAS_API_URI || !NYLAS_API_KEY) throw new NylasApiNotConfigured()
  return { apiUri: NYLAS_API_URI.replace(/\/$/, ""), apiKey: NYLAS_API_KEY }
}

interface NylasHeader {
  name: string
  value: string
}

function headerValue(headers: NylasHeader[] | undefined, name: string): string | null {
  if (!headers) return null
  const lower = name.toLowerCase()
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? null
}

export interface NylasSendParams {
  grantId: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  /** HTML body — already carries Pathway's tracking pixel + share links. */
  html: string
  /** Inline attachments: base64 content + filename + content type. */
  attachments?: { filename: string; content: string; contentType: string }[]
}

export interface NylasSendResult {
  /** Nylas's own message id (stored in externalMetadata, never the thread key). */
  nylasMessageId: string | null
  /** Nylas's own thread id (stored in externalMetadata, never the thread key). */
  nylasThreadId: string | null
  /** RFC 5322 Message-ID of the sent message — the value future inbound replies
   *  reference via In-Reply-To/References, so it's what we store as externalId. */
  rfcMessageId: string | null
}

/** Send a message as the connected photographer. */
export async function nylasSendMessage(params: NylasSendParams): Promise<NylasSendResult> {
  const { apiUri, apiKey } = requireApi()
  const body: Record<string, unknown> = {
    to: params.to.map((email) => ({ email })),
    subject: params.subject,
    body: params.html,
  }
  if (params.cc && params.cc.length > 0) body.cc = params.cc.map((email) => ({ email }))
  if (params.bcc && params.bcc.length > 0) body.bcc = params.bcc.map((email) => ({ email }))
  if (params.attachments && params.attachments.length > 0) {
    body.attachments = params.attachments.map((a) => ({
      filename: a.filename,
      content_type: a.contentType,
      content: a.content,
    }))
  }
  const res = await fetch(
    `${apiUri}/v3/grants/${encodeURIComponent(params.grantId)}/messages/send?fields=include_basic_headers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  )
  if (!res.ok) {
    let detail = ""
    try {
      const errBody = (await res.json()) as { error?: { message?: string }; message?: string }
      detail = errBody.error?.message ?? errBody.message ?? ""
    } catch {
      // ignore
    }
    throw new Error(`Nylas send failed (${String(res.status)})${detail ? `: ${detail}` : ""}`)
  }
  const json = (await res.json()) as {
    data?: { id?: string; thread_id?: string; headers?: NylasHeader[] }
  }
  const data = json.data ?? {}
  return {
    nylasMessageId: data.id ?? null,
    nylasThreadId: data.thread_id ?? null,
    rfcMessageId: headerValue(data.headers, "Message-ID"),
  }
}

export interface NylasFetchedMessage {
  nylasMessageId: string
  nylasThreadId: string | null
  rfcMessageId: string | null
  from: string
  to: string[]
  cc: string[]
  subject: string | null
  body: string | null
  inReplyTo: string | null
  references: string | null
  date: Date
}

/** Fetch a full received message (body + threading headers) for inbound ingest.
 *  The webhook payload is metadata-only / may be truncated, so we re-query. */
export async function nylasFetchMessage(
  grantId: string,
  messageId: string,
): Promise<NylasFetchedMessage | null> {
  const { apiUri, apiKey } = requireApi()
  const res = await fetch(
    `${apiUri}/v3/grants/${encodeURIComponent(grantId)}/messages/${encodeURIComponent(messageId)}?fields=include_basic_headers`,
    {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
    },
  )
  if (!res.ok) return null
  const json = (await res.json()) as {
    data?: {
      id?: string
      thread_id?: string
      subject?: string
      body?: string
      date?: number
      from?: { email?: string }[]
      to?: { email?: string }[]
      cc?: { email?: string }[]
      headers?: NylasHeader[]
    }
  }
  const d = json.data
  if (!d?.id) return null
  const emails = (list: { email?: string }[] | undefined): string[] =>
    (list ?? []).map((x) => x.email ?? "").filter((e) => e.length > 0)
  return {
    nylasMessageId: d.id,
    nylasThreadId: d.thread_id ?? null,
    rfcMessageId: headerValue(d.headers, "Message-ID"),
    from: emails(d.from)[0] ?? "",
    to: emails(d.to),
    cc: emails(d.cc),
    subject: typeof d.subject === "string" ? d.subject : null,
    body: typeof d.body === "string" ? d.body : null,
    inReplyTo: headerValue(d.headers, "In-Reply-To"),
    references: headerValue(d.headers, "References"),
    date: typeof d.date === "number" ? new Date(d.date * 1000) : new Date(),
  }
}
