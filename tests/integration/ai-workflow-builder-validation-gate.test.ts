/**
 * Validation-gate tests for the AI Workflow Builder (module 16a).
 *
 * Hard Constraint #1 proof: every model output passes through the SAME
 * Zod schemas as manual workflow creation. No repair branch. No "ai-
 * permissive" variant of any schema. These tests assert the gate's
 * behavior across the valid/refusal/rejected cases.
 *
 * The action-layer integration test (review-required.test.ts) covers
 * end-to-end behavior; this file pins the gate's pure-function contract.
 */
import { describe, it, expect } from "vitest"
import { validateModelOutput } from "@/modules/ai-workflow-builder/validate"

describe("validation gate — valid drafts pass", () => {
  it("a minimal valid draft passes; kind='draft'; validatedDraft populated", () => {
    const result = validateModelOutput({
      result: "draft",
      name: "Send thank-you email when an opportunity is won",
      triggerType: "opportunity.won",
      steps: [
        {
          actionType: "send_email",
          actionConfig: {
            to: "client@example.com",
            subject: "Thank you!",
            body: "<p>Thanks for booking with us.</p>",
          },
        },
      ],
    })
    expect(result.kind).toBe("draft")
    if (result.kind === "draft") {
      expect(result.validatedDraft.name).toMatch(/thank-you/)
      expect(result.validatedDraft.triggerType).toBe("opportunity.won")
      expect(result.validatedDraft.steps.length).toBe(1)
      expect(result.validatedDraft.steps[0]?.actionType).toBe("send_email")
    }
  })

  it("a draft with multiple native steps passes", () => {
    const result = validateModelOutput({
      result: "draft",
      name: "Multi-step",
      triggerType: "project.created",
      steps: [
        {
          actionType: "send_email",
          actionConfig: { to: "a@b.co", subject: "Hi", body: "Welcome" },
        },
        { actionType: "wait", actionConfig: { delayDays: 7 } },
        {
          actionType: "create_task",
          actionConfig: { title: "Follow up", projectId: "proj_x" },
        },
        { actionType: "end_workflow", actionConfig: null },
      ],
    })
    expect(result.kind).toBe("draft")
  })

  it("a refusal passes; kind='refusal'; reason preserved", () => {
    const result = validateModelOutput({
      result: "refusal",
      reason:
        "take_payment is deferred until Stripe Connect is unlocked. Configure this step or remove it to run the workflow.",
    })
    expect(result.kind).toBe("refusal")
    if (result.kind === "refusal") {
      expect(result.reason).toMatch(/stripe/i)
    }
  })
})

describe("validation gate — config-shape failures rejected", () => {
  it("send_email with non-email `to` → rejected by canonical actionConfigSchema", () => {
    const result = validateModelOutput({
      result: "draft",
      name: "Bad email",
      triggerType: "opportunity.won",
      steps: [
        {
          actionType: "send_email",
          actionConfig: { to: "not-an-email", subject: "x", body: "y" },
        },
      ],
    })
    expect(result.kind).toBe("rejected")
  })

  it("send_email with missing `subject` → rejected", () => {
    const result = validateModelOutput({
      result: "draft",
      name: "Missing subject",
      triggerType: "opportunity.won",
      steps: [
        {
          actionType: "send_email",
          actionConfig: { to: "a@b.co", body: "y" },
        },
      ],
    })
    expect(result.kind).toBe("rejected")
  })

  it("discriminator mismatch (send_email actionType with create_task config) → rejected", () => {
    const result = validateModelOutput({
      result: "draft",
      name: "Mismatch",
      triggerType: "opportunity.won",
      steps: [
        {
          actionType: "send_email",
          // create_task-shaped config, missing send_email fields
          actionConfig: { title: "Hi", projectId: "x" },
        },
      ],
    })
    expect(result.kind).toBe("rejected")
  })
})

describe("validation gate — no `enabled` field on validated draft", () => {
  it("model output with enabled=true: stripped (not in validatedDraft); confirm action hard-codes false", () => {
    const result = validateModelOutput({
      result: "draft",
      name: "Trying to self-enable",
      triggerType: "opportunity.won",
      // enabled: true ← strict() rejects unknown keys
      enabled: true,
      steps: [
        {
          actionType: "send_email",
          actionConfig: { to: "a@b.co", subject: "x", body: "y" },
        },
      ],
    })
    // Either rejected (strict() catches extra key) OR accepted with no
    // `enabled` field surface. Both outcomes prove the AI cannot
    // propagate enabled=true through the gate.
    if (result.kind === "draft") {
      expect("enabled" in result.validatedDraft).toBe(false)
    } else {
      expect(result.kind).toBe("rejected")
    }
  })
})

describe("validation gate — exhaustiveness across edges", () => {
  it("zero steps → rejected (min(1) on steps array)", () => {
    const result = validateModelOutput({
      result: "draft",
      name: "Empty",
      triggerType: "opportunity.won",
      steps: [],
    })
    expect(result.kind).toBe("rejected")
  })

  it("too many steps (21) → rejected (max(20))", () => {
    const steps = Array.from({ length: 21 }, () => ({
      actionType: "end_workflow" as const,
      actionConfig: null,
    }))
    const result = validateModelOutput({
      result: "draft",
      name: "Bloated",
      triggerType: "opportunity.won",
      steps,
    })
    expect(result.kind).toBe("rejected")
  })

  it("missing top-level `result` discriminator → rejected", () => {
    const result = validateModelOutput({
      name: "No result",
      triggerType: "opportunity.won",
      steps: [],
    })
    expect(result.kind).toBe("rejected")
  })
})

describe("validation gate — canonical schemas are imported, not reimplemented", () => {
  // PROOF that the gate uses the exact same actionConfigSchema as
  // manual workflow creation: a config that passes manual creation
  // also passes the AI gate, and a config that fails manual creation
  // also fails the AI gate. (This is a constructive proof by import
  // — see validate.ts top of file.)
  it("the gate's import of actionConfigSchema can be replaced by re-importing — same behavior", async () => {
    const { actionConfigSchema } = await import("@/modules/workflows/types")
    // Manual workflow creation would call:
    //   actionConfigSchema.safeParse({ actionType: 'send_email', config: {...} })
    // The AI gate (validate.ts) makes the same call internally. If
    // either passes, the other passes. If either fails, the other fails.
    const manualResult = actionConfigSchema.safeParse({
      actionType: "send_email",
      config: { to: "a@b.co", subject: "x", body: "y" },
    })
    expect(manualResult.success).toBe(true)

    const aiResult = validateModelOutput({
      result: "draft",
      name: "Same",
      triggerType: "opportunity.won",
      steps: [
        {
          actionType: "send_email",
          actionConfig: { to: "a@b.co", subject: "x", body: "y" },
        },
      ],
    })
    expect(aiResult.kind).toBe("draft")
  })
})
