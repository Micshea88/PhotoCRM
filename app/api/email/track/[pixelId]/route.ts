import { recordPixelOpen } from "@/modules/email-log/pixel-tracking"

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
 * first/last_opened_at, and also increments the classified counter
 * (open_human_count / open_bot_count / open_unknown_count) based on the
 * request's User-Agent, IP, and timing since send. Public (no session) —
 * the unguessable pixelId is the key. Always returns the pixel, even on
 * miss or error, so the email never shows a broken image.
 *
 * All DB access is delegated to recordPixelOpen in the email-log module
 * (AGENTS hard rule 1 — no @/lib/db imports from app/).
 */
export async function GET(request: Request, { params }: { params: Promise<{ pixelId: string }> }) {
  const { pixelId: raw } = await params
  const pixelId = raw.replace(/\.png$/i, "")
  try {
    const xForwardedFor = request.headers.get("x-forwarded-for")
    const ip =
      xForwardedFor != null
        ? (xForwardedFor.split(",")[0]?.trim() ?? null)
        : (request.headers.get("x-real-ip") ?? null)

    const userAgent = request.headers.get("user-agent") ?? null

    await recordPixelOpen(pixelId, { ip, userAgent })
  } catch {
    // Never let a tracking failure break image loading.
  }
  return pixelResponse()
}
