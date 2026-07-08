import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { workflowExecutions, workflows } from "@/modules/workflows/schema"
import { executeWorkflow } from "@/modules/workflows/executor"
import { log } from "@/lib/log"

/**
 * Cron sweep over `workflow_executions WHERE status = 'pending'`.
 * For each pending row, set the org's RLS context (using the workflow's
 * organizationId — trusted because the matcher only writes
 * organizationId from the audit row source) and call executeWorkflow.
 *
 * Idempotency is layered:
 *   - The execution's terminal-status check inside executeWorkflow
 *     prevents re-running succeeded/failed/deferred rows.
 *   - The per-step stepResults check prevents re-running individual
 *     succeeded steps within a partially-completed execution.
 *
 * This V1 design is a single-pod sweep; production should swap the
 * sweep for a queue dispatch (Vercel Queues / Inngest / Trigger.dev)
 * per src/modules/jobs/README.md. The executor function works
 * unchanged with either dispatch model.
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  try {
    // Read pending executions across all orgs (system-context read; the
    // cron connection bypasses RLS via the admin role in production).
    const pending = await db
      .select({
        id: workflowExecutions.id,
        organizationId: workflowExecutions.organizationId,
        workflowId: workflowExecutions.workflowId,
      })
      .from(workflowExecutions)
      .where(eq(workflowExecutions.status, "pending"))
      .limit(100)

    let processed = 0
    let succeeded = 0
    let deferred = 0
    let failed = 0
    for (const exec of pending) {
      // Verify the workflow still exists + is in the same org (no cross-
      // org corruption possible because the matcher writes from a single
      // audit row's organizationId — but defense in depth).
      const [wf] = await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(
          and(eq(workflows.id, exec.workflowId), eq(workflows.organizationId, exec.organizationId)),
        )
        .limit(1)
      if (!wf) {
        log.warn({ executionId: exec.id }, "[workflow-execute] workflow missing — skipping")
        continue
      }

      // Open a tx with the org's RLS context, then execute.
      await db.transaction(async (tx) => {
        // Drop into the NOBYPASSRLS app role FIRST (before any GUC) so FORCE RLS
        // genuinely enforces on this system-context write — mirroring
        // processInboundEmail (src/modules/email-log/inbound.ts:260-262).
        // Without the role switch the BYPASSRLS owner silently skips RLS in prod.
        await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
        await tx.execute(sql`SELECT set_config('app.current_org', ${exec.organizationId}, true)`)
        await tx.execute(sql`SELECT set_config('app.current_role', 'admin', true)`)
        // System context sees every event: the contacts/projects/tasks RLS
        // overlay (migration 0047) keys write access off app.current_view_all_events,
        // NOT app.current_role — so update_field / create_task steps need this
        // set to 'true' or they affect 0 rows once RLS is active.
        await tx.execute(sql`SELECT set_config('app.current_view_all_events', 'true', true)`)
        const result = await executeWorkflow(tx, exec.id)
        processed += 1
        if (result.status === "succeeded") succeeded += 1
        else if (result.status === "deferred") deferred += 1
        else if (result.status === "failed") failed += 1
      })
    }

    return Response.json({ ok: true, processed, succeeded, deferred, failed })
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
      "[workflow-execute] failed",
    )
    return Response.json({ ok: false, error: "executor failed" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
