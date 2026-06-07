import { and, eq, isNull, lt } from "drizzle-orm"
import { db } from "@/lib/db"
import { log } from "@/lib/log"
import { withOrgContext } from "@/lib/org-context"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { telephonyConnections } from "@/modules/telephony/schema"
import {
  RingCentralAuthError,
  RingCentralTransientError,
  refreshConnectionUnconditionally,
} from "@/modules/telephony/token-refresh"

/**
 * Daily resurrection cron for RingCentral connections.
 *
 * Force-refreshes any RC connection whose `refresh_token_expires_at`
 * is within 2 days. RC refresh tokens last ~7 days; refreshing
 * before that boundary keeps the chain alive during months of
 * dormancy. 2-day buffer = one missed cron run does not kill the
 * chain (matches the spec in token-refresh.ts module header).
 *
 * UX CONTRACT (locked — see token-refresh.ts module docstring):
 * per-connection failures are LOGGED via pino only — never audited,
 * never surface to the UI. The next user action or the next cron
 * run re-tries automatically.
 *
 * SECURITY:
 *   - Bare `db` is the BYPASSRLS owner role (Neon owner). Used ONLY
 *     for the cross-org candidate scan, mirroring the purge-deleted
 *     cron's cross-org SELECT pattern.
 *   - Each per-row refresh is wrapped in `withOrgContext()` which
 *     does `SET LOCAL ROLE app_authenticated` + sets the
 *     `app.current_org` GUC so the SELECT FOR UPDATE inside
 *     `refreshConnectionUnconditionally` runs under the same RLS
 *     enforcement a real user request would.
 *
 * RELIABILITY:
 *   - TELEPHONY_REFRESH_ENABLED=false kill-switch via env (no deploy
 *     required to disable during an RC-side outage).
 *   - Batch-limited scan with `moreToProcess` continuation hint so a
 *     backlog drains across runs without exceeding per-run timeout.
 *   - Per-candidate try/catch so one bad row cannot break the batch.
 *   - One transaction per candidate (not one big tx) for failure
 *     isolation.
 *
 * AUDIT:
 *   - No audit row written. Token rotation is routine — auditing
 *     every run would drown the audit log's "user-meaningful action"
 *     signal. Pino structured logging is the trail; correlate via
 *     `feature: "telephony.token-refresh.cron"` (and the runtime
 *     helper uses `feature: "telephony.token-refresh"`).
 */

const BATCH_LIMIT = Number(process.env.TELEPHONY_REFRESH_BATCH_LIMIT ?? 1000)
const REFRESH_ENABLED = (process.env.TELEPHONY_REFRESH_ENABLED ?? "true") !== "false"
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  if (!REFRESH_ENABLED) {
    log.warn(
      { feature: "telephony.token-refresh.cron" },
      "[refresh-telephony] TELEPHONY_REFRESH_ENABLED=false — skipping",
    )
    return Response.json({ ok: true, skipped: true, reason: "REFRESH_ENABLED=false" })
  }

  const cutoff = new Date(Date.now() + TWO_DAYS_MS)

  // Cross-org candidate scan. `db` runs as BYPASSRLS owner — same
  // pattern as purge-deleted. Per-row writes drop into NOBYPASSRLS
  // via withOrgContext below.
  const candidates = await db
    .select({
      id: telephonyConnections.id,
      organizationId: telephonyConnections.organizationId,
      userId: telephonyConnections.userId,
    })
    .from(telephonyConnections)
    .where(
      and(
        eq(telephonyConnections.provider, "ringcentral"),
        isNull(telephonyConnections.deletedAt),
        lt(telephonyConnections.refreshTokenExpiresAt, cutoff),
      ),
    )
    .limit(BATCH_LIMIT)

  let refreshed = 0
  let authErrors = 0
  let transientErrors = 0
  let unknownErrors = 0

  for (const c of candidates) {
    try {
      await withOrgContext(
        async (tx) =>
          refreshConnectionUnconditionally(tx, {
            organizationId: c.organizationId,
            userId: c.userId,
          }),
        { orgId: c.organizationId, role: "owner", userId: c.userId },
      )
      refreshed++
    } catch (err) {
      if (err instanceof RingCentralAuthError) {
        authErrors++
        log.warn(
          {
            feature: "telephony.token-refresh.cron",
            connectionId: c.id,
            code: err.code,
          },
          "[refresh-telephony] auth error — connection will remain dormant; next user action will retry",
        )
      } else if (err instanceof RingCentralTransientError) {
        transientErrors++
        log.warn(
          {
            feature: "telephony.token-refresh.cron",
            connectionId: c.id,
            code: err.code,
          },
          "[refresh-telephony] transient error — next cron run will retry",
        )
      } else {
        unknownErrors++
        log.error(
          { feature: "telephony.token-refresh.cron", connectionId: c.id, err },
          "[refresh-telephony] unexpected error",
        )
      }
    }
  }

  return Response.json({
    ok: true,
    total: candidates.length,
    refreshed,
    authErrors,
    transientErrors,
    unknownErrors,
    batchLimit: BATCH_LIMIT,
    moreToProcess: candidates.length === BATCH_LIMIT,
  })
}
