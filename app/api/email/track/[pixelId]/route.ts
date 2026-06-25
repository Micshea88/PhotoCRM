import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { emailLog } from "@/modules/email-log/schema"

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
 * Open-tracking pixel (Commit 3). The email embeds
 * /api/email/track/{pixelId}.png; loading it bumps open_count + sets
 * first/last_opened_at on the matching email_log row. Public (no session) —
 * the unguessable pixelId is the key. Always returns the pixel, even on miss,
 * so the email never shows a broken image. No IP/UA stored.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ pixelId: string }> }) {
  const { pixelId: raw } = await params
  const pixelId = raw.replace(/\.png$/i, "")
  try {
    await db
      .update(emailLog)
      .set({
        openCount: sql`${emailLog.openCount} + 1`,
        lastOpenedAt: new Date(),
        firstOpenedAt: sql`COALESCE(${emailLog.firstOpenedAt}, now())`,
      })
      .where(sql`${emailLog.trackingPixelId} = ${pixelId}`)
  } catch {
    // Never let a tracking failure break image loading.
  }
  return pixelResponse()
}
