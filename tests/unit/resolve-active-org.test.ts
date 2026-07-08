/**
 * T1-FIX (CRITICAL) — resolveActiveOrg is the pure resolution logic that
 * removes the ERR_TOO_MANY_REDIRECTS loop introduced by the T1.4 fail-closed
 * membership check.
 *
 * The loop: a user removed from org X whose session still points at org X hit
 * `if (!memberRow) redirect("/onboarding/create-organization")`. Because
 * create-organization is under (app)/, its layout re-ran with the SAME stale
 * activeOrganizationId and redirected again — forever.
 *
 * The fix validates the session's active org against the authoritative
 * membership list (`getUserOrganizations`) BEFORE any member lookup, so a
 * revoked org is dropped/replaced (never used to establish context) and the
 * caller clears/repicks via setActiveOrganization instead of looping.
 *
 * These assertions pin the three cases that make the loop impossible:
 *   - stale + has other org → returns the other org (switch, no loop)
 *   - stale + memberless     → returns null (→ clear + shell-less, no loop)
 *   - valid                  → returns it unchanged
 * plus the fresh-sign-in (unset) cases.
 */

import { describe, it, expect } from "vitest"
import { resolveActiveOrg } from "@/lib/resolve-active-org"

const orgX = { id: "org_x" }
const orgY = { id: "org_y" }

describe("resolveActiveOrg — revoked/stale active org recovery (loop fix)", () => {
  it("keeps a valid active org (member of it)", () => {
    expect(resolveActiveOrg("org_x", [orgX, orgY])).toBe("org_x")
  })

  it("STALE + has another membership → switches to the other org (no loop)", () => {
    // Session points at org_x (revoked) but the user is a member of org_y.
    // Resolves to org_y — never returns the revoked org_x.
    expect(resolveActiveOrg("org_x", [orgY])).toBe("org_y")
  })

  it("STALE + memberless → returns null (→ clear + shell-less, not a redirect loop)", () => {
    // Session points at org_x (revoked); user is a member of nothing.
    // Returns null so the caller CLEARS the active org and renders shell-less
    // instead of redirecting into (app) forever.
    expect(resolveActiveOrg("org_x", [])).toBeNull()
  })

  it("REVOKED org is never returned even when it is the session value", () => {
    // Explicit security assertion: the revoked id must not survive resolution.
    const result = resolveActiveOrg("org_revoked", [orgX, orgY])
    expect(result).not.toBe("org_revoked")
    expect(result).toBe("org_x")
  })

  it("unset (fresh sign-in) + has membership → auto-picks the first", () => {
    expect(resolveActiveOrg(null, [orgX, orgY])).toBe("org_x")
  })

  it("unset + memberless → null (onboarding / shell-less)", () => {
    expect(resolveActiveOrg(null, [])).toBeNull()
  })
})
