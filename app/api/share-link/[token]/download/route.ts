import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { blob } from "@/lib/blob"
import {
  getShareLinkByToken,
  linkAvailability,
  logShareEvent,
} from "@/modules/files/share-link-access"
import { verifyAccessCookie } from "@/modules/files/share-link-crypto"

export const dynamic = "force-dynamic"

/**
 * Gated download for a share link (Commit 3). Streams the private blob to the
 * external recipient once the link is available and — when protected — the
 * passcode cookie verifies. Logs a "downloaded" event (recipient-tied, no
 * IP/UA per spec).
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const base = `/api/share-link/${encodeURIComponent(token)}`
  const row = await getShareLinkByToken(token)
  const now = new Date()
  if (!row || linkAvailability(row.link, now) !== "ok") {
    return NextResponse.redirect(new URL(base, request.url))
  }
  const { link, file } = row

  if (link.passcodeHash) {
    const cookieStore = await cookies()
    const verified = verifyAccessCookie(token, cookieStore.get(`sl_${token}`)?.value)
    if (!verified) return NextResponse.redirect(new URL(base, request.url))
  }

  const got = await blob.get(file.url)
  if (!got) {
    return new Response("This file is no longer available.", { status: 404 })
  }
  await logShareEvent(link.id, link.organizationId, "downloaded")

  return new Response(got.stream, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.pathname.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  })
}
