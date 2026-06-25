import "server-only"
import type { ReactElement } from "react"
import { Resend } from "resend"
import { env } from "@/lib/env"

// Lazy singleton — instantiating at module top-level would access a server env
// var at import time, which breaks when this module is pulled into a client
// component's import graph (e.g. the composer → sendContactEmail action) under
// unit tests. Created on first actual send instead.
let resendClient: Resend | null = null
function resend(): Resend {
  resendClient ??= new Resend(env.RESEND_API_KEY)
  return resendClient
}

/**
 * Push 2c.6.7 — compose RFC 5322 mailbox format with optional
 * display name. When `RESEND_FROM_NAME` is set, recipients see
 * "K&K Photo CRM <invitations@mail.kandkphotography.com>" in
 * their inbox client; when unset, the bare email is used. Kept
 * as a helper so any future per-org sender override (V2 multi-
 * tenant work; see V1_ROADMAP.md) can compose names the same way.
 */
function defaultFromAddress(): string {
  return env.RESEND_FROM_NAME
    ? `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`
    : env.RESEND_FROM_EMAIL
}

export interface SendEmailParams {
  to: string | string[]
  subject: string
  /** Pre-rendered React element. Mutually exclusive with `html`. */
  react?: ReactElement
  /** Raw HTML body (used by the workflow engine's send_email action). Mutually exclusive with `react`. */
  html?: string
  /**
   * Optional explicit From: header. When set, callers are
   * responsible for composing display-name format themselves
   * ("Name <email@domain>"). When unset, defaultFromAddress()
   * builds it from RESEND_FROM_NAME + RESEND_FROM_EMAIL.
   */
  from?: string
  replyTo?: string
  /** Additional recipients. */
  cc?: string | string[]
  bcc?: string | string[]
  /** Inline attachments (Commit 3): base64 `content` + `filename`. */
  attachments?: { filename: string; content: string }[]
  /** Custom headers — used to set a stable Message-ID for email threading. */
  headers?: Record<string, string>
}

export async function sendEmail({
  to,
  subject,
  react,
  html,
  from,
  replyTo,
  cc,
  bcc,
  attachments,
  headers,
}: SendEmailParams) {
  if (!react && !html) {
    throw new Error("sendEmail requires either `react` or `html`")
  }
  const result = await resend().emails.send({
    from: from ?? defaultFromAddress(),
    to,
    subject,
    ...(react ? { react } : { html: html ?? "" }),
    replyTo,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(headers ? { headers } : {}),
  })
  if (result.error) {
    throw new Error(`Email send failed: ${result.error.message}`)
  }
  return result.data
}
