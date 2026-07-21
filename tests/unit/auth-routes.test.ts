/**
 * The middleware (`proxy.ts`) routing predicates. The load-bearing behavior:
 * a signed-in visitor is bounced off "auth-only" pages to the dashboard —
 * correct for sign-in/sign-up, but NOT for `/reset-password`, where it silently
 * ate a valid reset link. `/reset-password` must be PUBLIC (reachable signed-out)
 * yet NOT auth-only (not bounced when signed in).
 */
import { describe, it, expect } from "vitest"
import { isPublicPath, isAuthOnlyPath } from "@/lib/auth-routes"

describe("auth-routes predicates", () => {
  it("keeps /reset-password reachable but NOT bounced for a signed-in user", () => {
    // Reachable signed-out (public) …
    expect(isPublicPath("/reset-password")).toBe(true)
    // … and NOT bounced to /dashboard when signed in — the fix.
    expect(isAuthOnlyPath("/reset-password")).toBe(false)
    // Token subpaths behave the same.
    expect(isAuthOnlyPath("/reset-password?token=abc")).toBe(false)
  })

  it("still bounces signed-in users off sign-in / sign-up", () => {
    expect(isAuthOnlyPath("/sign-in")).toBe(true)
    expect(isAuthOnlyPath("/sign-up")).toBe(true)
  })

  it("private app paths are neither public nor auth-only", () => {
    expect(isPublicPath("/dashboard")).toBe(false)
    expect(isAuthOnlyPath("/dashboard")).toBe(false)
  })

  it("matches nested paths under a public prefix (e.g. accept-invite/:token)", () => {
    expect(isPublicPath("/accept-invite/xyz")).toBe(true)
  })
})
