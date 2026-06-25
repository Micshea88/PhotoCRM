import { NextResponse } from "next/server"
import {
  getShareLinkByToken,
  linkAvailability,
  verifyShareLinkPasscode,
} from "@/modules/files/share-link-access"
import { accessCookieValue } from "@/modules/files/share-link-crypto"

export const dynamic = "force-dynamic"

/**
 * Passcode verification for a protected share link (Commit 3). Rate-limited
 * (5 wrong / 15 min → 30 min lockout, in verifyShareLinkPasscode). On success
 * sets a signed, httpOnly per-link cookie and redirects to the download; on
 * failure/lockout redirects back to the landing page (which shows the counter /
 * countdown).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const base = `/api/share-link/${encodeURIComponent(token)}`
  const row = await getShareLinkByToken(token)
  const now = new Date()
  if (!row || linkAvailability(row.link, now) !== "ok") {
    return NextResponse.redirect(new URL(base, request.url))
  }

  const form = await request.formData()
  const raw = form.get("passcode")
  const passcode = typeof raw === "string" ? raw.trim() : ""
  const result = await verifyShareLinkPasscode(row.link, passcode, now)

  if (result.status === "ok") {
    const res = NextResponse.redirect(new URL(`${base}/download`, request.url))
    res.cookies.set(`sl_${token}`, accessCookieValue(token), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: base,
      maxAge: 60 * 60, // 1 hour to complete the download
    })
    return res
  }
  // wrong / locked → back to landing (it re-derives counter + countdown).
  return NextResponse.redirect(new URL(`${base}?wrong=1`, request.url))
}
