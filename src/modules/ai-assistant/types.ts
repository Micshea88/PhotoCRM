import { z } from "zod"
import { ASSISTANT_RETRIEVER_NAMES } from "./retrievers"
import { ROUTE_IDS } from "./route-catalog"

/**
 * Model-output contract for the AI Assistant (module 17). Five
 * variants in a discriminated union: `reply` / `retrieve` / `navigate`
 * / `refusal` / `write_proposal`.
 *
 * Every variant uses `.strict()` so the model cannot smuggle unknown
 * fields (mirrors the ai-workflow-builder schema's defense). The
 * `write_proposal` variant specifically has NO `confirmed` field —
 * `.strict()` rejects one — because the model cannot self-confirm.
 * Confirmation happens via the separate `confirmWriteProposal` action
 * below, which requires `confirmed: z.literal(true)` from the user.
 */

const retrieverNameSchema = z.enum(ASSISTANT_RETRIEVER_NAMES as [string, ...string[]])
const routeIdSchema = z.enum(ROUTE_IDS as [string, ...string[]])

export const assistantOutputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("reply"),
      text: z.string().min(1).max(5000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("retrieve"),
      name: retrieverNameSchema,
      args: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("navigate"),
      routeId: routeIdSchema,
      message: z.string().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("refusal"),
      reason: z.string().min(1).max(2000),
    })
    .strict(),
  /**
   * 17b — the AI can PROPOSE a write. The proposal is persisted as a
   * pending row and shown to the user; only `confirmWriteProposal`
   * (a separate human-initiated orgAction with `confirmed: z.literal(true)`)
   * actually invokes the underlying orgAction.
   *
   * NO `confirmed` field — the model cannot self-confirm. `.strict()`
   * rejects unknown keys (defense against a model that emits `confirmed: true`).
   */
  z
    .object({
      kind: z.literal("write_proposal"),
      action: z.string().min(1).max(120),
      input: z.record(z.string(), z.unknown()),
      summaryForUser: z.string().min(1).max(2000),
    })
    .strict(),
])

export type AssistantOutput = z.infer<typeof assistantOutputSchema>

// ─── ACTION INPUT SCHEMAS ─────────────────────────────────────────────

export const assistantTurnInput = z.object({
  conversationId: z.string().min(1).max(120),
  userMessage: z.string().min(1).max(2000),
})

export type AssistantTurnInput = z.infer<typeof assistantTurnInput>

/**
 * 17b — `confirmWriteProposal` input. Requires `confirmed: z.literal(true)`
 * with NO default. The user must explicitly affirm. Same posture as
 * `confirmAiWorkflowDraft` (module 16a).
 */
export const confirmWriteProposalInput = z.object({
  proposalId: z.string().min(1),
  confirmed: z.literal(true),
})

export const rejectWriteProposalInput = z.object({
  proposalId: z.string().min(1),
})
