"use server"

import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { runRegeneratePipeline, type RegeneratePipelineResult } from "./regenerate-pipeline"
import type { AiInsight } from "./insights-detector"

/**
 * Push 3 (C6b CORRECTED) — regenerate AI cache for a contact.
 *
 * Polish #5 Fix 8 — the pipeline body lives in `regenerate-pipeline.ts`
 * so the contact detail page can call it inline (auto-regen when
 * cache is null). This file is the thin orgAction wrapper.
 *
 * Pipeline order is locked (see pipeline module):
 *   1. computeContactFacts (DB query — facts only, no classification)
 *   2. empty-floor check → skip AI, write deterministic floor
 *   3. classifyLeadStatus (Haiku-primary, free-form output)
 *   4. generateContactSummary (Haiku-primary, template fallback)
 *   5. detectInsights (deterministic, unchanged)
 *   6. recordAiUsage rows for each AI call
 *   7. write ai_* cache + audit
 *
 * NEVER throws on AI failures — graceful degradation to the fallback
 * vocabulary at every step.
 */

const regenerateInput = z.object({
  contactId: z.string().min(1),
})

export interface RegenerateAiResult {
  aiLeadStatus: string
  aiLeadStatusReasoning: string
  aiSummaryText: string
  aiInsights: AiInsight[]
  aiGeneratedAt: string
  aiGenerationModel: string
  trace: RegeneratePipelineResult["trace"]
}

export const regenerateContactAi = orgAction
  .metadata({ actionName: "contacts.ai.regenerate" })
  .inputSchema(regenerateInput)
  .action(async ({ parsedInput, ctx }): Promise<RegenerateAiResult> => {
    try {
      const result = await runRegeneratePipeline(
        ctx.db,
        {
          organizationId: ctx.activeOrg.id,
          userId: ctx.session.user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        parsedInput.contactId,
      )
      return {
        aiLeadStatus: result.aiLeadStatus,
        aiLeadStatusReasoning: result.aiLeadStatusReasoning,
        aiSummaryText: result.aiSummaryText,
        aiInsights: result.aiInsights,
        aiGeneratedAt: result.aiGeneratedAt.toISOString(),
        aiGenerationModel: result.aiGenerationModel,
        trace: result.trace,
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Contact not found") {
        throw new ActionError("NOT_FOUND", "Contact not found")
      }
      throw err
    }
  })
