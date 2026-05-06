import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { log } from "@/lib/log"

/**
 * Hourly liveness probe. Verifies cron auth (so we know the secret is wired)
 * and pings the database (so we know the connection pool is healthy).
 *
 * Real synthetic monitoring (e.g. BetterUptime, Checkly) belongs elsewhere —
 * this is the canary that the cron pipeline + DB are reachable from inside
 * a Vercel function. If you remove it, you lose that signal.
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  const start = Date.now()
  try {
    await db.execute(sql`select 1`)
  } catch (err) {
    log.error({ err }, "[heartbeat] db ping failed")
    return Response.json({ ok: false, error: "db ping failed" }, { status: 503 })
  }
  const dbMs = Date.now() - start
  log.info({ dbMs }, "[heartbeat] ok")
  return Response.json({ ok: true, ts: new Date().toISOString(), dbMs })
}
