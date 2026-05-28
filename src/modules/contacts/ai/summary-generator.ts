import "server-only"
import { callAiModel } from "@/lib/ai-model"
import { log } from "@/lib/log"
import type { ContactFacts } from "./lead-status-rules"
import type { ContactSlice } from "./lead-status-classifier"
import { HAIKU_MODEL } from "./lead-status-classifier"

/**
 * Push 3 (C6b CORRECTED) — Haiku-primary client summary generator.
 *
 * V1 job (per locked spec): produce a single short paragraph for the
 * Overview tab summary card. When real activity / event data exists,
 * the summary should convey:
 *   - whether this is a lead / client / vendor / referral partner
 *   - the project date they're inquiring about (from linked event /
 *     lead-form date)
 *   - whether they HAVE / HAVE NOT responded to outreach (when known)
 *   - whether the venue / referral source has prior referral history
 *     (when known)
 *   - project type + value (when known)
 *
 * The Haiku prompt incorporates whichever of those signals is
 * present and gracefully omits the rest. When no Anthropic key OR the
 * model errors, falls back to a deterministic template ("$type lead
 * inquiring about $date — $value.").
 *
 * Empty-contact path (zero activity AND zero events) is handled by
 * the caller (regenerate.ts) — it skips this function entirely and
 * uses `buildEmptyContactSummary` directly. That keeps cost at $0 for
 * the dummy-data state.
 */

const MAX_SUMMARY_CHARS = 800

export interface SummaryResult {
  text: string
  source: "haiku" | "fallback-template"
  modelUsed: string
  tokensUsed: number | null
  errorMessage: string | null
}

function buildSystemPrompt(): string {
  return [
    "You write a single brief paragraph (~2-4 sentences) summarizing a CRM contact for the Overview tab of their profile page.",
    "Plain language, US English, factual. No headings, no lists, no emojis.",
    "If a signal isn't in the input, do not mention it — never speculate.",
    "Focus on what would help the studio owner decide what to do next about this person.",
    `Hard cap: ${String(MAX_SUMMARY_CHARS)} characters.`,
    "Output: ONLY the paragraph text. No JSON, no markdown, no preamble.",
  ].join("\n")
}

function buildUserPrompt(facts: ContactFacts, slice: ContactSlice, status: string | null): string {
  const fullName = `${slice.firstName} ${slice.lastName}`.trim() || "(no name)"
  const signals: Record<string, unknown> = {
    name: fullName,
    contactType: slice.contactType,
    leadSource: slice.leadSource,
    tags: facts.tags,
    daysSinceCreated: facts.daysSinceCreated,
    daysSinceLastActivity: facts.daysSinceLastActivity,
    daysSinceLastInbound: facts.daysSinceLastInbound,
    activityCounts: {
      notes: facts.notesCount,
      calls: facts.callsCount,
      meetings: facts.meetingsCount,
      sms: facts.smsCount,
    },
    hasUpcomingMeeting: facts.hasUpcomingMeeting,
    referralsMade: facts.referralsMade,
    bookings: facts.bookingCount,
    notesPreview: slice.notes ? slice.notes.slice(0, 280) : null,
  }
  if (status) signals.classifiedStatus = status
  return ["Signals:", JSON.stringify(signals, null, 2), "", "Write the summary paragraph."].join(
    "\n",
  )
}

/**
 * Deterministic fallback template — used when Haiku is unavailable
 * or errors. Also used by tests to validate the empty-contact path
 * (see buildEmptyContactSummary below for the explicit zero-activity
 * floor).
 */
export function buildFallbackSummary(
  facts: ContactFacts,
  slice: ContactSlice,
  classifiedStatus: string | null,
): string {
  const fullName = `${slice.firstName} ${slice.lastName}`.trim() || "Contact"
  const parts: string[] = []
  if (classifiedStatus) {
    parts.push(`${fullName} is classified as ${classifiedStatus.toLowerCase()}.`)
  } else {
    parts.push(`${fullName} has no AI classification yet.`)
  }
  if (facts.bookingCount > 0) {
    parts.push(
      `${String(facts.bookingCount)} booking${facts.bookingCount === 1 ? "" : "s"} on record.`,
    )
  }
  if (facts.daysSinceLastActivity !== null) {
    parts.push(`Last activity ${String(facts.daysSinceLastActivity)} day(s) ago.`)
  } else if (facts.activityCount === 0) {
    parts.push("No activity recorded yet.")
  }
  if (facts.referralsMade > 0) {
    parts.push(`Has made ${String(facts.referralsMade)} referral(s).`)
  }
  return parts.join(" ").slice(0, MAX_SUMMARY_CHARS)
}

/**
 * Deterministic "new contact" floor. Caller invokes this when
 * isEmptyContact(facts) is true — NO AI call, no cost. Strings stay
 * close to HoneyBook's pattern but gracefully degrade when fields
 * aren't resolvable.
 *
 * Future-event signals (project date, event type, value) come from
 * the events / opportunities modules once those ship. For V1 the
 * contact's own fields (leadSource, contactType) are the only
 * available signals.
 */
export function buildEmptyContactSummary(slice: ContactSlice): { status: string; summary: string } {
  const ct = (slice.contactType ?? "").toLowerCase()
  const isLead = ct === "lead" || ct === "" // empty type still likely a lead
  if (isLead) {
    return {
      status: "New Lead",
      summary: slice.leadSource
        ? `New lead from ${slice.leadSource}. No activity logged yet.`
        : "New lead. No activity logged yet.",
    }
  }
  // Vendor / Past Client / Active Client / Referral Partner / Contractor
  // get a typed floor so the badge isn't generic.
  const typeWord = slice.contactType ?? "contact"
  return {
    status: `New ${typeWord}`,
    summary: `New ${typeWord.toLowerCase()}. No activity logged yet.`,
  }
}

/**
 * Generate the contact summary. NEVER throws — always returns a
 * SummaryResult, with `source` indicating Haiku vs fallback.
 *
 * Caller (regenerate.ts) is responsible for the empty-contact
 * short-circuit; this function assumes there's at least some signal
 * to summarize.
 */
export async function generateContactSummary(
  facts: ContactFacts,
  slice: ContactSlice,
  classifiedStatus: string | null,
): Promise<SummaryResult> {
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(facts, slice, classifiedStatus)
  try {
    const resp = await callAiModel({
      systemPrompt,
      userPrompt,
      model: HAIKU_MODEL,
      maxTokens: 600,
    })
    const text = resp.raw.trim().slice(0, MAX_SUMMARY_CHARS)
    if (!text) {
      log.warn({ feature: "contacts.summary" }, "summary empty — falling back to template")
      return {
        text: buildFallbackSummary(facts, slice, classifiedStatus),
        source: "fallback-template",
        modelUsed: "rules-engine@1",
        tokensUsed: null,
        errorMessage: "Haiku returned empty",
      }
    }
    return {
      text,
      source: "haiku",
      modelUsed: resp.modelName,
      tokensUsed: resp.tokensUsed,
      errorMessage: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.info({ feature: "contacts.summary", err: message }, "summary falling back to template")
    return {
      text: buildFallbackSummary(facts, slice, classifiedStatus),
      source: "fallback-template",
      modelUsed: "rules-engine@1",
      tokensUsed: null,
      errorMessage: message,
    }
  }
}
