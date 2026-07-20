import "server-only"
import { executeWorkflow } from "@/modules/workflows/executor"
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

/** The central registry the queue drain (`processDueJobs`) dispatches on. New
 *  job types (inbound_email, outbound_email, …) register their handler here. */
export const jobHandlers: HandlerRegistry = {
  workflow_execution: workflowExecutionHandler,
}
