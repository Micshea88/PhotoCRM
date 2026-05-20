import { z } from "zod"
import { ASSISTANT_RETRIEVER_NAMES } from "./retrievers"
import { ROUTE_IDS } from "./route-catalog"

/**
 * Model-output contract for Module 17a (READ + NAVIGATE only).
 *
 * MODULE 17a INTENTIONALLY HAS NO `write_proposal` variant. The
 * write surface lands in 17b. A model output of kind="write_proposal"
 * fails this schema's discriminated union — there is no syntactic
 * path from the AI to a write in 17a.
 *
 * Every variant uses `.strict()` so the model cannot smuggle unknown
 * fields (mirrors the ai-workflow-builder schema's defense).
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
])

export type AssistantOutput = z.infer<typeof assistantOutputSchema>

// ─── ACTION INPUT SCHEMAS ─────────────────────────────────────────────

export const assistantTurnInput = z.object({
  conversationId: z.string().min(1).max(120),
  userMessage: z.string().min(1).max(2000),
})

export type AssistantTurnInput = z.infer<typeof assistantTurnInput>
