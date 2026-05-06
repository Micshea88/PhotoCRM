/**
 * Next.js 16 introduced `proxy.ts` as the new name for what used to be
 * `middleware.ts`. This file IS the proxy. Do NOT rename it to `middleware.ts`
 * (Next 16 will refuse to boot with both files; the new name is `proxy.ts`).
 *
 * What this gate does: redirects unauthenticated users away from private paths
 * to `/sign-in?redirect=...`, and redirects authenticated users away from
 * sign-in / sign-up pages back to `/dashboard`.
 *
 * What this gate does NOT do: validate the session cookie cryptographically.
 * The cookie's mere presence routes you onward; the real auth check happens
 * server-side in `orgAction` / `authAction` (see `src/lib/safe-action.ts`).
 * Don't "harden" this proxy by adding session lookup — the matcher is hot path
 * and validating each request through Better Auth would be expensive.
 */
import { NextResponse, type NextRequest } from "next/server"
import { isAuthOnlyPath, isPublicPath } from "@/lib/auth-routes"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token")

  if (!sessionCookie && !isPublicPath(pathname)) {
    const url = new URL("/sign-in", request.url)
    url.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(url)
  }

  if (sessionCookie && isAuthOnlyPath(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
}
