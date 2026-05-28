"use server"

import { z } from "zod"
import { eq, and, isNull } from "drizzle-orm"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { contacts } from "../schema"
import { computeContactFacts, isEmptyContact } from "./lead-status-rules"
import {
  classifyLeadStatus,
  type ContactSlice,
  type ClassifierResult,
} from "./lead-status-classifier"
import {
  generateContactSummary,
  buildEmptyContactSummary,
  type SummaryResult,
} from "./summary-generator"
import { detectInsights, type AiInsight, type InsightFacts } from "./insights-detector"
import { recordAiUsage } from "./usage-tracker"

/**
 * Push 3 (C6b CORRECTED) — regenerate AI cache for a contact.
 *
 * Pipeline (locked by spec point 9):
 *   1. computeContactFacts (DB query — facts only, no classification)
 *   2. empty-floor check (isEmptyContact) → if YES: skip AI, write
 *      deterministic floor status + summary
 *   3. classifyLeadStatus (Haiku-primary, free-form output;
 *      fallbackClassifyFromRules when AI unavailable / unparseable)
 *   4. generateContactSummary (Haiku-primary, deterministic template
 *      fallback)
 *   5. detectInsights (deterministic, unchanged from earlier)
 *   6. recordAiUsage rows for each AI call (success + fallback)
 *   7. write ai_* cache + audit + revalidate
 *
 * NEVER throws on AI failures — graceful degradation to the fallback
 * vocabulary at every step. The action returns the persisted values
 * so the detail page renders without a re-read.
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
  /** Diagnostic: which path won at each step. Useful in tests + the
   *  detail page's debug overlay. Not persisted to the DB. */
  trace: {
    floor: boolean
    classifier: "haiku" | "fallback-rules" | "skipped-empty-floor"
    summary: "haiku" | "fallback-template" | "skipped-empty-floor"
  }
}

const FLOOR_MODEL = "deterministic-floor@1"

export const regenerateContactAi = orgAction
  .metadata({ actionName: "contacts.ai.regenerate" })
  .inputSchema(regenerateInput)
  .action(async ({ parsedInput, ctx }): Promise<RegenerateAiResult> => {
    // Fetch the contact slice the AI prompts need + the row that we'll
    // write the cache columns onto.
    const [row] = await ctx.db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        primaryEmail: contacts.primaryEmail,
        primaryPhone: contacts.primaryPhone,
        contactType: contacts.contactType,
        lifecycleStatus: contacts.lifecycleStatus,
        leadSource: contacts.leadSource,
        tags: contacts.tags,
        notes: contacts.notes,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, parsedInput.contactId),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1)
    if (!row) throw new ActionError("NOT_FOUND", "Contact not found")

    const facts = await computeContactFacts(ctx.db, ctx.activeOrg.id, row.id)
    if (!facts) throw new ActionError("NOT_FOUND", "Contact not found")

    const slice: ContactSlice = {
      firstName: row.firstName,
      lastName: row.lastName,
      primaryEmail: row.primaryEmail,
      primaryPhone: row.primaryPhone,
      contactType: row.contactType,
      lifecycleStatus: row.lifecycleStatus,
      leadSource: row.leadSource,
      tags: row.tags ?? [],
      notes: row.notes,
    }

    let classifier: ClassifierResult
    let summary: SummaryResult
    let floor = false
    let trace: RegenerateAiResult["trace"]

    if (isEmptyContact(facts)) {
      // Spec point 5 — deterministic floor for empty contacts.
      // No Haiku call, no cost.
      floor = true
      const floorOut = buildEmptyContactSummary(slice)
      classifier = {
        status: floorOut.status,
        reasoning: "New contact — no activity yet.",
        source: "fallback-rules",
        modelUsed: FLOOR_MODEL,
        tokensUsed: null,
        errorMessage: null,
      }
      summary = {
        text: floorOut.summary,
        source: "fallback-template",
        modelUsed: FLOOR_MODEL,
        tokensUsed: null,
        errorMessage: null,
      }
      trace = {
        floor: true,
        classifier: "skipped-empty-floor",
        summary: "skipped-empty-floor",
      }
    } else {
      classifier = await classifyLeadStatus(facts, slice)
      summary = await generateContactSummary(facts, slice, classifier.status)
      trace = {
        floor: false,
        classifier: classifier.source,
        summary: summary.source,
      }
      // Telemetry rows — one per AI call attempt. Includes fallbacks
      // (ok=false rows cost no money but reveal config drift).
      await recordAiUsage(ctx.db, {
        organizationId: ctx.activeOrg.id,
        feature: "contacts.classifier",
        model: classifier.modelUsed,
        contactId: row.id,
        tokensUsed: classifier.tokensUsed,
        ok: classifier.source === "haiku",
        errorMessage: classifier.errorMessage,
        triggeredByUserId: ctx.session.user.id,
      })
      await recordAiUsage(ctx.db, {
        organizationId: ctx.activeOrg.id,
        feature: "contacts.summary",
        model: summary.modelUsed,
        contactId: row.id,
        tokensUsed: summary.tokensUsed,
        ok: summary.source === "haiku",
        errorMessage: summary.errorMessage,
        triggeredByUserId: ctx.session.user.id,
      })
    }

    // Insights are deterministic regardless of floor / AI status.
    const insightFacts: InsightFacts = {
      contactId: row.id,
      // Coerce free-form status to LeadStatus | null for the rules engine:
      // the insights detector only branches on a few canonical strings
      // ("Cold Lead" / "Unresponsive Lead"). Free-form Haiku output that
      // doesn't match still gets the empty-rule branches.
      aiLeadStatus:
        classifier.status === "Cold Lead" || classifier.status === "Unresponsive Lead"
          ? classifier.status
          : null,
      tags: facts.tags,
      bookingCount: facts.bookingCount,
      highestProposalValue: facts.highestProposalValue,
      orgAvgProposalValue: 0,
      daysSinceLastContact: facts.daysSinceLastActivity,
      referralsMade: facts.referralsMade,
      referralsWhoBooked: 0,
    }
    const insights = detectInsights(insightFacts)
    const generatedAt = new Date()

    await ctx.db
      .update(contacts)
      .set({
        aiLeadStatus: classifier.status,
        aiLeadStatusReasoning: classifier.reasoning,
        aiSummaryText: summary.text,
        aiInsightsJson: { insights, version: 1 },
        aiGeneratedAt: generatedAt,
        aiGenerationModel: classifier.modelUsed,
        updatedAt: generatedAt,
        updatedBy: ctx.session.user.id,
      })
      .where(and(eq(contacts.id, row.id), eq(contacts.organizationId, ctx.activeOrg.id)))

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "contacts.ai.regenerated",
      {
        resourceType: "contact",
        resourceId: row.id,
        metadata: {
          status: classifier.status,
          model: classifier.modelUsed,
          floor,
          classifierSource: classifier.source,
          summarySource: summary.source,
          insightCount: insights.length,
        },
      },
    )

    return {
      aiLeadStatus: classifier.status,
      aiLeadStatusReasoning: classifier.reasoning,
      aiSummaryText: summary.text,
      aiInsights: insights,
      aiGeneratedAt: generatedAt.toISOString(),
      aiGenerationModel: classifier.modelUsed,
      trace,
    }
  })
