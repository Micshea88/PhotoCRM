/**
 * Zone 4 — Write-input validation gate (Module 17b).
 *
 * Mirrors the workflow builder's validation-gate test posture
 * (`ai-workflow-builder-validation-gate.test.ts`). The gate
 * imports the canonical inputSchemas from each writer's module
 * verbatim — no AI-permissive variants, no repair branch.
 *
 * The end-to-end "stored proposal is re-validated at confirm time"
 * test lives in the prompt-injection suite; this file pins the
 * per-shape contract.
 */
import { describe, it, expect } from "vitest"
import { validateAssistantOutput } from "@/modules/ai-assistant/validate"

describe("Zone 4 — write_proposal valid shapes accepted", () => {
  it("valid updateContact proposal accepted", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      input: { id: "cuid_jane", primaryPhone: "555-1234" },
      summaryForUser: "I'll update Jane Doe's contact and set primaryPhone to '555-1234'. Confirm?",
    })
    expect(result.kind).toBe("write_proposal")
    if (result.kind === "write_proposal") {
      expect(result.action).toBe("updateContact")
      expect(result.input).toMatchObject({ id: "cuid_jane", primaryPhone: "555-1234" })
    }
  })

  it("valid markOpportunityWon proposal accepted (status-flip mutator)", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "markOpportunityWon",
      input: { id: "cuid_opp" },
      summaryForUser: "I'll mark the opportunity won. Confirm?",
    })
    expect(result.kind).toBe("write_proposal")
  })
})

describe("Zone 4 — write_proposal invalid inputs rejected", () => {
  it("missing required id on updateContact → rejected", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      input: { primaryPhone: "555-1234" },
      summaryForUser: "Will fail",
    })
    expect(result.kind).toBe("rejected")
  })

  it("invalid email on updateContact → rejected by canonical inputSchema", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      input: { id: "cuid_x", primaryEmail: "not-an-email" },
      summaryForUser: "Will fail",
    })
    expect(result.kind).toBe("rejected")
  })

  it("discriminator-mismatch: action='updateContact' with createTask-shaped input → rejected", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      // updateContact has no projectId/title shape
      input: { projectId: "x", title: "T", priority: "high" },
      summaryForUser: "Will fail",
    })
    // updateContact has no required `id` field present; canonical
    // schema parses partial fields but rejects unknown ones if strict.
    // Either way: input does not satisfy updateContactInput.
    expect(result.kind).toBe("rejected")
  })
})

describe("Zone 4 — shape validation at the discriminator", () => {
  it("missing summaryForUser → rejected", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      input: { id: "cuid_x", primaryPhone: "555-1234" },
      // no summaryForUser
    })
    expect(result.kind).toBe("rejected")
  })

  it("write_proposal with confirmed=true is rejected — model cannot self-confirm", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      input: { id: "cuid_x", primaryPhone: "555-1234" },
      summaryForUser: "Will fail because of extra confirmed field",
      confirmed: true,
    })
    // .strict() on the write_proposal variant — unknown keys rejected.
    // The model has no syntactic path to set confirmed.
    expect(result.kind).toBe("rejected")
  })
})

describe("Zone 4 — canonical-schema import proof", () => {
  it("the validator imports updateContactInput verbatim from @/modules/contacts/types", async () => {
    // Constructive proof: a config that passes the manual UI's
    // updateContactInput also passes the AI gate; a config that
    // fails the manual UI also fails the AI gate.
    const { updateContactInput } = await import("@/modules/contacts/types")
    const validInput = { id: "cuid_jane", primaryPhone: "555-1234" }
    const manualResult = updateContactInput.safeParse(validInput)
    expect(manualResult.success).toBe(true)

    const aiResult = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      input: validInput,
      summaryForUser: "x",
    })
    expect(aiResult.kind).toBe("write_proposal")
  })

  it("a config that fails the manual UI's schema also fails the AI gate", async () => {
    const { updateContactInput } = await import("@/modules/contacts/types")
    const badInput = { id: 123 } // id must be string
    const manualResult = updateContactInput.safeParse(badInput)
    expect(manualResult.success).toBe(false)

    const aiResult = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      input: badInput,
      summaryForUser: "x",
    })
    expect(aiResult.kind).toBe("rejected")
  })
})
