/**
 * Push 2c.6.6 — central role-display contract.
 *
 * Every UI surface that renders an extended role goes through
 * src/modules/rbac/display.ts:getRoleDisplay. This test pins:
 *
 *   1. The map is exhaustive — exactly the EXTENDED_ROLES keys,
 *      no more, no less.
 *   2. The "user" key renders as "Team member" (the LOC1 win
 *      this push is about — collision with the general English
 *      noun is avoided in user-facing copy).
 *   3. Every other key has a sensible capitalised display.
 *   4. Type safety — adding a new role to EXTENDED_ROLES without
 *      extending ROLE_DISPLAY surfaces as a TypeScript error at
 *      build time. (Verified by the Record<ExtendedRole, string>
 *      typing in display.ts; this test additionally asserts the
 *      runtime shape so a stray `as Record<...>` cast wouldn't
 *      silently regress the coverage.)
 */

import { describe, it, expect } from "vitest"
import { ROLE_DISPLAY, getRoleDisplay } from "@/modules/rbac/display"
import { EXTENDED_ROLES, type ExtendedRole } from "@/modules/rbac/types"

describe("ROLE_DISPLAY (Push 2c.6.6)", () => {
  it("has an entry for every EXTENDED_ROLES key", () => {
    for (const role of EXTENDED_ROLES) {
      expect(ROLE_DISPLAY[role], `missing display label for role: ${role}`).toBeTruthy()
    }
  })

  it("has no extra keys beyond EXTENDED_ROLES", () => {
    const allowedKeys = new Set<string>(EXTENDED_ROLES)
    for (const key of Object.keys(ROLE_DISPLAY)) {
      expect(allowedKeys.has(key), `unexpected key in ROLE_DISPLAY: ${key}`).toBe(true)
    }
  })

  it("renders the bare team-member tier as 'Team member' (NOT 'User')", () => {
    expect(getRoleDisplay("user")).toBe("Team member")
    expect(getRoleDisplay("user")).not.toBe("User")
  })

  it("renders every role with the locked display label", () => {
    const expected: Record<ExtendedRole, string> = {
      owner: "Owner",
      admin: "Admin",
      manager: "Manager",
      user: "Team member",
      accountant: "Accountant",
      client: "Client",
    }
    for (const role of EXTENDED_ROLES) {
      expect(getRoleDisplay(role)).toBe(expected[role])
    }
  })

  it("getRoleDisplay is a pure pass-through (idempotent, side-effect-free)", () => {
    const before = { ...ROLE_DISPLAY }
    getRoleDisplay("owner")
    getRoleDisplay("user")
    getRoleDisplay("client")
    expect(ROLE_DISPLAY).toEqual(before)
  })
})
