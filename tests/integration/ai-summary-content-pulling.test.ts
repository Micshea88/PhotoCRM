/**
 * Push 3 polish #5 Fix 9.1 — end-to-end integration coverage that
 * the AI summary pipeline ACTUALLY reaches the Haiku prompt with
 * note content.
 *
 * The Fix 9 commit had a unit test that asserted the prompt-building
 * function received the activity argument — but it never exercised
 * the full pipeline (regenerate → activity loader → summary
 * generator). The gap let production land where activity DID load
 * but the user never saw note content in the summary.
 *
 * This test plugs the gap. It seeds a contact with 3 rich notes,
 * runs `runRegeneratePipeline` end-to-end against a mocked
 * `callAiModel`, and asserts the prompt string handed to Haiku
 * contains substrings from each seeded note body.
 *
 * If this test goes red, the pipeline plumbing is broken. If it
 * stays green but Mike still sees fallback output in prod, the
 * issue is at the Haiku boundary (no API key, model error, etc.) —
 * surfaced via the new audit metadata `summaryErrorMessage` and the
 * pino log line `[ai-summary] generator result`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts, contactNotes } from "@/modules/contacts/schema"

interface AiCall {
  systemPrompt: string
  userPrompt: string
  model: string | undefined
}
const aiCalls: AiCall[] = []

vi.mock("@/lib/ai-model", () => ({
  callAiModel: vi.fn((args: { systemPrompt: string; userPrompt: string; model?: string }) => {
    aiCalls.push({
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt,
      model: args.model,
    })
    // Per-call route by feature inferred from the system prompt.
    // Fix 9.2 — the summary prompt now opens with "You brief a
    // photographer..." (was "You write a single short paragraph").
    if (args.systemPrompt.startsWith("You brief a photographer")) {
      return Promise.resolve({
        raw: "Wedding lead — Jimmy and Janie are getting married at the Vinoy on December 27, 2026, with 300 guests. They've agreed we should be their photographer pending mom-approval.",
        modelName: "claude-haiku-4-5-20251001",
        tokensUsed: 120,
        stopReason: "end_turn",
        contentBlockTypes: ["text"],
      })
    }
    // Classifier prompt — return a believable classification.
    return Promise.resolve({
      raw: JSON.stringify({
        status: "Warm Lead",
        reasoning: "Active conversation; pending mom-approval blocker.",
      }),
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 60,
      stopReason: "end_turn",
      contentBlockTypes: ["text"],
    })
  }),
}))

beforeEach(() => {
  aiCalls.length = 0
})

describe("Fix 9.1 — full pipeline threads note content into the Haiku summary prompt", () => {
  it("rich-notes contact: prompt contains substrings from each note's body", async () => {
    const { runRegeneratePipeline } = await import("@/modules/contacts/ai/regenerate-pipeline")

    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "Jimmy",
        lastName: "Jones",
        contactType: "Lead",
        leadSource: "Vendor referral",
        createdBy: userId,
        updatedBy: userId,
      })

      // Three notes that should drive the summary. Each carries a
      // specific detail the summary must be able to reference.
      const noteBodies = [
        "Jimmy is having his wedding at the Vinoy on December 27, 2026. 300 guests confirmed.",
        "Got Jimmy on a call Tuesday afternoon. Walked through the timeline and quote.",
        "Jimmy and Janie agreed we should be their photographer — pending final mom-approval.",
      ]
      for (let i = 0; i < noteBodies.length; i++) {
        await db.insert(contactNotes).values({
          id: createId(),
          organizationId: orgId,
          contactId: cid,
          body: noteBodies[i] ?? "",
          createdAt: new Date(Date.now() - (noteBodies.length - i) * 60_000),
          createdBy: userId,
          updatedBy: userId,
        })
      }

      const result = await runRegeneratePipeline(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        cid,
      )

      // Two AI calls expected: classifier + summary.
      expect(aiCalls.length).toBeGreaterThanOrEqual(2)
      const summaryCall = aiCalls.find((c) => c.systemPrompt.startsWith("You brief a photographer"))
      expect(summaryCall).toBeDefined()

      // The summary user prompt MUST contain the Recent activity block.
      expect(summaryCall?.userPrompt).toContain("Recent activity")
      // AND substrings from each note's body — the previous fix
      // shipped the threading but the user never saw note content.
      // These assertions are the proof-of-fix.
      expect(summaryCall?.userPrompt).toContain("Vinoy")
      expect(summaryCall?.userPrompt).toContain("December 27, 2026")
      expect(summaryCall?.userPrompt).toContain("300 guests")
      expect(summaryCall?.userPrompt).toContain("Tuesday")
      expect(summaryCall?.userPrompt).toContain("mom-approval")

      // The summary that lands on the contact row should be the
      // Haiku output (not the fallback template, which would be
      // "Lead from Vendor referral — Jimmy. Current read: warm lead.").
      expect(result.aiGenerationModel).toBe("claude-haiku-4-5-20251001")
      expect(result.aiSummaryText).toContain("Vinoy")
    })
  })

  it("empty-floor short-circuit — zero-activity contact takes the deterministic path (no Haiku call)", async () => {
    const { runRegeneratePipeline } = await import("@/modules/contacts/ai/regenerate-pipeline")

    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "Empty",
        lastName: "Floor",
        contactType: "Lead",
        leadSource: "Web",
        createdBy: userId,
        updatedBy: userId,
      })

      const result = await runRegeneratePipeline(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        cid,
      )

      expect(aiCalls.length).toBe(0)
      expect(result.aiGenerationModel).toBe("deterministic-floor@1")
      expect(result.aiSummaryText).toContain("No activity logged yet")
    })
  })
})
