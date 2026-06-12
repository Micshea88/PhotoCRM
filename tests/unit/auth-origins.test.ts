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
  it("production: baseURL + trustedOrigins unchanged", () => {
    expect(
      resolveAuthOrigins({
        betterAuthUrl: PROD,
        vercelEnv: "production",
        vercelUrl: "app.vercel.app",
        vercelBranchUrl: "branch.vercel.app",
      }),
    ).toEqual({ baseURL: PROD, trustedOrigins: [PROD] })
  })

  it("local dev (VERCEL_ENV unset): unchanged", () => {
    expect(
      resolveAuthOrigins({
        betterAuthUrl: PROD,
        vercelEnv: undefined,
        vercelUrl: undefined,
        vercelBranchUrl: undefined,
      }),
    ).toEqual({ baseURL: PROD, trustedOrigins: [PROD] })
  })

  it("preview: trusts the EXACT deployment + branch-alias origins (no wildcard)", () => {
    const out = resolveAuthOrigins({
      betterAuthUrl: PROD,
      vercelEnv: "preview",
      vercelUrl: "photocrm-abc123.vercel.app",
      vercelBranchUrl: "photocrm-git-feat-mike.vercel.app",
    })
    // Branch alias preferred for absolute (email) links.
    expect(out.baseURL).toBe("https://photocrm-git-feat-mike.vercel.app")
    expect(out.trustedOrigins).toEqual([
      PROD,
      "https://photocrm-abc123.vercel.app",
      "https://photocrm-git-feat-mike.vercel.app",
    ])
    // NEVER a tenant-wide wildcard.
    expect(out.trustedOrigins.some((o) => o.includes("*"))).toBe(false)
  })

  it("preview with only VERCEL_URL: trusts that exact origin", () => {
    expect(
      resolveAuthOrigins({
        betterAuthUrl: PROD,
        vercelEnv: "preview",
        vercelUrl: "photocrm-abc123.vercel.app",
        vercelBranchUrl: undefined,
      }),
    ).toEqual({
      baseURL: "https://photocrm-abc123.vercel.app",
      trustedOrigins: [PROD, "https://photocrm-abc123.vercel.app"],
    })
  })

  it("PRODUCTION never gets a wildcard (trust set not broadened)", () => {
    const prod = resolveAuthOrigins({
      betterAuthUrl: PROD,
      vercelEnv: "production",
      vercelUrl: "photocrm-abc.vercel.app",
      vercelBranchUrl: "x.vercel.app",
    })
    expect(prod.trustedOrigins).toEqual([PROD])
  })

  it("preview but no Vercel domains exposed: falls back to canonical config", () => {
    expect(
      resolveAuthOrigins({
        betterAuthUrl: PROD,
        vercelEnv: "preview",
        vercelUrl: undefined,
        vercelBranchUrl: undefined,
      }),
    ).toEqual({ baseURL: PROD, trustedOrigins: [PROD] })
  })
})
