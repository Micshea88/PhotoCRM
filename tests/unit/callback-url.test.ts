/**
 * Push 2c.6.11 — pin the callbackURL open-redirect defense.
 *
 * Every accepted shape + every rejection mode the validator's
 * comment block claims. A regression here would re-open the
 * open-redirect hole that the verification-flow refactor relies on.
 */

import { describe, it, expect } from "vitest"
import { isValidCallbackUrl } from "@/modules/auth/callback-url"

describe("isValidCallbackUrl — accepted shapes", () => {
  it("accepts /accept-invite/<token>", () => {
    expect(isValidCallbackUrl("/accept-invite/abc123def456")).toBe(true)
  })

  it("accepts /dashboard exactly", () => {
    expect(isValidCallbackUrl("/dashboard")).toBe(true)
  })

  it("accepts /dashboard with query string", () => {
    expect(isValidCallbackUrl("/dashboard?welcome=true")).toBe(true)
  })

  it("accepts /dashboard with hash fragment", () => {
    expect(isValidCallbackUrl("/dashboard#widgets")).toBe(true)
  })

  it("accepts /onboarding/create-organization", () => {
    expect(isValidCallbackUrl("/onboarding/create-organization")).toBe(true)
  })

  it("accepts deeper /onboarding/* paths", () => {
    expect(isValidCallbackUrl("/onboarding/step-2")).toBe(true)
  })

  it("accepts /accept-invite/ with query string", () => {
    expect(isValidCallbackUrl("/accept-invite/token?ref=email")).toBe(true)
  })
})

describe("isValidCallbackUrl — rejected types", () => {
  it("rejects null", () => {
    expect(isValidCallbackUrl(null)).toBe(false)
  })

  it("rejects undefined", () => {
    expect(isValidCallbackUrl(undefined)).toBe(false)
  })

  it("rejects empty string", () => {
    expect(isValidCallbackUrl("")).toBe(false)
  })

  it("rejects whitespace-only string", () => {
    // Whitespace-prefixed isn't `/`-first, so it falls out at step 2.
    expect(isValidCallbackUrl(" /dashboard")).toBe(false)
  })
})

describe("isValidCallbackUrl — absolute URLs are rejected", () => {
  it("rejects https://", () => {
    expect(isValidCallbackUrl("https://evil.example.com")).toBe(false)
  })

  it("rejects http://", () => {
    expect(isValidCallbackUrl("http://evil.example.com")).toBe(false)
  })

  it("rejects https://photo-crm-three.vercel.app/dashboard (same origin but absolute)", () => {
    // Even if the host matches, the spec says the validator accepts
    // ONLY path-prefix-style values. An absolute URL means the caller
    // wired something wrong — fail-closed.
    expect(isValidCallbackUrl("https://photo-crm-three.vercel.app/dashboard")).toBe(false)
  })

  it("rejects protocol-relative URLs (//evil)", () => {
    expect(isValidCallbackUrl("//evil.example.com")).toBe(false)
  })

  it("rejects protocol-relative URLs even when the path looks allowlisted", () => {
    expect(isValidCallbackUrl("//evil.example.com/dashboard")).toBe(false)
  })
})

describe("isValidCallbackUrl — pseudo-protocols are rejected", () => {
  it("rejects javascript:", () => {
    expect(isValidCallbackUrl("javascript:alert(1)")).toBe(false)
  })

  it("rejects data:", () => {
    expect(isValidCallbackUrl("data:text/html,<script>alert(1)</script>")).toBe(false)
  })

  it("rejects file:", () => {
    expect(isValidCallbackUrl("file:///etc/passwd")).toBe(false)
  })

  it("rejects encoded-colon attempts (callerside decodes before validate)", () => {
    // The caller decodeURIComponent's BEFORE calling this validator.
    // After decoding `%3A` becomes `:`. That decoded form is what
    // arrives here. The first-char `/` check still rejects.
    expect(isValidCallbackUrl(":javascript")).toBe(false)
  })
})

describe("isValidCallbackUrl — path traversal rejected", () => {
  it("rejects /accept-invite/../etc", () => {
    expect(isValidCallbackUrl("/accept-invite/../etc")).toBe(false)
  })

  it("rejects /dashboard/.. (escapes the allowlist)", () => {
    expect(isValidCallbackUrl("/dashboard/..")).toBe(false)
  })

  it("rejects /dashboard/../../etc/passwd", () => {
    expect(isValidCallbackUrl("/dashboard/../../etc/passwd")).toBe(false)
  })

  it("rejects /onboarding/..//evil (combo)", () => {
    expect(isValidCallbackUrl("/onboarding/..//evil")).toBe(false)
  })
})

describe("isValidCallbackUrl — paths outside allowlist", () => {
  it("rejects /admin (not in allowlist)", () => {
    expect(isValidCallbackUrl("/admin")).toBe(false)
  })

  it("rejects /sign-in", () => {
    expect(isValidCallbackUrl("/sign-in")).toBe(false)
  })

  it("rejects /api/anything", () => {
    expect(isValidCallbackUrl("/api/auth/whatever")).toBe(false)
  })

  it("rejects / (root alone)", () => {
    // BA's default callbackURL is encodeURIComponent("/"). We treat
    // that as not-targeting-anywhere-useful → fall back to /dashboard.
    expect(isValidCallbackUrl("/")).toBe(false)
  })

  it("rejects /dashboardish (substring trap)", () => {
    // /dashboardish starts with /dashboard but isn't separated by
    // /, ?, or # — would be a different route entirely.
    expect(isValidCallbackUrl("/dashboardish")).toBe(false)
  })

  it("rejects /accept-invitex (substring trap)", () => {
    expect(isValidCallbackUrl("/accept-invitex")).toBe(false)
  })
})
