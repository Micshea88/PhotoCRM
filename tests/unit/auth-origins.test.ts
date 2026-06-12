/**
 * Unit tests for resolveAuthOrigins — the Vercel-preview baseURL /
 * trustedOrigins derivation behind the preview-login fix.
 *
 * The load-bearing guarantee: PRODUCTION and LOCAL are byte-for-byte
 * unchanged (baseURL = BETTER_AUTH_URL, trustedOrigins = [BETTER_AUTH_URL],
 * which is Better Auth's implicit default). Only a real preview deploy
 * (VERCEL_ENV === "preview" with a VERCEL_URL) gains the extra origin, and
 * it's the exact deploy URL — never a `*.vercel.app` wildcard that would
 * broaden production's trust set.
 */
import { describe, it, expect } from "vitest"
import { resolveAuthOrigins } from "@/lib/auth-origins"

const PROD = "https://app.kandkphotography.com"

describe("resolveAuthOrigins", () => {
  it("production: baseURL + trustedOrigins unchanged (no preview origin)", () => {
    expect(
      resolveAuthOrigins({
        betterAuthUrl: PROD,
        vercelEnv: "production",
        vercelUrl: "app.vercel.app",
      }),
    ).toEqual({ baseURL: PROD, trustedOrigins: [PROD] })
  })

  it("local dev (VERCEL_ENV unset): unchanged", () => {
    expect(
      resolveAuthOrigins({ betterAuthUrl: PROD, vercelEnv: undefined, vercelUrl: undefined }),
    ).toEqual({ baseURL: PROD, trustedOrigins: [PROD] })
  })

  it("preview: derives baseURL + adds the EXACT deploy origin (keeps prod trusted)", () => {
    const out = resolveAuthOrigins({
      betterAuthUrl: PROD,
      vercelEnv: "preview",
      vercelUrl: "photocrm-git-feat-abc-mike.vercel.app",
    })
    expect(out.baseURL).toBe("https://photocrm-git-feat-abc-mike.vercel.app")
    expect(out.trustedOrigins).toEqual([PROD, "https://photocrm-git-feat-abc-mike.vercel.app"])
    // Never a wildcard.
    expect(out.trustedOrigins).not.toContain("https://*.vercel.app")
  })

  it("preview env but no VERCEL_URL: falls back to production config (no half-config)", () => {
    expect(
      resolveAuthOrigins({ betterAuthUrl: PROD, vercelEnv: "preview", vercelUrl: undefined }),
    ).toEqual({ baseURL: PROD, trustedOrigins: [PROD] })
  })
})
