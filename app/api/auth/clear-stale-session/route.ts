import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Push 2c.6.11 — Route Handler that clears Better Auth session
 * cookies + redirects.
 *
 * Why a Route Handler instead of inline cookie writes from the
 * accept-invite Server Component? Next.js 16 forbids
 * `cookies().set()` from a Server Component render. Commit A
 * (`1accef6`) state 6 attempted exactly that and threw the
 * production 500:
 *
 *   Error: Cookies can only be modified in a Server Action or
 *   Route Handler. (digest: 4049270041)
 *
 * Route Handlers ARE allowed to modify cookies. This endpoint:
 *
 *   1. Clears both BA session-cookie variants (HTTP + Secure).
 *   2. Validates the `?redirect=` target through a local
 *      allowlist (broader than verify-email's callbackURL
 *      allowlist — covers /sign-in and /sign-up which are the
 *      state-6 destinations). Fail-closed to /sign-in.
 *   3. Returns a 307 redirect. The browser drops the cookies on
 *      receiving the response (Set-Cookie Max-Age=0) BEFORE
 *      following the redirect, so the redirected request lands
 *      cookie-free and proxy.ts doesn't bounce.
 *
 * GET-only: state-6 buttons in accept-invite/[token]/page.tsx
 * route here via `<a href>` so navigation is predictable +
 * back-button-friendly.
 *
 * No auth check: this endpoint only clears the caller's own
 * cookies (Set-Cookie on their own response — no cross-user
 * impact). Anonymous visitors can hit it; they get a no-op
 * clear + the redirect.
 *
 * Open-redirect defense: the allowlist below is strictly path-
 * prefix + must-start-with-`/`-not-`//`. No absolute URLs,
 * no protocol-relative, no traversal.
 */

const BA_COOKIE_NAMES = ["better-auth.session_token", "__Secure-better-auth.session_token"] as const

/**
 * Allowlist for valid redirect targets from this handler. Wider
 * than `isValidCallbackUrl` because state 6 routes here on the
 * way to /sign-in or /sign-up (those aren't valid post-verify
 * destinations but ARE valid post-clear destinations).
 */
const ALLOWED_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/accept-invite/",
  "/dashboard",
  "/onboarding/",
] as const

function isAllowedTarget(url: string): boolean {
  if (!url.startsWith("/")) return false
  if (url.startsWith("//")) return false
  if (url.includes("..")) return false
  // First-path-segment ":" check rules out encoded pseudo-protocols
  // that decoding would unmask. (URLSearchParams decodes; we get
  // the decoded form here.)
  const firstSlash = url.indexOf("/", 1)
  const head = firstSlash === -1 ? url : url.slice(0, firstSlash)
  if (head.includes(":")) return false
  return ALLOWED_PREFIXES.some((prefix) => {
    if (prefix.endsWith("/")) return url.startsWith(prefix)
    if (url === prefix) return true
    return (
      url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`) || url.startsWith(`${prefix}#`)
    )
  })
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  for (const name of BA_COOKIE_NAMES) {
    cookieStore.set(name, "", { maxAge: 0, path: "/" })
  }
  const rawRedirect = request.nextUrl.searchParams.get("redirect")
  const target = rawRedirect && isAllowedTarget(rawRedirect) ? rawRedirect : "/sign-in"
  return NextResponse.redirect(new URL(target, request.url))
}
