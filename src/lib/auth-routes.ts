export const PUBLIC_ROUTES = [
  "/",
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
] as const

// Routes that a SIGNED-IN user is bounced away from (→ /dashboard). Sign-in /
// sign-up / forgot-password make no sense once you're authenticated.
//
// `/reset-password` is deliberately NOT here: a valid reset link must land on
// the reset form even if the visitor happens to have an active session (e.g. an
// admin- or support-triggered reset). Bouncing it to /dashboard silently ate the
// reset. It stays in PUBLIC_ROUTES so signed-out users can still reach it.
export const AUTH_ONLY_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/forgot-password",
] as const

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

export function isAuthOnlyPath(pathname: string): boolean {
  return AUTH_ONLY_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}
