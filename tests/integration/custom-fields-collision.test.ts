import { describe, it, expect } from "vitest"
import {
  assertNoIntrinsicNameCollision,
  getIntrinsicNamesForRecordType,
} from "@/modules/custom-fields/intrinsic-names"
import { ActionError } from "@/lib/safe-action"

/**
 * Push 4 (A2) — pins the contract that the /settings/custom-fields
 * editor refuses to create a custom field whose name collides with a
 * built-in column on the host table.
 *
 * The asserts are intentionally spec-driven: every name listed in the
 * Push 4 A2 spec under "Integration tests" must trip the collision
 * guard. If a future schema change drops a column, this test will
 * fail and force the catch decision to be explicit (rename the alias,
 * remove the assertion, etc).
 */

function expectCollision(recordType: string, candidate: string) {
  try {
    assertNoIntrinsicNameCollision(recordType, candidate)
    throw new Error(`expected collision for ${candidate} on ${recordType}, got none`)
  } catch (e) {
    expect(e).toBeInstanceOf(ActionError)
    expect((e as ActionError).code).toBe("CONFLICT")
    expect((e as ActionError).message).toContain(candidate)
  }
}

describe("custom-fields intrinsic-name collision guard", () => {
  it("blocks contact-name collisions: Lead Source / Email / Phone / First Name / Last Name", () => {
    expectCollision("contact", "Lead Source")
    expectCollision("contact", "Email")
    expectCollision("contact", "Phone")
    expectCollision("contact", "First Name")
    expectCollision("contact", "Last Name")
  })

  it("blocks company-name collisions: Domain / Name", () => {
    expectCollision("company", "Domain")
    expectCollision("company", "Name")
  })

  it("blocks opportunity-name collisions: Stage / Amount", () => {
    expectCollision("opportunity", "Stage")
    expectCollision("opportunity", "Amount")
  })

  it("blocks project-name collisions: Start Date / Name", () => {
    expectCollision("project", "Start Date")
    expectCollision("project", "Name")
  })

  it("normalizes case + whitespace + underscores when matching", () => {
    expectCollision("contact", "lead_source")
    expectCollision("contact", "  LEAD   SOURCE  ")
    expectCollision("contact", "leadsource")
    expectCollision("contact", "Lead source")
  })

  it("allows clearly-unique names", () => {
    expect(() => {
      assertNoIntrinsicNameCollision("contact", "Allergies")
    }).not.toThrow()
    expect(() => {
      assertNoIntrinsicNameCollision("contact", "Preferred Pronouns")
    }).not.toThrow()
    expect(() => {
      assertNoIntrinsicNameCollision("company", "Industry Code")
    }).not.toThrow()
    expect(() => {
      assertNoIntrinsicNameCollision("project", "Mood Board URL")
    }).not.toThrow()
  })

  it("returns silently when recordType isn't a known entity (defensive)", () => {
    expect(() => {
      assertNoIntrinsicNameCollision("unknown_entity", "Email")
    }).not.toThrow()
  })

  it("intrinsic name sets are non-empty per supported entity", () => {
    expect(getIntrinsicNamesForRecordType("contact").size).toBeGreaterThan(5)
    expect(getIntrinsicNamesForRecordType("company").size).toBeGreaterThan(2)
    expect(getIntrinsicNamesForRecordType("opportunity").size).toBeGreaterThan(2)
    expect(getIntrinsicNamesForRecordType("project").size).toBeGreaterThan(5)
  })
})
