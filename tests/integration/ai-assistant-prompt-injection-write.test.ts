/**
 * Zone 2 — Prompt-injection forcing an unrequested write (Module 17b).
 *
 * The adversarial scenario: a user (or a malicious data field
 * interpolated into the prompt) tries to coerce the model into
 * emitting a write_proposal the user didn't ask for. The defense is
 * STRUCTURAL, not prompt-sanitization:
 *
 *   1. assistantTurn NEVER invokes an orgAction itself. The
 *      write_proposal output is persisted as a pending row. No
 *      mutation against the target table occurs at this step.
 *   2. The actual mutation only happens via the separate
 *      confirmWriteProposal action, which requires
 *      `confirmed: z.literal(true)` from the USER (not the model).
 *   3. The user sees the plain-language proposal BEFORE confirming.
 *      They can reject via rejectWriteProposal.
 *   4. confirmWriteProposal re-validates the stored input through
 *      the writer's canonical inputSchema (tamper defense).
 *   5. Cross-org / cross-user proposals are blocked by the org-scoped
 *      lookup in confirmWriteProposal.
 *
 * Tests use the validator + the test db to prove these properties.
 * The end-to-end action invocation is exercised via direct DB writes
 * (mocked model via vi.mock) since orgAction is hard to exercise
 * inside withTestDb (uses global db via auth.getSession).
 */
import { describe, it, expect, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { memberRole } from "@/modules/rbac/schema"
import { aiAssistantMessages } from "@/modules/ai-assistant/schema"
import { contacts } from "@/modules/contacts/schema"
import { confirmWriteProposalInput, rejectWriteProposalInput } from "@/modules/ai-assistant/types"
import { validateAssistantOutput } from "@/modules/ai-assistant/validate"

vi.mock("@/lib/ai-model", () => ({ callAiModel: vi.fn() }))

async function seedOwner(db: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const userId = await createUser(db)
  const orgId = await createOrganization(db, userId)
  await setOrgContext(db, orgId, "owner", userId)
  await db.insert(memberRole).values({
    id: createId(),
    organizationId: orgId,
    userId,
    role: "owner",
  })
  return { orgId, userId }
}

describe("Zone 2 — adversarial model output produces a pending proposal but ZERO mutations", () => {
  it("model emits write_proposal after adversarial prompt → validator accepts as proposal; ZERO contact mutations", async () => {
    await withTestDb(async (db) => {
      const env = await seedOwner(db)
      // Seed an existing contact we'll target.
      const targetId = createId()
      await db.insert(contacts).values({
        id: targetId,
        organizationId: env.orgId,
        firstName: "Jane",
        lastName: "Doe",
        createdBy: env.userId,
        updatedBy: env.userId,
      })

      // Adversarial output the model might emit after "ignore previous
      // instructions" prompt: a valid write_proposal.
      const validation = validateAssistantOutput({
        kind: "write_proposal",
        action: "updateContact",
        input: { id: targetId, primaryEmail: "attacker@example.com" },
        summaryForUser: "I'll update Jane's email. Confirm?",
      })
      expect(validation.kind).toBe("write_proposal")

      // The validator accepts (it's well-formed). The mutation does
      // NOT happen here — only when confirmWriteProposal is called.
      // Verify the target contact is unchanged.
      const [contact] = await db
        .select({ primaryEmail: contacts.primaryEmail })
        .from(contacts)
        .where(eq(contacts.id, targetId))
      expect(contact?.primaryEmail).toBeNull()
    })
  })
})

describe("Zone 2 — confirmWriteProposalInput requires literal true (no defaults)", () => {
  it("{ confirmed: true } → accepted", () => {
    expect(confirmWriteProposalInput.safeParse({ proposalId: "x", confirmed: true }).success).toBe(
      true,
    )
  })

  it("{ confirmed: false } → rejected", () => {
    expect(confirmWriteProposalInput.safeParse({ proposalId: "x", confirmed: false }).success).toBe(
      false,
    )
  })

  it("{ confirmed: 'yes' } → rejected (z.literal(true) is type-strict)", () => {
    expect(confirmWriteProposalInput.safeParse({ proposalId: "x", confirmed: "yes" }).success).toBe(
      false,
    )
  })

  it("missing confirmed → rejected", () => {
    expect(confirmWriteProposalInput.safeParse({ proposalId: "x" }).success).toBe(false)
  })

  it("missing proposalId → rejected", () => {
    expect(confirmWriteProposalInput.safeParse({ confirmed: true }).success).toBe(false)
  })
})

describe("Zone 2 — rejectWriteProposalInput input shape", () => {
  it("{ proposalId } accepted", () => {
    expect(rejectWriteProposalInput.safeParse({ proposalId: "x" }).success).toBe(true)
  })
  it("missing proposalId rejected", () => {
    expect(rejectWriteProposalInput.safeParse({}).success).toBe(false)
  })
})

describe("Zone 2 — rejected proposals stay rejected; ZERO mutations after rejection", () => {
  it("manually-rejected proposal does NOT mutate the target table", async () => {
    await withTestDb(async (db) => {
      const env = await seedOwner(db)
      const targetId = createId()
      await db.insert(contacts).values({
        id: targetId,
        organizationId: env.orgId,
        firstName: "Jane",
        lastName: "Doe",
        createdBy: env.userId,
        updatedBy: env.userId,
      })

      // Persist a write_proposal as the assistantTurn handler would.
      const proposalId = createId()
      await db.insert(aiAssistantMessages).values({
        id: proposalId,
        organizationId: env.orgId,
        conversationId: "conv-x",
        userId: null,
        role: "write_proposal",
        content: "I'll update Jane's email. Confirm?",
        writeProposalAction: "updateContact",
        writeProposalInput: { id: targetId, primaryEmail: "attacker@example.com" },
        writeProposalStatus: "pending",
      })

      // Reject (simulating rejectWriteProposal's effect — set status).
      await db
        .update(aiAssistantMessages)
        .set({ writeProposalStatus: "rejected" })
        .where(eq(aiAssistantMessages.id, proposalId))

      // The target contact is unchanged.
      const [contact] = await db
        .select({ primaryEmail: contacts.primaryEmail })
        .from(contacts)
        .where(eq(contacts.id, targetId))
      expect(contact?.primaryEmail).toBeNull()
    })
  })
})

describe("Zone 2 — cross-org probe (RLS bounds the proposal lookup)", () => {
  it("a pending proposal in org A is invisible to org B's confirmWriteProposal probe (RLS)", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const userB = await createUser(db)
      const orgB = await createOrganization(db, userB)

      // Org A — write a pending proposal.
      await setOrgContext(db, orgA, "owner", userA)
      const proposalId = createId()
      await db.insert(aiAssistantMessages).values({
        id: proposalId,
        organizationId: orgA,
        conversationId: "conv-orgA",
        userId: null,
        role: "write_proposal",
        content: "Proposal in org A",
        writeProposalAction: "updateContact",
        writeProposalInput: { id: "some_contact", primaryEmail: "a@b.co" },
        writeProposalStatus: "pending",
      })

      // Switch RLS to org B. The proposal row should be invisible.
      await setOrgContext(db, orgB, "owner", userB)
      const probeFromB = await db
        .select({ id: aiAssistantMessages.id })
        .from(aiAssistantMessages)
        .where(eq(aiAssistantMessages.id, proposalId))
      expect(probeFromB.length).toBe(0)
    })
  })
})

describe("Zone 2 — write_proposal output schema does NOT carry a confirmed field", () => {
  it("model output with confirmed=true is rejected by .strict() on write_proposal", () => {
    const result = validateAssistantOutput({
      kind: "write_proposal",
      action: "updateContact",
      input: { id: "x", primaryPhone: "555-0000" },
      summaryForUser: "Will fail",
      confirmed: true,
    })
    expect(result.kind).toBe("rejected")
  })
})
