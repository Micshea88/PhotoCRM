/**
 * Push 2c.6.11 — pin both the allowlist contract AND the
 * Set-Cookie deletion shape on the clear-stale-session handler.
 *
 * The allowlist tests (the original 16) prevent open-redirect
 * regressions. The Set-Cookie tests (new) prevent the Safari
 * "too many redirects" regression — every BA cookie present in
 * the request must come back with a deletion Set-Cookie that
 * carries matching attributes (Secure-prefixed cookies REQUIRE
 * Secure on the deletion or Safari silently drops the delete).
 */

import { describe, it, expect } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/auth/clear-stale-session/route"

// ─── Allowlist tests (unchanged contract from commit 1c36761) ─────────────

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

// ─── Set-Cookie deletion shape (new — Safari regression fix) ──────────────

function makeRequest(opts: { redirect?: string; cookies?: Record<string, string> }): NextRequest {
  const url = new URL("https://photo-crm-three.vercel.app/api/auth/clear-stale-session")
  if (opts.redirect !== undefined) url.searchParams.set("redirect", opts.redirect)
  const cookieHeader = Object.entries(opts.cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  return new NextRequest(url, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  })
}

/**
 * Inspect every Set-Cookie line the response carries for a given
 * cookie name. NextResponse.cookies serializes via the underlying
 * Headers object; we parse it back here so assertions can target
 * attribute text directly (the format Safari sees on the wire).
 */
function getSetCookieLines(response: Response): string[] {
  // Headers.getSetCookie() is the modern API; fall back to
  // forEach if the runtime doesn't expose it.
  interface WithGetSetCookie {
    getSetCookie?: () => string[]
  }
  const h = response.headers as Headers & WithGetSetCookie
  if (typeof h.getSetCookie === "function") return h.getSetCookie()
  const lines: string[] = []
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") lines.push(value)
  })
  return lines
}

function findSetCookie(lines: string[], name: string): string | undefined {
  return lines.find((line) => line.startsWith(`${name}=`))
}

describe("clear-stale-session handler — Set-Cookie deletion shape", () => {
  it("clears __Secure-better-auth.session_token with all required attributes (Safari rejects __Secure- deletes without Secure)", () => {
    const request = makeRequest({
      redirect: "/sign-in",
      cookies: { "__Secure-better-auth.session_token": "fakejwt" },
    })
    const response = GET(request)
    const lines = getSetCookieLines(response)
    const line = findSetCookie(lines, "__Secure-better-auth.session_token")
    expect(
      line,
      `no Set-Cookie line for __Secure-better-auth.session_token; lines=${JSON.stringify(lines)}`,
    ).toBeDefined()
    if (!line) return
    // The deletion attributes must match BA's original cookie set
    // (cookies/index.mjs:24-41) so Safari recognizes it as referring
    // to the same cookie.
    expect(line).toMatch(/Max-Age=0/)
    expect(line).toMatch(/Path=\//)
    expect(line).toMatch(/Secure/) // critical — Safari requires this for __Secure-
    expect(line).toMatch(/HttpOnly/)
    expect(line).toMatch(/SameSite=lax/i)
    // Empty value (deletion semantic)
    expect(line.startsWith("__Secure-better-auth.session_token=;")).toBe(true)
  })

  it("clears __Secure-better-auth.session_data (the cookie 1c36761 missed because cookieCache is enabled)", () => {
    const request = makeRequest({
      redirect: "/sign-in",
      cookies: {
        "__Secure-better-auth.session_token": "tok",
        "__Secure-better-auth.session_data": "data",
      },
    })
    const response = GET(request)
    const lines = getSetCookieLines(response)
    const tokenLine = findSetCookie(lines, "__Secure-better-auth.session_token")
    const dataLine = findSetCookie(lines, "__Secure-better-auth.session_data")
    expect(tokenLine).toBeDefined()
    expect(dataLine, "session_data must also be cleared").toBeDefined()
    if (!dataLine) return
    expect(dataLine).toMatch(/Secure/)
    expect(dataLine).toMatch(/HttpOnly/)
    expect(dataLine).toMatch(/SameSite=lax/i)
    expect(dataLine).toMatch(/Max-Age=0/)
  })

  it("clears chunked session_data.N variants (BA chunks payloads >4KB across cookies)", () => {
    const request = makeRequest({
      redirect: "/sign-in",
      cookies: {
        "__Secure-better-auth.session_token": "tok",
        "__Secure-better-auth.session_data.0": "chunk0",
        "__Secure-better-auth.session_data.1": "chunk1",
      },
    })
    const response = GET(request)
    const lines = getSetCookieLines(response)
    expect(findSetCookie(lines, "__Secure-better-auth.session_data.0")).toBeDefined()
    expect(findSetCookie(lines, "__Secure-better-auth.session_data.1")).toBeDefined()
  })

  it("clears dont_remember when present", () => {
    const request = makeRequest({
      redirect: "/sign-in",
      cookies: {
        "__Secure-better-auth.session_token": "tok",
        "__Secure-better-auth.dont_remember": "1",
      },
    })
    const response = GET(request)
    const lines = getSetCookieLines(response)
    expect(findSetCookie(lines, "__Secure-better-auth.dont_remember")).toBeDefined()
  })

  it("dev cookies (no __Secure- prefix) get Secure=false on deletion", () => {
    const request = makeRequest({
      redirect: "/sign-in",
      cookies: { "better-auth.session_token": "devtok" },
    })
    const response = GET(request)
    const line = findSetCookie(getSetCookieLines(response), "better-auth.session_token")
    expect(line).toBeDefined()
    if (!line) return
    expect(line).not.toMatch(/Secure(;|$)/)
    expect(line).toMatch(/HttpOnly/)
    expect(line).toMatch(/SameSite=lax/i)
    expect(line).toMatch(/Max-Age=0/)
  })

  it("ignores non-BA cookies (doesn't issue spurious Set-Cookie deletes)", () => {
    const request = makeRequest({
      redirect: "/sign-in",
      cookies: {
        "__Secure-better-auth.session_token": "tok",
        // Cookies that shouldn't be touched
        "next-auth.csrf-token": "csrf",
        analytics_session: "asdf",
        theme: "dark",
      },
    })
    const response = GET(request)
    const lines = getSetCookieLines(response)
    expect(findSetCookie(lines, "__Secure-better-auth.session_token")).toBeDefined()
    expect(findSetCookie(lines, "next-auth.csrf-token")).toBeUndefined()
    expect(findSetCookie(lines, "analytics_session")).toBeUndefined()
    expect(findSetCookie(lines, "theme")).toBeUndefined()
  })

  it("returns 307 redirect with Location matching the validated target", () => {
    const request = makeRequest({
      redirect: "/sign-in?email=test@example.com",
      cookies: { "__Secure-better-auth.session_token": "tok" },
    })
    const response = GET(request)
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/sign-in?email=test@example.com")
  })

  it("falls back to /sign-in when redirect target fails the allowlist", () => {
    const request = makeRequest({
      redirect: "https://evil.example.com",
      cookies: { "__Secure-better-auth.session_token": "tok" },
    })
    const response = GET(request)
    expect(response.status).toBe(307)
    const location = response.headers.get("location") ?? ""
    expect(location.endsWith("/sign-in")).toBe(true)
  })

  it("sets Cache-Control: no-store (Safari aggressively caches 307s)", () => {
    const request = makeRequest({
      redirect: "/sign-in",
      cookies: { "__Secure-better-auth.session_token": "tok" },
    })
    const response = GET(request)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("emits zero Set-Cookie lines when no BA cookies are present", () => {
    const request = makeRequest({ redirect: "/sign-in" })
    const response = GET(request)
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/sign-in")
    // Either zero Set-Cookies or none for BA-prefixed names; verify
    // the latter to be precise (the response shouldn't carry deletions
    // for cookies that weren't sent).
    const lines = getSetCookieLines(response)
    const baLines = lines.filter(
      (l) => l.startsWith("better-auth.") || l.startsWith("__Secure-better-auth."),
    )
    expect(baLines).toEqual([])
  })

  it("expires attribute is also present (belt-and-suspenders for older Safari)", () => {
    const request = makeRequest({
      redirect: "/sign-in",
      cookies: { "__Secure-better-auth.session_token": "tok" },
    })
    const response = GET(request)
    const line = findSetCookie(getSetCookieLines(response), "__Secure-better-auth.session_token")
    expect(line).toBeDefined()
    if (!line) return
    // Expires should be at or before the Unix epoch. Older Safari
    // honors Expires when Max-Age isn't recognized.
    expect(line).toMatch(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/)
  })
})
