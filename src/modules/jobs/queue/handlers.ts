import "server-only"
import { executeWorkflow } from "@/modules/workflows/executor"
import { ingestNylasWebhook } from "@/modules/email-connections/nylas-inbound"
import { ingestInboundFromEvent } from "@/modules/email-log/inbound"
import { ingestResendDeliveryEvent } from "@/modules/email-delivery/resend-delivery"
import type { HandlerRegistry, JobHandler } from "./runner"

/**
 * Runs a `workflow_execution` job. The queue has already claimed the job
 * (exactly one worker) and opened an org-scoped, app_authenticated transaction,
 * so the handler just runs the executor on that tx. Per-step idempotency keys
 * on outbound sends (`wf:<executionId>:<stepNo>`) make a post-crash reaper
 * re-run safe — the provider dedups the resend.
 *
 * executeWorkflow records the execution's OWN terminal status (succeeded /
 * failed / deferred) and returns without throwing for PERMANENT domain outcomes
 * (a bad-config step) → the job is marked done (we don't retry those). A
 * TRANSIENT step failure (provider 429/5xx, network) instead THROWS while
 * retries remain → the job's transaction rolls back and the queue re-runs it
 * with backoff. We pass `isFinalAttempt` (the claim already bumped `attempts`,
 * so `attempts === maxAttempts` is the last try) so the executor finalizes the
 * execution terminal on the last attempt instead of throwing — otherwise the
 * job would DLQ with the execution stranded non-terminal.
 */
const workflowExecutionHandler: JobHandler = async (tx, job) => {
  const payload = job.payload as { executionId?: unknown } | null
  const executionId =
    payload && typeof payload.executionId === "string" ? payload.executionId : null
  if (!executionId) {
    throw new Error("workflow_execution job is missing payload.executionId")
  }
  await executeWorkflow(tx, executionId, { isFinalAttempt: job.attempts >= job.maxAttempts })
}

/**
 * Runs a `nylas_webhook` job: the async half of the durable webhook pipeline.
 * The edge already verified the signature and resolved the org (for the job
 * row); here we run the proven `ingestNylasWebhook` — re-verify (cheap, and
 * keeps the function self-contained), parse, dispatch by event type, re-fetch
 * the full message, resolve the receiving connection, and hand off to
 * `processInboundEmail` / `recordDeliveryEvent`. Those are each idempotent
 * (dedup on rfc/nylas message id, unique provider_event_id), so a reaper re-run
 * after a crash can't double-process. It manages its own org-scoped
 * transactions internally, so the passed `tx` is unused.
 */
const nylasWebhookHandler: JobHandler = async (_tx, job) => {
  const p = job.payload as { rawBody?: unknown; signature?: unknown } | null
  const rawBody = p && typeof p.rawBody === "string" ? p.rawBody : null
  const signature = p && typeof p.signature === "string" ? p.signature : null
  if (!rawBody) {
    throw new Error("nylas_webhook job is missing payload.rawBody")
  }
  await ingestNylasWebhook(rawBody, signature)
}

/** Resend delivery event types (vs `email.received` inbound). */
const RESEND_DELIVERY_TYPES = new Set(["email.bounced", "email.complained", "email.delivered"])

/**
 * Runs a `resend_webhook` job: the async half of the Resend durable pipeline.
 * This is a tenant-agnostic system-inbox job (null org) — Resend's thin payload
 * carries only ids (a `data.email_id`, the Svix headers), never message content,
 * and the org needs ENRICHMENT to resolve (fetch the email + contact-match /
 * correlate a sent message), so per the claim-check standard the tenant is
 * resolved HERE, in the worker, not at the edge.
 *
 * The edge already Svix-verified the body; we parse and branch by type, exactly
 * as the old inline route did. `ingestResendDeliveryEvent` (dedups on the Svix
 * id → email_delivery_events unique) and `ingestInboundFromEvent` → `process-
 * InboundEmail` (dedups on message id, resolves + fail-closes the org) are each
 * idempotent, so a reaper re-run after a crash can't double-process; both open
 * their own org-scoped transactions once they resolve the tenant.
 */
const resendWebhookHandler: JobHandler = async (_tx, job) => {
  const p = job.payload as { rawBody?: unknown; svixId?: unknown } | null
  const rawBody = p && typeof p.rawBody === "string" ? p.rawBody : null
  const svixId = p && typeof p.svixId === "string" ? p.svixId : null
  if (!rawBody) {
    throw new Error("resend_webhook job is missing payload.rawBody")
  }
  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    return // malformed body — drop (the edge already verified the signature)
  }
  const type = (event as { type?: string }).type
  if (type && RESEND_DELIVERY_TYPES.has(type)) {
    await ingestResendDeliveryEvent(event, svixId)
  } else {
    await ingestInboundFromEvent(event)
  }
}

/** The central registry the queue drain (`processDueJobs`) dispatches on. New
 *  job types (outbound_email, …) register their handler here. */
export const jobHandlers: HandlerRegistry = {
  workflow_execution: workflowExecutionHandler,
  nylas_webhook: nylasWebhookHandler,
  resend_webhook: resendWebhookHandler,
}
