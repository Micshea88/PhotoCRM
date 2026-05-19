import "server-only"
import { and, eq, gte, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import type * as schema from "@/db/schema"
import { auditLog } from "@/modules/audit/schema"
import { workflows, workflowExecutions } from "./schema"
import { type TriggerType } from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Audit-driven trigger matcher. Reads audit_log rows since a watermark,
 * finds matching enabled workflows (within the same org), inserts
 * workflow_executions with ON CONFLICT DO NOTHING — the partial unique
 * index on (org, workflow, idempotency_key) guarantees one execution
 * per source event per workflow.
 *
 * The idempotency key format: `<triggerType>:<eventId>:<workflowId>`.
 * Time-based triggers additionally bake in the date (see
 * createTimeBasedExecution below).
 */

/**
 * Map an audit action string ("opportunities.stage_moved",
 * "opportunities.won", "tasks.marked_done", etc.) to the V1 trigger
 * type that fires on it. Returns null if the audit action doesn't
 * correspond to a V1 trigger.
 */
function triggerTypeForAuditAction(action: string): TriggerType | null {
  switch (action) {
    case "opportunities.stage_moved":
      return "opportunity.stage_changed"
    case "opportunities.won":
      return "opportunity.won"
    case "opportunities.lost":
      return "opportunity.lost"
    case "tasks.marked_done":
      return "task.completed"
    case "projects.created":
      return "project.created"
    case "contacts.created":
      return "contact.created"
    default:
      return null
  }
}

export function computeIdempotencyKey(
  triggerType: string,
  eventId: string,
  workflowId: string,
): string {
  return `${triggerType}:${eventId}:${workflowId}`
}

export function computeTimeBasedIdempotencyKey(
  triggerType: string,
  resourceId: string,
  workflowId: string,
  date: string,
): string {
  return `${triggerType}:${resourceId}:${workflowId}:${date}`
}

interface MatcherResult {
  candidatesScanned: number
  executionsCreated: number
  duplicatesSkipped: number
  createdExecutionIds: string[]
}

/**
 * Process a batch of audit-log events. For each event, find matching
 * enabled workflows in the SAME org, try to insert an execution row;
 * ON CONFLICT DO NOTHING means duplicate fires are silently skipped
 * (the count is recorded in the result for observability).
 *
 * Caller responsibility: set RLS context (app.current_org for each
 * org touched, OR — more practically — call this from a system route
 * that connects as a privileged role / iterates per-org).
 */
export async function matchAuditEventsToWorkflows(
  db: DbHandle,
  args: { sinceAuditId?: string; limit?: number } = {},
): Promise<MatcherResult> {
  const limit = args.limit ?? 1000

  // Read recent audit rows. In production the route iterates per-org
  // (each tx with its own app.current_org); for tests we typically run
  // with a single org context.
  const auditRowsQuery = db
    .select({
      id: auditLog.id,
      organizationId: auditLog.organizationId,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .orderBy(auditLog.id)
    .limit(limit)
  const auditRows = args.sinceAuditId
    ? await auditRowsQuery.where(gte(auditLog.id, args.sinceAuditId))
    : await auditRowsQuery

  let executionsCreated = 0
  let duplicatesSkipped = 0
  const createdExecutionIds: string[] = []

  for (const row of auditRows) {
    const triggerType = triggerTypeForAuditAction(row.action)
    if (!triggerType) continue

    // Find enabled workflows in this org with matching triggerType.
    const matches = await db
      .select({
        id: workflows.id,
        triggerConfig: workflows.triggerConfig,
      })
      .from(workflows)
      .where(
        and(
          eq(workflows.organizationId, row.organizationId),
          eq(workflows.triggerType, triggerType),
          eq(workflows.enabled, true),
        ),
      )

    for (const wf of matches) {
      const idempotencyKey = computeIdempotencyKey(triggerType, row.id, wf.id)
      const insertResult = await db
        .insert(workflowExecutions)
        .values({
          id: createId(),
          organizationId: row.organizationId,
          workflowId: wf.id,
          triggerEventType: triggerType,
          triggerEventId: row.id,
          triggerPayload: {
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            ...row.metadata,
          },
          idempotencyKey,
          status: "pending",
        })
        .onConflictDoNothing({
          target: [
            workflowExecutions.organizationId,
            workflowExecutions.workflowId,
            workflowExecutions.idempotencyKey,
          ],
          where: sql`${workflowExecutions.deletedAt} IS NULL`,
        })
        .returning({ id: workflowExecutions.id })

      if (insertResult.length > 0 && insertResult[0]) {
        executionsCreated += 1
        createdExecutionIds.push(insertResult[0].id)
      } else {
        duplicatesSkipped += 1
      }
    }
  }

  return {
    candidatesScanned: auditRows.length,
    executionsCreated,
    duplicatesSkipped,
    createdExecutionIds,
  }
}
