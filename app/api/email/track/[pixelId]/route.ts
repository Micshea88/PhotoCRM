import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { emailLog } from "@/modules/email-log/schema"
import { classifyOpen } from "@/modules/email-delivery/classify-open"

export const dynamic = "force-dynamic"

// 1x1 transparent PNG.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

function pixelResponse(): Response {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  })
}

/**
 * Open-tracking pixel (Commit 3 + Task 13). The email embeds
 * /api/email/track/{pixelId}.png; loading it bumps open_count + sets
 * first/last_opened_at, and now also increments the classified counter
 * (open_human_count / open_bot_count / open_unknown_count) based on the
 * request's User-Agent, IP, and timing since send. Public (no session) —
 * the unguessable pixelId is the key. Always returns the pixel, even on
 * miss or error, so the email never shows a broken image.
 */
export async function GET(request: Request, { params }: { params: Promise<{ pixelId: string }> }) {
  const { pixelId: raw } = await params
  const pixelId = raw.replace(/\.png$/i, "")
  try {
    // ── Step 1: read sentAt to compute msSinceSend ──────────────────────
    // A miss (unknown pixelId) → skip counting; still return the pixel.
    const rows = await db
      .select({ sentAt: emailLog.sentAt })
      .from(emailLog)
      .where(sql`${emailLog.trackingPixelId} = ${pixelId}`)

    const row = rows[0]
    if (!row) {
      return pixelResponse()
    }

    // ── Step 2: extract request signals ────────────────────────────────
    const xForwardedFor = request.headers.get("x-forwarded-for")
    const ip =
      xForwardedFor != null
        ? (xForwardedFor.split(",")[0]?.trim() ?? null)
        : (request.headers.get("x-real-ip") ?? null)

    const userAgent = request.headers.get("user-agent") ?? null
    // sentAt is NOT NULL in the schema — always a Date.
    const msSinceSend = Date.now() - row.sentAt.getTime()

    // ── Step 3: classify ────────────────────────────────────────────────
    const cls = classifyOpen({ ip, userAgent, msSinceSend })

    // ── Step 4: update — bump openCount + classified counter + timestamps
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
  } catch {
    // Never let a tracking failure break image loading.
  }
  return pixelResponse()
}
