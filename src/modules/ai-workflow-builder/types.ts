import { z } from "zod"
import {
  triggerTypeSchema,
  actionTypeSchema,
  branchConditionSchema,
} from "@/modules/workflows/types"

/**
 * THE MODEL-OUTPUT CONTRACT.
 *
 * The model is required to emit JSON matching one of two shapes:
 *
 *   1. { result: "draft", name, description?, triggerType, triggerConfig?, steps: [...] }
 *   2. { result: "refusal", reason }
 *
 * The "result" discriminator is required — the model must explicitly
 * pick one. There is no third path. A model output that doesn't match
 * EITHER shape is rejected by Zod's discriminated-union exhaustion.
 *
 * IMPORTANT: this schema validates the SHAPE only. The per-step
 * actionConfig is validated SEPARATELY by `validate.ts` using the
 * CANONICAL `actionConfigSchema` from `src/modules/workflows/types.ts`
 * — the IDENTICAL schema used by manual workflow creation. This is
 * how Hard Constraint #1 is enforced: there is no AI-specific
 * config-validation path.
 */

const stepShape = z
  .object({
    actionType: actionTypeSchema,
    // actionConfig is loose at this layer; per-step deep validation
    // happens in validate.ts via actionConfigSchema (the canonical one).
    actionConfig: z.record(z.string(), z.unknown()).nullable().optional(),
    branchCondition: branchConditionSchema.optional(),
  })
  .strict()

export const modelOutputSchema = z.discriminatedUnion("result", [
  z
    .object({
      result: z.literal("draft"),
      name: z.string().min(1).max(300),
      description: z.string().max(10000).optional(),
      triggerType: triggerTypeSchema,
      triggerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
      // NOTE: NO `enabled` field. Hard Constraint #2 — AI-generated
      // workflows ALWAYS land enabled=false. The confirm action hard-codes
      // it; the model has no syntactic path to set it. `.strict()` below
      // rejects any unknown key (including a model-emitted `enabled`).
      steps: z.array(stepShape).min(1).max(20),
    })
    .strict(),
  z
    .object({
      result: z.literal("refusal"),
      reason: z.string().min(1).max(2000),
    })
    .strict(),
])

export type ModelOutput = z.infer<typeof modelOutputSchema>

// ─── ACTION INPUT SCHEMAS ─────────────────────────────────────────────

export const draftWorkflowFromPromptInput = z.object({
  prompt: z.string().min(1).max(2000),
})

export const confirmAiWorkflowDraftInput = z.object({
  draftId: z.string().min(1),
  /**
   * MUST be exactly `true` to confirm. There is no default. The user
   * explicitly affirms before any workflow row is created.
   */
  confirmed: z.literal(true),
})

export const discardAiWorkflowDraftInput = z.object({
  draftId: z.string().min(1),
})

export type DraftWorkflowFromPromptInput = z.infer<typeof draftWorkflowFromPromptInput>
export type ConfirmAiWorkflowDraftInput = z.infer<typeof confirmAiWorkflowDraftInput>
