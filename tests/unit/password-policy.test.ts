/**
 * The password policy (min 8 + composition). `passwordCompositionError` is the
 * server-side gate wired into the Better Auth `before` hook, so its per-rule
 * behavior is security-relevant: it must reject each missing requirement.
 */
import { describe, it, expect } from "vitest"
import { passwordCompositionError } from "@/modules/auth/password-policy"

describe("passwordCompositionError", () => {
  it("accepts a password meeting all requirements", () => {
    expect(passwordCompositionError("Abcdefg1!")).toBeNull()
  })

  it("rejects too-short", () => {
    expect(passwordCompositionError("Ab1!")).toMatch(/at least 8/i)
  })

  it("rejects missing uppercase", () => {
    expect(passwordCompositionError("abcdefg1!")).toMatch(/uppercase/i)
  })

  it("rejects missing number", () => {
    expect(passwordCompositionError("Abcdefgh!")).toMatch(/number/i)
  })

  it("rejects missing special character", () => {
    expect(passwordCompositionError("Abcdefgh1")).toMatch(/special/i)
  })
})
