import "server-only"
import type { ReactElement } from "react"
import { Resend } from "resend"
import { env } from "@/lib/env"
import { getOutboundGateway } from "@/lib/outbound/config"
import type { Lane } from "@/lib/outbound/rate-limiter"

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
  /**
   * Resend idempotency key. When set, Resend dedups retries of the same send
   * server-side (the `Idempotency-Key` header), so a durable-queue reaper that
   * re-runs a handler after a crash re-issues the send yet the client still
   * receives EXACTLY ONE email. Callers pass a stable per-effect key
   * (e.g. `wf:<executionId>:<stepNo>`).
   */
  idempotencyKey?: string
  /**
   * Org whose outbound-gateway fairness budget this send draws from. Defaults to
   * a shared `"_system"` bucket for auth/system mail (invites, resets, receipts)
   * that has no org context.
   */
  orgId?: string
  /**
   * `interactive` (a human is waiting — the default) vs `bulk` (a workflow batch
   * or import). Bulk reserves no per-org floor and, on throttle, throws a plain
   * Error so the enclosing durable job treats it as transient and reschedules
   * with backoff (requeue-not-sleep via the A3 queue).
   */
  lane?: Lane
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
  idempotencyKey,
  orgId,
  lane,
}: SendEmailParams) {
  if (!react && !html) {
    throw new Error("sendEmail requires either `react` or `html`")
  }
  // Every Resend send goes through the outbound gateway: rate-limited, fair
  // across studios, and circuit-broken. The provider call lives inside `doCall`
  // so a Resend API error is counted as a provider failure (breaker), not a
  // success. On throttle/breaker-open the gateway returns a signal we turn into a
  // plain Error — which the workflow executor treats as transient and reschedules
  // via the durable queue (requeue-not-sleep); interactive callers surface it to
  // the UI exactly as a send failure did before.
  const outcome = await getOutboundGateway().execute(
    "resend",
    orgId ?? "_system",
    lane ?? "interactive",
    async () => {
      const result = await resend().emails.send(
        {
          from: from ?? defaultFromAddress(),
          to,
          subject,
          ...(react ? { react } : { html: html ?? "" }),
          replyTo,
          ...(cc ? { cc } : {}),
          ...(bcc ? { bcc } : {}),
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
          ...(headers ? { headers } : {}),
        },
        idempotencyKey ? { idempotencyKey } : undefined,
      )
      if (result.error) {
        throw new Error(`Email send failed: ${result.error.message}`)
      }
      return result.data
    },
  )
  if (outcome.status === "sent") return outcome.value
  if (outcome.status === "failed") {
    throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error))
  }
  throw new Error(
    `Email send ${outcome.status} (resend): retry after ~${String(outcome.retryAfterMs)}ms`,
  )
}
