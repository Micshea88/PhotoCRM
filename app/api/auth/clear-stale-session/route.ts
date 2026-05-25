import { NextResponse, type NextRequest } from "next/server"

/**
 * Push 2c.6.11 — Route Handler that clears Better Auth session
 * cookies + redirects. Production-hardened in commit (this one)
 * after Mike's Safari smoke surfaced "too many redirects" on the
 * 1c36761 implementation.
 *
 * ROOT CAUSE OF THE 1c36761 REGRESSION:
 *
 *   - Set-Cookie deletes used `cookies().set(...)` (next/headers).
 *     That writes against Next's auto-managed response, not the
 *     freshly-constructed NextResponse.redirect(...) we returned.
 *     The Set-Cookie headers never reached the wire on the
 *     redirect response.
 *
 *   - Even if the headers HAD reached the wire, they omitted
 *     `Secure` — Safari rejects any Set-Cookie write against a
 *     `__Secure-`-prefixed cookie that lacks the `Secure`
 *     attribute (RFC 6265bis). The cookie persisted, proxy.ts
 *     bounced /sign-in → /dashboard → /sign-in → loop.
 *
 *   - The handler also missed `__Secure-better-auth.session_data`
 *     entirely (cookieCache is enabled in src/lib/auth.ts:49-52,
 *     so this cookie is always present alongside session_token).
 *     Same for chunked variants session_data.0/1/N when payload
 *     exceeds 4KB.
 *
 * THE FIX (this commit):
 *
 *   - Build the redirect response FIRST, then call
 *     response.cookies.set() directly on it. This is the documented
 *     Next.js Route Handler pattern for "set headers on a response
 *     I'm explicitly returning."
 *
 *   - Iterate the INCOMING request's cookies and detect anything
 *     matching `better-auth.*` or `__Secure-better-auth.*`. That
 *     covers session_token, session_data, dont_remember, AND any
 *     chunked session_data.N variants without hardcoding. We only
 *     clear cookies the browser is actually sending — no point
 *     spraying deletions for cookies that don't exist.
 *
 *   - Each deletion Set-Cookie carries EVERY attribute BA originally
 *     set (per cookies/index.mjs:24-41): Path=/, HttpOnly, SameSite=Lax,
 *     Secure=true iff name starts with __Secure-. Plus Max-Age=0 +
 *     Expires=Thu, 01 Jan 1970 00:00:00 GMT (belt-and-suspenders so
 *     older Safari versions that prefer Expires over Max-Age also
 *     honor the delete).
 *
 *   - Cache-Control: no-store. Safari aggressively caches 307s; a
 *     cached one would skip the handler entirely on repeat clicks.
 *
 *   - The isAllowedTarget allowlist from 1c36761 stays UNCHANGED.
 *     Open-redirect defense remains intact: only path-prefix
 *     targets in ALLOWED_PREFIXES pass; fail-closed to /sign-in.
 */

const BA_COOKIE_PREFIXES = ["better-auth.", "__Secure-better-auth."] as const

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

function isBaCookieName(name: string): boolean {
  return BA_COOKIE_PREFIXES.some((p) => name.startsWith(p))
}

export function GET(request: NextRequest) {
  const rawRedirect = request.nextUrl.searchParams.get("redirect")
  const target = rawRedirect && isAllowedTarget(rawRedirect) ? rawRedirect : "/sign-in"
  const response = NextResponse.redirect(new URL(target, request.url))

  // Iterate incoming cookies; delete every BA-namespaced one with
  // matching attributes. Attribute matching is critical for Safari
  // — Secure-prefixed cookies REQUIRE Secure on the deletion
  // response or the browser silently refuses the delete.
  for (const cookie of request.cookies.getAll()) {
    if (!isBaCookieName(cookie.name)) continue
    const isSecurePrefixed = cookie.name.startsWith("__Secure-")
    response.cookies.set(cookie.name, "", {
      maxAge: 0,
      expires: new Date(0),
      path: "/",
      secure: isSecurePrefixed,
      httpOnly: true,
      sameSite: "lax",
    })
  }

  response.headers.set("Cache-Control", "no-store")
  return response
}
