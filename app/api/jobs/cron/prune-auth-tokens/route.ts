import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { pruneExpiredVerifications } from "@/modules/auth/token-prune"
import { log } from "@/lib/log"

/**
 * Daily prune of expired Better Auth `verification` rows (password-reset tokens).
 * BA doesn't clean these up itself, so they accumulate; deleting expired ones
 * also minimizes how long a stale reset token sits in the DB. Operational cleanup
 * of an auth table (no org, no user data) — logged, not audited (audit_log is
 * org-NOT-NULL; same posture as heartbeat / prune-jobs).
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  const deleted = await pruneExpiredVerifications(db)
  log.info({ feature: "auth", deleted }, "[prune-auth-tokens] pruned expired verification rows")
  return Response.json({ ok: true, deleted })
}
