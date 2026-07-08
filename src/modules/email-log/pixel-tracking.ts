import "server-only"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { emailLog } from "@/modules/email-log/schema"
import { classifyOpen } from "@/modules/email-delivery/classify-open"

/**
 * Record a pixel-open event for the given tracking pixel ID.
 *
 * This is a deliberately org-less, opaque-id-keyed write — no session
 * or org GUC is required. The org is implicit in the pixel row itself
 * (keyed by the unguessable `tracking_pixel_id` column). This matches
 * the same pattern used by webhook resolvers that identify their target
 * row via an opaque external ID rather than an org-scoped lookup.
 *
 * Behavior (Task 13 / T2.6):
 *   1. SELECT `sent_at` from `email_log` where `tracking_pixel_id = pixelId`.
 *      A miss (unknown pixelId) returns without updating — no-op.
 *   2. Classify the open as human / bot / unknown using the request signals.
 *   3. UPDATE `email_log`: bump `open_count`, set `last_opened_at = now()`,
 *      COALESCE `first_opened_at`, and increment the classified counter column.
 *
 * Never throws — callers (the pixel route) wrap this in a try/catch so that
 * a tracking failure never breaks image loading.
 */
export async function recordPixelOpen(
  pixelId: string,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<void> {
  // ── Step 1: read sentAt to compute msSinceSend ──────────────────────────
  const rows = await db
    .select({ sentAt: emailLog.sentAt })
    .from(emailLog)
    .where(sql`${emailLog.trackingPixelId} = ${pixelId}`)

  const row = rows[0]
  if (!row) {
    return
  }

  // ── Step 2: classify ────────────────────────────────────────────────────
  // sentAt is NOT NULL in the schema — always a Date.
  const msSinceSend = Date.now() - row.sentAt.getTime()
  const cls = classifyOpen({ ip: ctx.ip, userAgent: ctx.userAgent, msSinceSend })

  // ── Step 3: update — bump openCount + classified counter + timestamps ───
  const classifiedCounterColumn =
    cls === "human"
      ? { openHumanCount: sql`${emailLog.openHumanCount} + 1` }
      : cls === "bot"
        ? { openBotCount: sql`${emailLog.openBotCount} + 1` }
        : { openUnknownCount: sql`${emailLog.openUnknownCount} + 1` }

  await db
    .update(emailLog)
    .set({
      openCount: sql`${emailLog.openCount} + 1`,
      lastOpenedAt: new Date(),
      firstOpenedAt: sql`COALESCE(${emailLog.firstOpenedAt}, now())`,
      ...classifiedCounterColumn,
    })
    .where(sql`${emailLog.trackingPixelId} = ${pixelId}`)
}
