import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { matchAuditEventsToWorkflows } from "@/modules/workflows/trigger-matcher"
import { log } from "@/lib/log"

/**
 * Audit-driven workflow trigger matcher. Runs on Vercel Cron every
 * minute. Scans recent audit_log rows, finds matching enabled
 * workflows, inserts workflow_executions with ON CONFLICT DO NOTHING
 * (the partial unique idempotency index guarantees one execution per
 * source event per workflow).
 *
 * Newly-created executions are enqueued to the executor in a follow-up
 * commit; for now the executor is invoked directly per-id by a separate
 * cron sweep over `status='pending'` rows. Combining matcher + executor
 * in two distinct cron handlers keeps the failure modes independent.
 *
 * NOTE: this V1 cron runs WITHOUT a per-org RLS context — the matcher
 * uses the postgres role (BYPASSRLS) to scan all orgs. This is safe
 * because the matcher only READS audit_log and workflows (system-trusted
 * scan) and the INSERTs use explicit `organizationId` from the audit row.
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  try {
    const result = await matchAuditEventsToWorkflows(db, { limit: 1000 })
    log.info(result, "[workflow-trigger-matcher] tick")
    return Response.json({ ok: true, ...result })
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
      "[workflow-trigger-matcher] failed",
    )
    return Response.json({ ok: false, error: "matcher failed" }, { status: 500 })
  }
}

// Silence the lint rule that requires server-only imports — the cron
// handler IS a server route by definition.
export const dynamic = "force-dynamic"
// Silence unused-sql import (kept for future use in cron-state tracking).
void sql
