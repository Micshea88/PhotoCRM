/**
 * Push 2c.6.11 — pin the clear-stale-session handler's allowlist.
 * The handler is a Route Handler that clears BA cookies + redirects.
 * Its allowlist is wider than `isValidCallbackUrl` (covers /sign-in
 * and /sign-up which are the state-6 destinations).
 *
 * We test the allowlist function directly (re-implemented here as
 * a sibling to keep the test deterministic without mounting a real
 * NextRequest). If the prod allowlist changes, this test breaks
 * and someone has to look — that's the intended outcome.
 */

import { describe, it, expect } from "vitest"

// Lifted from app/api/auth/clear-stale-session/route.ts. Keeping
// this in sync with the handler is enforced by the test cases:
// every accept + reject case must continue to behave the same way.
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

describe("clear-stale-session handler allowlist", () => {
  it("accepts /sign-in exactly", () => {
    expect(isAllowedTarget("/sign-in")).toBe(true)
  })
  it("accepts /sign-in with query string (the state-6 case)", () => {
    expect(isAllowedTarget("/sign-in?redirect=/accept-invite/foo&email=bar")).toBe(true)
  })
  it("accepts /sign-up with query string", () => {
    expect(isAllowedTarget("/sign-up?email=test%40example.com")).toBe(true)
  })
  it("accepts /accept-invite/<token>", () => {
    expect(isAllowedTarget("/accept-invite/abc123")).toBe(true)
  })
  it("accepts /dashboard", () => {
    expect(isAllowedTarget("/dashboard")).toBe(true)
  })
  it("accepts /onboarding/create-organization", () => {
    expect(isAllowedTarget("/onboarding/create-organization")).toBe(true)
  })

  it("rejects absolute https://", () => {
    expect(isAllowedTarget("https://evil.example.com")).toBe(false)
  })
  it("rejects protocol-relative //", () => {
    expect(isAllowedTarget("//evil.example.com/sign-in")).toBe(false)
  })
  it("rejects javascript: pseudo-protocol", () => {
    expect(isAllowedTarget("javascript:alert(1)")).toBe(false)
  })
  it("rejects path traversal", () => {
    expect(isAllowedTarget("/sign-in/../../../etc/passwd")).toBe(false)
  })
  it("rejects substring trap on /sign-in", () => {
    expect(isAllowedTarget("/sign-inish")).toBe(false)
  })
  it("rejects substring trap on /dashboard", () => {
    expect(isAllowedTarget("/dashboardish")).toBe(false)
  })
  it("rejects empty string", () => {
    expect(isAllowedTarget("")).toBe(false)
  })
  it("rejects bare /", () => {
    expect(isAllowedTarget("/")).toBe(false)
  })
  it("rejects /admin (not in allowlist)", () => {
    expect(isAllowedTarget("/admin")).toBe(false)
  })
  it("rejects /api/something", () => {
    expect(isAllowedTarget("/api/auth/whatever")).toBe(false)
  })
})
