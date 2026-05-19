import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { log } from "@/lib/log"
import { workflows, workflowSteps, workflowExecutions } from "./schema"
import { dispatchAction, STUB_ACTION_SET } from "./dispatch"
import { type ActionType, type ExecutionStatus, type StepResult } from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Per-step idempotency: the executor reads `stepResults[N].status` BEFORE
 * dispatching step N and SKIPS already-succeeded steps. Combined with the
 * unique-on-idempotency-key partial index on `workflow_executions`, this
 * is the two-layer defense against double-send:
 *
 *   Layer 1 — execution-level: ON CONFLICT DO NOTHING on insert prevents
 *             two execution rows for the same source event.
 *   Layer 2 — step-level: stepResults[N].status === "succeeded" causes
 *             retry-of-execution to skip already-completed actions.
 *
 * The integration tests at tests/integration/workflow-idempotency.test.ts
 * assert this end-to-end with a mocked sendEmail call counter.
 */

export interface ExecuteWorkflowResult {
  status: ExecutionStatus
  stepsRun: number
  stepsSkipped: number
  lastError: string | null
}

interface BranchCondition {
  field: string
  op: string
  value?: unknown
}

function isBranchCondition(x: unknown): x is BranchCondition {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as BranchCondition).field === "string" &&
    typeof (x as BranchCondition).op === "string"
  )
}

function getPayloadValue(payload: Record<string, unknown> | null, field: string): unknown {
  if (!payload) return undefined
  return payload[field]
}

function evaluateBranchCondition(
  condition: BranchCondition,
  payload: Record<string, unknown> | null,
): boolean {
  const v = getPayloadValue(payload, condition.field)
  switch (condition.op) {
    case "eq":
      return v === condition.value
    case "ne":
      return v !== condition.value
    case "is_null":
      return v === null || v === undefined
    case "is_not_null":
      return v !== null && v !== undefined
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(v)
    case "not_in":
      return Array.isArray(condition.value) && !condition.value.includes(v)
    case "gt":
      return typeof v === "number" && typeof condition.value === "number" && v > condition.value
    case "gte":
      return typeof v === "number" && typeof condition.value === "number" && v >= condition.value
    case "lt":
      return typeof v === "number" && typeof condition.value === "number" && v < condition.value
    case "lte":
      return typeof v === "number" && typeof condition.value === "number" && v <= condition.value
    case "contains":
      return (
        typeof v === "string" && typeof condition.value === "string" && v.includes(condition.value)
      )
    default:
      return false
  }
}

function stepResultByNo(arr: unknown[] | null, sequenceNo: number): StepResult | null {
  if (!Array.isArray(arr)) return null
  for (const raw of arr) {
    if (typeof raw === "object" && raw !== null && (raw as StepResult).sequenceNo === sequenceNo) {
      return raw as StepResult
    }
  }
  return null
}

/**
 * Execute one workflow_execution. Idempotent — calling twice with the
 * same executionId is safe (terminal-status check at the top + per-step
 * skip via stepResults).
 *
 * Caller responsibility: open a Postgres transaction, set
 * app.current_org/role/user_id, then call this. The cron/queue route
 * handler is the production caller; tests call it directly with
 * setOrgContext.
 */
export async function executeWorkflow(
  db: DbHandle,
  executionId: string,
): Promise<ExecuteWorkflowResult> {
  // 1. Load execution; terminal-status check (idempotency layer 1).
  const [execution] = await db
    .select()
    .from(workflowExecutions)
    .where(eq(workflowExecutions.id, executionId))
    .limit(1)
  if (!execution) {
    return { status: "failed", stepsRun: 0, stepsSkipped: 0, lastError: "Execution not found" }
  }
  if (
    execution.status === "succeeded" ||
    execution.status === "failed" ||
    execution.status === "deferred"
  ) {
    // Terminal — no-op idempotency on retry.
    return {
      status: execution.status as ExecutionStatus,
      stepsRun: 0,
      stepsSkipped: 0,
      lastError: execution.lastError,
    }
  }

  // 2. Mark running.
  await db
    .update(workflowExecutions)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(workflowExecutions.id, executionId))

  // 3. Load workflow + steps.
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, execution.workflowId), isNull(workflows.deletedAt)))
    .limit(1)
  if (!workflow) {
    await db
      .update(workflowExecutions)
      .set({
        status: "failed",
        lastError: "Workflow not found or deleted",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowExecutions.id, executionId))
    return { status: "failed", stepsRun: 0, stepsSkipped: 0, lastError: "Workflow not found" }
  }
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowId, workflow.id))
    .orderBy(workflowSteps.sequenceNo)

  const stepResults: StepResult[] = Array.isArray(execution.stepResults)
    ? (execution.stepResults as StepResult[])
    : []

  let stepsRun = 0
  let stepsSkipped = 0
  let finalStatus: ExecutionStatus = "succeeded"
  let finalError: string | null = null

  for (const step of steps) {
    // Per-step idempotency (layer 2): if a prior execution attempt
    // already succeeded this step, skip it on retry — the proof that
    // sendEmail is called at most once across retries.
    const prior = stepResultByNo(stepResults, step.sequenceNo)
    if (prior?.status === "succeeded") {
      stepsSkipped += 1
      continue
    }

    // Branch condition — skip step if predicate is false.
    if (step.branchCondition && isBranchCondition(step.branchCondition)) {
      const matches = evaluateBranchCondition(step.branchCondition, execution.triggerPayload)
      if (!matches) {
        stepResults.push({
          sequenceNo: step.sequenceNo,
          status: "skipped",
          completedAt: new Date().toISOString(),
        })
        stepsSkipped += 1
        continue
      }
    }

    // Executor-controlled steps (no dispatch).
    if (step.actionType === "wait") {
      // V1: wait is recorded as succeeded immediately. A future-phase
      // enhancement schedules a delayed self-enqueue via the queue;
      // for now we don't block on real time.
      stepResults.push({
        sequenceNo: step.sequenceNo,
        status: "succeeded",
        completedAt: new Date().toISOString(),
      })
      stepsRun += 1
      continue
    }
    if (step.actionType === "if_else") {
      // The branchCondition already gated this — if we got here, the
      // condition passed. Record success and continue.
      stepResults.push({
        sequenceNo: step.sequenceNo,
        status: "succeeded",
        completedAt: new Date().toISOString(),
      })
      stepsRun += 1
      continue
    }
    if (step.actionType === "end_workflow") {
      stepResults.push({
        sequenceNo: step.sequenceNo,
        status: "succeeded",
        completedAt: new Date().toISOString(),
      })
      stepsRun += 1
      break
    }

    // Dispatch a real action.
    try {
      await dispatchAction(
        {
          db,
          organizationId: execution.organizationId,
          workflowId: workflow.id,
          executionId: execution.id,
          triggerPayload: execution.triggerPayload,
        },
        step.actionType as ActionType,
        step.actionConfig,
      )
      stepResults.push({
        sequenceNo: step.sequenceNo,
        status: "succeeded",
        completedAt: new Date().toISOString(),
      })
      stepsRun += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      const isStub = STUB_ACTION_SET.has(step.actionType)
      stepResults.push({
        sequenceNo: step.sequenceNo,
        status: isStub ? "deferred" : "failed",
        error: message,
        completedAt: new Date().toISOString(),
      })
      // Stubs terminate the execution as `deferred` (user error, not
      // system error); other failures terminate as `failed`.
      finalStatus = isStub ? "deferred" : "failed"
      finalError = message
      log.warn(
        {
          executionId: execution.id,
          sequenceNo: step.sequenceNo,
          actionType: step.actionType,
          isStub,
          message,
        },
        "[workflow-executor] step terminated execution",
      )
      break
    }
  }

  // 4. Finalize.
  await db
    .update(workflowExecutions)
    .set({
      status: finalStatus,
      stepResults,
      lastError: finalError,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workflowExecutions.id, executionId))

  return {
    status: finalStatus,
    stepsRun,
    stepsSkipped,
    lastError: finalError,
  }
}
