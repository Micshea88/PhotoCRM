import "server-only"
import { callAiModel } from "@/lib/ai-model"
import { log } from "@/lib/log"
import { LEAD_STATUSES } from "./lead-status-enum"
import { fallbackClassifyFromRules, type ContactFacts } from "./lead-status-rules"

/**
 * Push 3 (C6b CORRECTED) — Haiku-primary lead-status classifier.
 *
 * Per memory #28 and the corrected design:
 *   - Rules compute FACTS ONLY.
 *   - Haiku reasons FREELY over those facts to produce a status in
 *     its own words. The 19-status enum is the FALLBACK vocabulary,
 *     not a hard constraint on AI output.
 *   - Deterministic `fallbackClassifyFromRules` runs when there's no
 *     ANTHROPIC_API_KEY, or when Haiku returns unparseable output
 *     after a stricter-prompt retry.
 *
 * Free-form means: Haiku can call a high-value engaged inquiry
 * "Premium hot lead — destination wedding" rather than forcing it into
 * "Hot Lead". Trade-off: list filters keyed on the 19 enum miss the
 * free-form values; the badge shows them verbatim. V1 testing mode —
 * we'll see what the model produces and iterate.
 */

export const HAIKU_MODEL = "claude-haiku-4-5-20251001"
const MAX_STATUS_CHARS = 80
const MAX_REASONING_CHARS = 400

export interface ClassifierResult {
  /** Free-form, capped at 80 chars. Never empty (falls back if model
   *  returns empty or unparseable output). */
  status: string
  /** Why-this-status, capped at 400 chars. */
  reasoning: string
  /** "haiku" when AI succeeded; "fallback-rules" when deterministic. */
  source: "haiku" | "fallback-rules"
  /** The model id used (Haiku model string OR "rules-engine@1"). */
  modelUsed: string
  /** Token usage from Anthropic when available. */
  tokensUsed: number | null
  /** Populated on AI errors / parse failures even when we fell back. */
  errorMessage: string | null
}

interface ContactSlice {
  firstName: string
  lastName: string
  primaryEmail: string | null
  primaryPhone: string | null
  contactType: string | null
  lifecycleStatus: string | null
  leadSource: string | null
  tags: string[]
  notes: string | null
}

function buildSystemPrompt(): string {
  return [
    "You classify a single CRM contact into a brief lead/client status.",
    "You receive structured FACTS computed by the host system + light contact context.",
    "Return JSON with exactly two string keys: status, reasoning.",
    "",
    "Guidelines:",
    "- Be specific and useful. If signal is rich, name the status precisely (e.g. 'Premium hot lead', 'At-risk repeat client', 'Engaged referral partner').",
    "- If signal is thin, pick a clear, accurate label (e.g. 'New lead', 'Active vendor', 'Past client').",
    "- status is free-form text, max 80 chars. Avoid jargon. Title Case preferred.",
    "- reasoning is one short sentence, max ~400 chars, citing the strongest signal(s).",
    "- A reference list of common statuses (use whatever fits best — not required to pick from this list):",
    `  ${LEAD_STATUSES.join(", ")}.`,
    "",
    'Output format: ONLY a single JSON object: {"status":"...","reasoning":"..."}',
    "No prose, no markdown, no commentary.",
  ].join("\n")
}

function buildUserPrompt(facts: ContactFacts, slice: ContactSlice): string {
  const factsBlock = JSON.stringify(
    {
      contactType: facts.contactType,
      lifecycleStatus: facts.lifecycleStatus,
      tags: facts.tags,
      daysSinceCreated: facts.daysSinceCreated,
      daysSinceLastActivity: facts.daysSinceLastActivity,
      daysSinceLastInbound: facts.daysSinceLastInbound,
      activityCounts: {
        notes: facts.notesCount,
        calls: facts.callsCount,
        meetings: facts.meetingsCount,
        sms: facts.smsCount,
        total: facts.activityCount,
      },
      hasUpcomingMeeting: facts.hasUpcomingMeeting,
      referralsMade: facts.referralsMade,
      bookings: facts.bookingCount,
      highestProposalValueCents: facts.highestProposalValue,
    },
    null,
    2,
  )
  const contextBlock = JSON.stringify(
    {
      name: `${slice.firstName} ${slice.lastName}`.trim(),
      primaryEmail: slice.primaryEmail,
      primaryPhone: slice.primaryPhone ? "[present]" : null,
      leadSource: slice.leadSource,
      // Notes get truncated — the model gets a flavor, not the wall.
      notesPreview: slice.notes ? slice.notes.slice(0, 280) : null,
    },
    null,
    2,
  )
  return [
    "FACTS:",
    factsBlock,
    "",
    "CONTACT_CONTEXT:",
    contextBlock,
    "",
    'Return: {"status":"...","reasoning":"..."}',
  ].join("\n")
}

interface ParsedResponse {
  status: string
  reasoning: string
}

function tryParseClassifierJson(raw: string): ParsedResponse | null {
  const trimmed = raw.trim()
  // Tolerate accidental code-fence wrappers.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  try {
    const parsed = JSON.parse(stripped) as unknown
    if (
      parsed &&
      typeof parsed === "object" &&
      "status" in parsed &&
      "reasoning" in parsed &&
      typeof (parsed as { status: unknown }).status === "string" &&
      typeof (parsed as { reasoning: unknown }).reasoning === "string"
    ) {
      const status = (parsed as { status: string }).status.trim()
      const reasoning = (parsed as { reasoning: string }).reasoning.trim()
      if (!status) return null
      return {
        status: status.slice(0, MAX_STATUS_CHARS),
        reasoning: reasoning.slice(0, MAX_REASONING_CHARS),
      }
    }
  } catch {
    // fall through to null
  }
  return null
}

/**
 * Classify a contact's lead status. Caller passes precomputed facts +
 * a small contact slice. NEVER throws — always returns a result, with
 * `source` indicating which path won.
 */
export async function classifyLeadStatus(
  facts: ContactFacts,
  slice: ContactSlice,
): Promise<ClassifierResult> {
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(facts, slice)

  // First attempt — vanilla prompt.
  try {
    const first = await callAiModel({
      systemPrompt,
      userPrompt,
      model: HAIKU_MODEL,
      maxTokens: 400,
    })
    const parsed = tryParseClassifierJson(first.raw)
    if (parsed) {
      return {
        status: parsed.status,
        reasoning: parsed.reasoning,
        source: "haiku",
        modelUsed: first.modelName,
        tokensUsed: first.tokensUsed,
        errorMessage: null,
      }
    }

    // Retry with stricter prompt before falling back. Cheap second
    // call when the first wasn't JSON.
    log.warn(
      { feature: "contacts.classifier", raw: first.raw.slice(0, 200) },
      "classifier first-pass unparseable, retrying with stricter prompt",
    )
    const stricter = await callAiModel({
      systemPrompt:
        systemPrompt +
        '\n\nIMPORTANT: Your previous output was not valid JSON. Return ONLY a JSON object of the form {"status":"...","reasoning":"..."}. Do not include any prose, code fences, or explanation.',
      userPrompt,
      model: HAIKU_MODEL,
      maxTokens: 400,
    })
    const retryParsed = tryParseClassifierJson(stricter.raw)
    if (retryParsed) {
      return {
        status: retryParsed.status,
        reasoning: retryParsed.reasoning,
        source: "haiku",
        modelUsed: stricter.modelName,
        tokensUsed: stricter.tokensUsed,
        errorMessage: null,
      }
    }

    log.warn(
      { feature: "contacts.classifier" },
      "classifier retry also unparseable — falling back to rules",
    )
    const fb = fallbackClassifyFromRules(facts)
    return {
      status: fb.status,
      reasoning: fb.reasoning,
      source: "fallback-rules",
      modelUsed: "rules-engine@1",
      tokensUsed: null,
      errorMessage: "Haiku output unparseable after retry",
    }
  } catch (err) {
    // No API key OR Anthropic API error.
    const message = err instanceof Error ? err.message : String(err)
    log.info({ feature: "contacts.classifier", err: message }, "classifier falling back to rules")
    const fb = fallbackClassifyFromRules(facts)
    return {
      status: fb.status,
      reasoning: fb.reasoning,
      source: "fallback-rules",
      modelUsed: "rules-engine@1",
      tokensUsed: null,
      errorMessage: message,
    }
  }
}

// Re-export type for consumers — keeps the import surface small.
export type { ContactSlice }
