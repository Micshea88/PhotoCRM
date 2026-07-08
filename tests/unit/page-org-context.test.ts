/**
 * T1-FIX (CRITICAL) — withPageOrgContext must recover from a stale/revoked
 * active org WITHOUT the ERR_TOO_MANY_REDIRECTS loop, while keeping the T1.4
 * fail-closed security property (never serve a revoked org's data, never
 * default the role to "member").
 *
 * These are unit (not integration) tests: the resolution + redirect branches
 * are pure once the DB queries are mocked. The pure switch/clear/keep logic is
 * pinned in tests/unit/resolve-active-org.test.ts; here we assert
 * withPageOrgContext wires it correctly:
 *
 *   - session points at a revoked org, user is memberless
 *       → redirect to /onboarding/create-organization (NOT a loop: the (app)
 *         layout now renders shell-less + clears the stale org, so create-org
 *         renders instead of bouncing back). Page body never runs.
 *   - session points at a revoked org, user is a member of another org
 *       → resolves to the OTHER org, page body runs (context switched), NO
 *         redirect to create-org.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock declarations ─────────────────────────────────────────────────────
//
// vi.mock() is hoisted — the factory runs before any module imports. Do NOT
// reference module-scope variables in factory bodies; use inline literals.

vi.mock("next/navigation", () => ({
  // Simulate Next.js redirect() which throws a special NEXT_REDIRECT error.
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

// Session references org_revoked_test — an org the user is NOT a member of.
vi.mock("@/modules/auth/session", () => ({
  getSession: vi.fn().mockResolvedValue({
    user: { id: "user_revoked_test", name: "Test", email: "test@example.com" },
    session: { activeOrganizationId: "org_revoked_test" },
  }),
}))

// getUserOrganizations is the authoritative membership list; getCurrentMember
// resolves the member row for the (resolved) active org. Overridden per test.
vi.mock("@/modules/org/queries", () => ({
  getUserOrganizations: vi.fn().mockResolvedValue([]),
  getCurrentMember: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/modules/rbac/queries", () => ({
  getExtendedMemberRole: vi.fn().mockResolvedValue("owner"),
}))

vi.mock("@/modules/rbac/types", () => ({
  extendedFromBetterAuth: vi.fn().mockReturnValue("owner"),
}))

vi.mock("@/lib/org-context", () => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  runWithOrgContext: vi.fn().mockImplementation(async (_ctx: unknown, fn: () => unknown) => fn()),
}))

// Import AFTER mocks are registered.
import { withPageOrgContext } from "@/lib/page-org-context"
import { getUserOrganizations, getCurrentMember } from "@/modules/org/queries"

const mockGetUserOrganizations = vi.mocked(getUserOrganizations)
const mockGetCurrentMember = vi.mocked(getCurrentMember)

// ── Tests ─────────────────────────────────────────────────────────────────

describe("withPageOrgContext — stale/revoked active org (T1-FIX loop + T1.4 fail-closed)", () => {
  beforeEach(() => {
    mockGetUserOrganizations.mockResolvedValue([])
    mockGetCurrentMember.mockResolvedValue(null)
  })

  it("memberless + revoked active org → redirects to onboarding (no loop, no data served)", async () => {
    const fn = vi.fn()
    // User is a member of NO org; session still points at org_revoked_test.
    mockGetUserOrganizations.mockResolvedValue([])

    await expect(withPageOrgContext(fn)).rejects.toThrow(
      "NEXT_REDIRECT:/onboarding/create-organization",
    )

    // The page body must NOT run — no org data served to a non-member.
    expect(fn).not.toHaveBeenCalled()
    // The revoked org must never reach a member lookup.
    expect(mockGetCurrentMember).not.toHaveBeenCalled()
  })

  it("revoked active org but member of ANOTHER org → switches, page renders, NO create-org redirect", async () => {
    const fn = vi.fn().mockResolvedValue("page-output")
    // User was removed from org_revoked_test but is still a member of org_y.
    mockGetUserOrganizations.mockResolvedValue([
      { id: "org_y", name: "Y", slug: "y", logo: null, role: "owner" },
    ])
    // getCurrentMember is called with the RESOLVED org (org_y) → row found.
    mockGetCurrentMember.mockResolvedValue({
      id: "m1",
      organizationId: "org_y",
      userId: "user_revoked_test",
      role: "owner",
      createdAt: new Date(),
    })

    const result = await withPageOrgContext(fn)

    // Page body ran (context resolved to the valid org) — no redirect thrown.
    expect(result).toBe("page-output")
    expect(fn).toHaveBeenCalledOnce()
    // Proves the revoked org was replaced: the member lookup used org_y.
    expect(mockGetCurrentMember).toHaveBeenCalledWith("org_y", "user_revoked_test")
    // And the resolved context carries org_y, never the revoked org.
    const [ctx] = fn.mock.calls[0] as [{ orgId: string; role: string }]
    expect(ctx.orgId).toBe("org_y")
    // Never defaulted to "member" — extended role resolved via member_role.
    expect(ctx.role).toBe("owner")
  })

  it("does NOT default the role to 'member' when membership cannot be established", async () => {
    const fn = vi.fn()
    mockGetUserOrganizations.mockResolvedValue([])

    try {
      await withPageOrgContext(fn)
    } catch {
      // Expected redirect throw — swallowed intentionally.
    }
    // If fn had run, it would mean org data was served without authorization.
    expect(fn).not.toHaveBeenCalled()
  })
})
