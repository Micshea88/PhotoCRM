/**
 * The Pathway-staff superadmin gate (Piece C). This allowlist is the ONLY thing
 * standing between a normal user and the cross-tenant recovery console, so its
 * parsing/matching is security-critical: case-insensitive, comma-split,
 * whitespace-tolerant, and closed (empty/unknown → denied).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ list: undefined as string | undefined }))

vi.mock("@/lib/env", () => ({
  get env() {
    return { PATHWAY_SUPERADMIN_EMAILS: h.list }
  },
}))

import { isPathwaySuperadmin, assertPathwaySuperadmin } from "@/modules/superadmin/access"

beforeEach(() => {
  h.list = undefined
})

describe("isPathwaySuperadmin", () => {
  it("denies everyone when the allowlist is unset or empty", () => {
    h.list = undefined
    expect(isPathwaySuperadmin("mike@studio.com")).toBe(false)
    h.list = ""
    expect(isPathwaySuperadmin("mike@studio.com")).toBe(false)
  })

  it("allows an exact allowlisted email, case-insensitively", () => {
    h.list = "mike@kandkphotography.com"
    expect(isPathwaySuperadmin("mike@kandkphotography.com")).toBe(true)
    expect(isPathwaySuperadmin("MIKE@KandKphotography.com")).toBe(true)
  })

  it("handles a comma-separated list with whitespace", () => {
    h.list = " mike@studio.com , staff@pathway.com "
    expect(isPathwaySuperadmin("staff@pathway.com")).toBe(true)
    expect(isPathwaySuperadmin("mike@studio.com")).toBe(true)
  })

  it("denies a non-listed email, null, and undefined", () => {
    h.list = "mike@studio.com"
    expect(isPathwaySuperadmin("intruder@evil.com")).toBe(false)
    expect(isPathwaySuperadmin(null)).toBe(false)
    expect(isPathwaySuperadmin(undefined)).toBe(false)
  })
})

describe("assertPathwaySuperadmin", () => {
  it("throws for a non-superadmin and passes for a superadmin", () => {
    h.list = "mike@studio.com"
    expect(() => {
      assertPathwaySuperadmin("intruder@evil.com")
    }).toThrow(/not authorized/i)
    expect(() => {
      assertPathwaySuperadmin("mike@studio.com")
    }).not.toThrow()
  })
})
