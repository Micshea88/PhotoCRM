import "server-only"
import type { ReactElement } from "react"
import { Resend } from "resend"
import { env } from "@/lib/env"

const resend = new Resend(env.RESEND_API_KEY)

export interface SendEmailParams {
  to: string | string[]
  subject: string
  /** Pre-rendered React element. Mutually exclusive with `html`. */
  react?: ReactElement
  /** Raw HTML body (used by the workflow engine's send_email action). Mutually exclusive with `react`. */
  html?: string
  from?: string
  replyTo?: string
}

export async function sendEmail({ to, subject, react, html, from, replyTo }: SendEmailParams) {
  if (!react && !html) {
    throw new Error("sendEmail requires either `react` or `html`")
  }
  const result = await resend.emails.send({
    from: from ?? env.RESEND_FROM_EMAIL,
    to,
    subject,
    ...(react ? { react } : { html: html ?? "" }),
    replyTo,
  })
  if (result.error) {
    throw new Error(`Email send failed: ${result.error.message}`)
  }
  return result.data
}
