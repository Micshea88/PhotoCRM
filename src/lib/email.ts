import "server-only"
import type { ReactElement } from "react"
import { Resend } from "resend"
import { env } from "@/lib/env"

const resend = new Resend(env.RESEND_API_KEY)

export interface SendEmailParams {
  to: string | string[]
  subject: string
  react: ReactElement
  from?: string
  replyTo?: string
}

export async function sendEmail({ to, subject, react, from, replyTo }: SendEmailParams) {
  const result = await resend.emails.send({
    from: from ?? env.RESEND_FROM_EMAIL,
    to,
    subject,
    react,
    replyTo,
  })
  if (result.error) {
    throw new Error(`Email send failed: ${result.error.message}`)
  }
  return result.data
}
