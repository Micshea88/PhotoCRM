/**
 * T1.4 — fail-closed membership check in withPageOrgContext.
 *
 * Unit test (not integration) because:
 *   - The redirect() behavior is a pure branch-level assertion — no real DB needed.
 *   - Integration tests for this path would require cookies/session machinery,
 *     pushing them into E2E territory.
 *   - Noted per the task brief: "a focused unit test of the resolver branch is
 *     acceptable if a full integration test is impractical."
 *
 * We mock all external dependencies and exercise just the null-membership
 * branch: when getCurrentMember returns null, withPageOrgContext must call
 * redirect() rather than defaulting the role to "member" and serving org data.
 */

import { describe, it, expect, vi } from "vitest"

// ── Mock declarations ─────────────────────────────────────────────────────
//
// vi.mock() is hoisted — the factory function runs before any module imports.
// Do NOT reference module-scope variables in factory bodies; use inline literals.

vi.mock("next/navigation", () => ({
  // Simulate Next.js redirect() which throws a special NEXT_REDIRECT error.
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

// Minimal session referencing an org the user is no longer a member of.
vi.mock("@/modules/auth/session", () => ({
  getSession: vi.fn().mockResolvedValue({
    user: { id: "user_revoked_test", name: "Test", email: "test@example.com" },
    session: { activeOrganizationId: "org_revoked_test" },
  }),
}))

// The key mock: getCurrentMember returns null → user is not a member.
vi.mock("@/modules/org/queries", () => ({
  getCurrentMember: vi.fn().mockResolvedValue(null),
}))

// Stub rbac / org-context — these should never be reached when member is null.
vi.mock("@/modules/rbac/queries", () => ({
  getExtendedMemberRole: vi.fn().mockResolvedValue("member"),
}))

vi.mock("@/modules/rbac/types", () => ({
  extendedFromBetterAuth: vi.fn().mockReturnValue("member"),
}))

vi.mock("@/lib/org-context", () => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  runWithOrgContext: vi.fn().mockImplementation(async (_ctx: unknown, fn: () => unknown) => fn()),
}))

// Import AFTER mocks are registered.
import { withPageOrgContext } from "@/lib/page-org-context"

// ── Tests ─────────────────────────────────────────────────────────────────

describe("withPageOrgContext — fail-closed membership check (T1.4)", () => {
  it("redirects to /onboarding/create-organization when getCurrentMember returns null", async () => {
    const fn = vi.fn()

    // Should throw the NEXT_REDIRECT error before invoking the page callback.
    await expect(withPageOrgContext(fn)).rejects.toThrow(
      "NEXT_REDIRECT:/onboarding/create-organization",
    )

    // The page body must NOT be invoked — no org data served to a non-member.
    expect(fn).not.toHaveBeenCalled()
  })

  it("does NOT default the role to 'member' when membership is null", async () => {
    const fn = vi.fn()

    try {
      await withPageOrgContext(fn)
    } catch {
      // Expected redirect throw — swallowed intentionally.
    }

    // If fn had been called, it would mean the role was defaulted to "member"
    // and org data was served without authorization. Verify it was never reached.
    expect(fn).not.toHaveBeenCalled()
  })
})
