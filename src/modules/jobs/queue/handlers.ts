import "server-only"
import { executeWorkflow } from "@/modules/workflows/executor"
import { ingestNylasWebhook } from "@/modules/email-connections/nylas-inbound"
import type { HandlerRegistry, JobHandler } from "./runner"

/**
 * Runs a `workflow_execution` job. The queue has already claimed the job
 * (exactly one worker) and opened an org-scoped, app_authenticated transaction,
 * so the handler just runs the executor on that tx. Per-step idempotency keys
 * on outbound sends (`wf:<executionId>:<stepNo>`) make a post-crash reaper
 * re-run safe — the provider dedups the resend.
 *
 * executeWorkflow records the execution's OWN terminal status (succeeded /
 * failed / deferred) in `workflow_executions` and returns without throwing for
 * those domain outcomes → the job is marked done (we don't retry a workflow
 * that failed on a bad step). Only an infrastructure error (executeWorkflow
 * itself throwing) propagates → the job retries with backoff.
 */
const workflowExecutionHandler: JobHandler = async (tx, job) => {
  const payload = job.payload as { executionId?: unknown } | null
  const executionId =
    payload && typeof payload.executionId === "string" ? payload.executionId : null
  if (!executionId) {
    throw new Error("workflow_execution job is missing payload.executionId")
  }
  await executeWorkflow(tx, executionId)
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

/** The central registry the queue drain (`processDueJobs`) dispatches on. New
 *  job types (resend_webhook, outbound_email, …) register their handler here. */
export const jobHandlers: HandlerRegistry = {
  workflow_execution: workflowExecutionHandler,
  nylas_webhook: nylasWebhookHandler,
}
