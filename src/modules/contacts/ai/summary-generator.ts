import "server-only"
import { callAiModel } from "@/lib/ai-model"
import { log } from "@/lib/log"
import type { ActivityEntry } from "../ui/contact-activity-feed"
import type { ContactFacts } from "./lead-status-rules"
import type { ContactSlice } from "./lead-status-classifier"
import { HAIKU_MODEL } from "./lead-status-classifier"

/**
 * Push 3 (C6b CORRECTED + polish #5 Fix 9) — Haiku-primary client
 * summary generator.
 *
 * Polish #5 Fix 9 — the summary now reads recent ActivityEntry
 * bodies (notes / calls / meetings / sms) directly. Previously the
 * Haiku prompt only saw FACTS (counts, dates) plus the contact's own
 * `notes` column, so the model could never reference what was
 * discussed.
 *
 * Caps (defense-in-depth — enforced both at call site and in this
 * builder):
 *   - 10 most recent entries
 *   - 2000 chars of combined formatted body
 * Older entries truncated with "... and N more earlier entries."
 *
 * The natural-prose instruction block deliberately avoids
 * status-field phrasing ("is classified as ...", "Has made X
 * referral(s)."). Mike's spec: "Write the way a photographer would
 * brief themselves — not the way a database would render a status
 * field."
 *
 * Empty-contact path stays in the caller (regenerate.ts) — this
 * function assumes there's at least some signal to summarize.
 */

const MAX_SUMMARY_CHARS = 800
export const MAX_ACTIVITY_ENTRIES = 10
export const MAX_ACTIVITY_BODY_CHARS = 2000

export interface SummaryResult {
  text: string
  source: "haiku" | "fallback-template"
  modelUsed: string
  tokensUsed: number | null
  errorMessage: string | null
}

function buildSystemPrompt(): string {
  // Fix 9.2 — tightened. The Fix 9 prompt had 12+ DON'Ts and 5 style
  // bullets at 600 maxTokens; Haiku 4.5 was burning its output budget
  // on internal reasoning and returning empty text blocks (stop_reason
  // tells us if it was max_tokens or refusal). This version mirrors
  // the classifier's brevity — single paragraph of intent plus a
  // short style line, then the output contract.
  return [
    "You brief a photographer on a CRM contact in one short paragraph (~2-4 sentences) for their Overview tab.",
    "Draw from the recent activity (notes/calls/meetings/sms) as the primary source. Facts are background context.",
    "Style: natural prose. Open with the relationship or situation (e.g. 'Wedding lead — Jimmy and Janie...'), prefer first names, reference specifics (dates, venues, decisions). Skip absent facts. No status-field phrasing ('classified as', '1 referral(s)').",
    `Hard cap: ${String(MAX_SUMMARY_CHARS)} characters.`,
    "Output: ONLY the paragraph text. No JSON, no markdown, no preamble.",
  ].join("\n")
}

function relativeTime(t: Date, now: Date): string {
  const ms = now.getTime() - t.getTime()
  if (ms < 0) return "just now"
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${String(Math.max(minutes, 1))} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${String(days)} day${days === 1 ? "" : "s"} ago`
  return t.toISOString().slice(0, 10)
}

interface FormattedActivity {
  text: string
  /** Number of entries kept (after the 10-entry + 2000-char caps). */
  keptCount: number
  /** Number of entries dropped by the caps. */
  truncatedCount: number
}

/**
 * Render the activity block that goes into the Haiku user prompt.
 * Caps at MAX_ACTIVITY_ENTRIES entries OR MAX_ACTIVITY_BODY_CHARS
 * of combined formatted text — whichever hits first. Caller passes
 * entries already sorted DESC by timestamp.
 *
 * Exported so unit tests can validate the cap behavior without
 * hitting Haiku.
 */
export function formatActivityForPrompt(
  entries: ActivityEntry[],
  now: Date = new Date(),
): FormattedActivity {
  if (entries.length === 0) {
    return { text: "(none)", keptCount: 0, truncatedCount: 0 }
  }
  const lines: string[] = []
  let charCount = 0
  let i = 0
  for (; i < entries.length && i < MAX_ACTIVITY_ENTRIES; i++) {
    const e = entries[i]
    if (!e) break
    const actorPart = e.actor ? ` by ${e.actor}` : ""
    const when = relativeTime(e.timestamp, now)
    const kindLabel = e.kind.charAt(0).toUpperCase() + e.kind.slice(1)
    const body = (e.body ?? "").trim()
    // Use the loader's title when body is empty (e.g. "Call (outgoing)
    // · 5m" carries the duration + direction signal).
    const content = body || e.title
    const line = `[${kindLabel}${actorPart}, ${when}]: ${content}`
    if (charCount + line.length > MAX_ACTIVITY_BODY_CHARS && lines.length > 0) {
      break
    }
    lines.push(line)
    charCount += line.length + 1 // +1 for newline
  }
  const truncated = Math.max(0, entries.length - lines.length)
  if (truncated > 0) {
    lines.push(`... and ${String(truncated)} more earlier entries.`)
  }
  return {
    text: lines.join("\n"),
    keptCount: lines.length - (truncated > 0 ? 1 : 0),
    truncatedCount: truncated,
  }
}

function buildUserPrompt(
  facts: ContactFacts,
  slice: ContactSlice,
  status: string | null,
  recentActivity: ActivityEntry[],
): string {
  const fullName = `${slice.firstName} ${slice.lastName}`.trim() || "(no name)"
  // Build a "facts" block that ONLY includes non-zero / non-null
  // signals so the model isn't tempted to mention absences.
  const factsLines: string[] = []
  factsLines.push(`- Name: ${fullName}`)
  if (slice.contactType) factsLines.push(`- Type: ${slice.contactType}`)
  if (slice.leadSource) factsLines.push(`- Came from: ${slice.leadSource}`)
  if (facts.tags.length > 0) factsLines.push(`- Tags: ${facts.tags.join(", ")}`)
  if (facts.bookingCount > 0) {
    factsLines.push(`- Bookings: ${String(facts.bookingCount)}`)
  }
  if (facts.daysSinceLastActivity !== null && facts.daysSinceLastActivity > 0) {
    factsLines.push(`- Days since last activity: ${String(facts.daysSinceLastActivity)}`)
  }
  if (facts.hasUpcomingMeeting) factsLines.push("- Has an upcoming meeting scheduled")
  if (facts.referralsMade > 0) {
    factsLines.push(
      `- Outbound referrals: ${String(facts.referralsMade)} other contact${facts.referralsMade === 1 ? "" : "s"} were referred BY this person`,
    )
  }
  if (status) factsLines.push(`- Internal status: ${status}`)

  const activity = formatActivityForPrompt(recentActivity)
  return [
    "Facts:",
    factsLines.join("\n"),
    "",
    "Recent activity (most recent first):",
    activity.text,
    "",
    "Write the summary paragraph.",
  ].join("\n")
}

/**
 * Deterministic fallback template — used when Haiku is unavailable
 * or errors. Polish #5 Fix 9 rewrote it to prefer natural prose over
 * status-field phrasing. The template still degrades gracefully but
 * no longer surfaces "is classified as ..." / "Has made N
 * referral(s)." artifacts.
 */
export function buildFallbackSummary(
  facts: ContactFacts,
  slice: ContactSlice,
  classifiedStatus: string | null,
): string {
  const first = slice.firstName.trim() || "Contact"
  const ctype = (slice.contactType ?? "").toLowerCase()
  const leadIn = (() => {
    if (slice.contactType && slice.contactType !== "Lead") {
      return `${slice.contactType} contact — ${first}.`
    }
    if (slice.leadSource) return `Lead from ${slice.leadSource} — ${first}.`
    return `${first}.`
  })()
  const parts: string[] = [leadIn]
  if (facts.bookingCount > 0) {
    parts.push(
      facts.bookingCount === 1
        ? "One booking so far."
        : `${String(facts.bookingCount)} bookings so far.`,
    )
  }
  if (facts.daysSinceLastActivity !== null && facts.daysSinceLastActivity > 0) {
    parts.push(`Last touchpoint ${String(facts.daysSinceLastActivity)} days ago.`)
  } else if (facts.activityCount === 0 && ctype !== "vendor") {
    parts.push("No activity logged yet.")
  }
  if (facts.hasUpcomingMeeting) parts.push("Upcoming meeting on the calendar.")
  if (classifiedStatus && classifiedStatus !== "New Lead") {
    parts.push(`Current read: ${classifiedStatus.toLowerCase()}.`)
  }
  return parts.join(" ").slice(0, MAX_SUMMARY_CHARS)
}

/**
 * Deterministic "new contact" floor. Caller invokes this when
 * isEmptyContact(facts) is true — NO AI call, no cost.
 */
export function buildEmptyContactSummary(slice: ContactSlice): { status: string; summary: string } {
  const ct = (slice.contactType ?? "").toLowerCase()
  const isLead = ct === "lead" || ct === ""
  if (isLead) {
    return {
      status: "New Lead",
      summary: slice.leadSource
        ? `New lead from ${slice.leadSource}. No activity logged yet.`
        : "New lead. No activity logged yet.",
    }
  }
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
 * Polish #5 Fix 9 — `recentActivity` is REQUIRED. Pass an empty
 * array if there's none (the caller should have hit the empty-floor
 * path instead, but defensive ordering is cheap).
 */
export async function generateContactSummary(
  facts: ContactFacts,
  slice: ContactSlice,
  classifiedStatus: string | null,
  recentActivity: ActivityEntry[],
): Promise<SummaryResult> {
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(facts, slice, classifiedStatus, recentActivity)
  try {
    // Fix 9.2 — bumped maxTokens to 1200. The prior 600 was tight
    // when Haiku 4.5 chose to emit a thinking block: the wrapper
    // filters non-text blocks, leaving `raw` empty when the budget
    // was eaten by thinking. 1200 gives 4x headroom for the 800-char
    // paragraph output even with internal preamble.
    const first = await callAiModel({
      systemPrompt,
      userPrompt,
      model: HAIKU_MODEL,
      maxTokens: 1200,
    })
    const firstText = first.raw.trim().slice(0, MAX_SUMMARY_CHARS)
    if (firstText) {
      return {
        text: firstText,
        source: "haiku",
        modelUsed: first.modelName,
        tokensUsed: first.tokensUsed,
        errorMessage: null,
      }
    }

    // Fix 9.2 — retry path. Mirrors the classifier's structure: when
    // the first attempt returns empty (no text block, refusal, or
    // max-tokens cutoff before any text was emitted), retry once with
    // a stricter prompt. Log the diagnostic fields so prod logs name
    // the cause without re-shipping instrumentation.
    log.warn(
      {
        feature: "contacts.summary",
        stopReason: first.stopReason,
        contentBlockTypes: first.contentBlockTypes,
        tokensUsed: first.tokensUsed,
      },
      "summary first-pass empty — retrying with stricter prompt",
    )
    const retry = await callAiModel({
      systemPrompt:
        systemPrompt +
        "\n\nIMPORTANT: Your previous output was empty. Return ONLY the paragraph — no thinking, no preamble, no JSON, no markdown. Start writing the paragraph immediately on the next line.",
      userPrompt,
      model: HAIKU_MODEL,
      maxTokens: 1200,
    })
    const retryText = retry.raw.trim().slice(0, MAX_SUMMARY_CHARS)
    if (retryText) {
      return {
        text: retryText,
        source: "haiku",
        modelUsed: retry.modelName,
        tokensUsed: retry.tokensUsed,
        errorMessage: null,
      }
    }
    log.warn(
      {
        feature: "contacts.summary",
        stopReason: retry.stopReason,
        contentBlockTypes: retry.contentBlockTypes,
      },
      "summary retry also empty — falling back to template",
    )
    return {
      text: buildFallbackSummary(facts, slice, classifiedStatus),
      source: "fallback-template",
      modelUsed: "rules-engine@1",
      tokensUsed: null,
      errorMessage: `Haiku returned empty (stop_reason=${first.stopReason ?? "null"}, blocks=${first.contentBlockTypes.join(",")})`,
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
