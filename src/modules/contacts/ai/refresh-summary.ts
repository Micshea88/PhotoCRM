"use server"

import { z } from "zod"
import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { orgAction } from "@/lib/safe-action"
import { contacts } from "../schema"
import { runRegeneratePipeline } from "./regenerate-pipeline"
import { isSummaryStale } from "./summary-freshness"
import type { AiInsight } from "./insights-detector"

/**
 * AI-summary freshness refresh — the client calls this on contact-page mount
 * and on a 1-hour interval while the page is open. It self-gates so the client
 * can call it freely:
 *
 *   1. Compute `needsRefresh`:
 *        - cache never generated (ai_generated_at IS NULL), OR
 *        - activity newer than the summary (last_activity_at > ai_generated_at), OR
 *        - 1 hour elapsed since the summary was generated.
 *      If none hold → return `unchanged` (no Haiku).
 *   2. Throttle (race protection): atomic compare-and-set on
 *      `ai_last_regen_attempt_at` with a 1-minute window. Two simultaneous
 *      page loads → only one wins the claim; the other returns `throttled`.
 *   3. Winner runs the existing regenerate pipeline (empty-floor gate + Haiku)
 *      and returns the fresh values for the client to swap in place.
 *
 * No revalidatePath — the client swaps via state, deliberately NOT re-rendering
 * the rest of the contact page (no flash).
 */

const refreshInput = z.object({ contactId: z.string().min(1) })

export type RefreshSummaryResult =
  | {
      status: "updated"
      aiSummaryText: string
      aiGeneratedAt: string
      aiLeadStatus: string
      aiLeadStatusReasoning: string
      aiInsights: AiInsight[]
      aiGenerationModel: string
    }
  | { status: "unchanged" }
  | { status: "throttled" }

export const refreshContactAiSummary = orgAction
  .metadata({ actionName: "contacts.ai.refresh_summary" })
  .inputSchema(refreshInput)
  .action(async ({ parsedInput, ctx }): Promise<RefreshSummaryResult> => {
    const orgId = ctx.activeOrg.id
    const { contactId } = parsedInput

    // 1. Freshness check (cheap read).
    const [row] = await ctx.db
      .select({
        aiGeneratedAt: contacts.aiGeneratedAt,
        lastActivityAt: contacts.lastActivityAt,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.organizationId, orgId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1)
    if (!row) return { status: "unchanged" } // contact gone — nothing to do

    if (!isSummaryStale(row.aiGeneratedAt, row.lastActivityAt)) return { status: "unchanged" }

    // 2. Throttle: atomic claim on ai_last_regen_attempt_at (1-minute window).
    //    0 rows back = another page load already claimed the slot this minute.
    const claim = await ctx.db
      .update(contacts)
      .set({ aiLastRegenAttemptAt: sql`now()` })
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.organizationId, orgId),
          isNull(contacts.deletedAt),
          or(
            isNull(contacts.aiLastRegenAttemptAt),
            lt(contacts.aiLastRegenAttemptAt, sql`now() - interval '1 minute'`),
          ),
        ),
      )
      .returning({ id: contacts.id })
    if (claim.length === 0) return { status: "throttled" }

    // 3. Regenerate (reuses the locked pipeline: empty-floor gate → Haiku).
    const result = await runRegeneratePipeline(
      ctx.db,
      {
        organizationId: orgId,
        userId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      contactId,
    )
    return {
      status: "updated",
      aiSummaryText: result.aiSummaryText,
      aiGeneratedAt: result.aiGeneratedAt.toISOString(),
      aiLeadStatus: result.aiLeadStatus,
      aiLeadStatusReasoning: result.aiLeadStatusReasoning,
      aiInsights: result.aiInsights,
      aiGenerationModel: result.aiGenerationModel,
    }
  })
