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
