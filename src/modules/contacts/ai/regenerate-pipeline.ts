import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { audit } from "@/modules/audit/audit"
import type * as schema from "@/db/schema"
import { contacts } from "../schema"
import { loadContactActivityWithDb } from "../activity-loader"
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
 * Push 3 (C6c polish #5 Fix 8) — extracted pipeline body so it can
 * be invoked from BOTH:
 *
 *   1. The orgAction `regenerateContactAi` (manual Regenerate button)
 *   2. The contact-detail page server component (auto-regen when
 *      cache is null, e.g. after a note/call invalidated it)
 *
 * Same locked sequence as `regenerate.ts` (computeContactFacts →
 * empty-floor short-circuit → classifier → summary → insights →
 * usage log → cache update → audit), now with the surrounding
 * orgAction concerns stripped out so the page can supply its own
 * tx handle from `withOrgContext`.
 */

type DbHandle = NodePgDatabase<typeof schema>

export interface RegeneratePipelineCtx {
  organizationId: string
  /** Triggering user — actor for audit + ai_usage_log. The contact
   *  row's `updated_by` also picks this up. */
  userId: string
  ipAddress: string | null
  userAgent: string | null
}

export interface RegeneratePipelineResult {
  aiLeadStatus: string
  aiLeadStatusReasoning: string
  aiSummaryText: string
  aiInsights: AiInsight[]
  aiGeneratedAt: Date
  aiGenerationModel: string
  trace: {
    floor: boolean
    classifier: "haiku" | "fallback-rules" | "skipped-empty-floor"
    summary: "haiku" | "fallback-template" | "skipped-empty-floor"
  }
}

const FLOOR_MODEL = "deterministic-floor@1"

/**
 * Run the AI regenerate pipeline for a single contact. Throws if the
 * contact doesn't exist in the active org. Writes the AI cache
 * columns + an audit row. Returns the resolved values so callers can
 * render without a re-read.
 *
 * Caller is responsible for org-context (RLS): the tx handle must
 * have `app.current_org` set (orgAction wrappers do this; page
 * callers should wrap in `withOrgContext`).
 *
 * Does NOT call `revalidatePath`. The orgAction wrapper handles
 * cache invalidation for the manual-Regenerate path; the page-
 * autoregen path is already rendering, so revalidation would loop.
 */
export async function runRegeneratePipeline(
  db: DbHandle,
  ctx: RegeneratePipelineCtx,
  contactId: string,
): Promise<RegeneratePipelineResult> {
  const [row] = await db
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
        eq(contacts.id, contactId),
        eq(contacts.organizationId, ctx.organizationId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1)
  if (!row) throw new Error("Contact not found")

  const facts = await computeContactFacts(db, ctx.organizationId, row.id)
  if (!facts) throw new Error("Contact not found")

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
  let trace: RegeneratePipelineResult["trace"]

  if (isEmptyContact(facts)) {
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
    // P3 polish #5 Fix 9 — load recent activity bodies for the
    // summary prompt. Same tx as the pipeline so we see any
    // just-committed activity (e.g. after a note insert through
    // createContactNote nulled the cache).
    const recentActivity = await loadContactActivityWithDb(db, ctx.organizationId, row.id)
    summary = await generateContactSummary(facts, slice, classifier.status, recentActivity)
    trace = {
      floor: false,
      classifier: classifier.source,
      summary: summary.source,
    }
    await recordAiUsage(db, {
      organizationId: ctx.organizationId,
      feature: "contacts.classifier",
      model: classifier.modelUsed,
      contactId: row.id,
      tokensUsed: classifier.tokensUsed,
      ok: classifier.source === "haiku",
      errorMessage: classifier.errorMessage,
      triggeredByUserId: ctx.userId,
    })
    await recordAiUsage(db, {
      organizationId: ctx.organizationId,
      feature: "contacts.summary",
      model: summary.modelUsed,
      contactId: row.id,
      tokensUsed: summary.tokensUsed,
      ok: summary.source === "haiku",
      errorMessage: summary.errorMessage,
      triggeredByUserId: ctx.userId,
    })
  }

  const insightFacts: InsightFacts = {
    contactId: row.id,
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

  await db
    .update(contacts)
    .set({
      aiLeadStatus: classifier.status,
      aiLeadStatusReasoning: classifier.reasoning,
      aiSummaryText: summary.text,
      aiInsightsJson: { insights, version: 1 },
      aiGeneratedAt: generatedAt,
      aiGenerationModel: classifier.modelUsed,
      updatedAt: generatedAt,
      updatedBy: ctx.userId,
    })
    .where(and(eq(contacts.id, row.id), eq(contacts.organizationId, ctx.organizationId)))

  await audit(
    {
      db,
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
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
    aiGeneratedAt: generatedAt,
    aiGenerationModel: classifier.modelUsed,
    trace,
  }
}
