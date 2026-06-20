/**
 * Push 3 (C6b CORRECTED) — Haiku summary generator + empty-floor unit tests.
 *
 * Covers:
 *   - Haiku success path returns the model's text
 *   - Haiku error → falls back to deterministic template
 *   - Haiku empty output → falls back to deterministic template
 *   - buildEmptyContactSummary: deterministic, no AI call, "New Lead"
 *     vs "New <Type>" branching
 *   - The summary prompt receives activity counts + classified status
 *     when supplied
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface AiCall {
  systemPrompt: string
  userPrompt: string
  model: string | undefined
}
interface AiResult {
  raw: string
  modelName: string
  tokensUsed: number | null
  /** Fix 9.2 — optional in old test fixtures; the new tests set them. */
  stopReason?: string | null
  contentBlockTypes?: string[]
}
const aiCalls: AiCall[] = []
const aiQueue: (AiResult | Error)[] = []

// log.ts reads env at module-load — server-only, breaks in jsdom.
vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/ai-model", () => ({
  callAiModel: vi.fn((args: { systemPrompt: string; userPrompt: string; model?: string }) => {
    aiCalls.push({
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt,
      model: args.model,
    })
    return Promise.resolve().then(() => {
      const next = aiQueue.shift()
      if (!next) throw new Error("aiQueue exhausted")
      if (next instanceof Error) throw next
      // Fix 9.2 — back-compat shim. Older fixtures don't set
      // stopReason/contentBlockTypes; default them so the production
      // code's destructure doesn't fail.
      return {
        ...next,
        stopReason: next.stopReason ?? "end_turn",
        contentBlockTypes: next.contentBlockTypes ?? ["text"],
      }
    })
  }),
}))

import {
  generateContactSummary,
  buildEmptyContactSummary,
  buildFallbackSummary,
  formatActivityForPrompt,
  formatOpenTasksForPrompt,
  MAX_ACTIVITY_ENTRIES,
  MAX_ACTIVITY_BODY_CHARS,
} from "@/modules/contacts/ai/summary-generator"
import type { ContactFacts } from "@/modules/contacts/ai/lead-status-rules"
import type { ContactSlice } from "@/modules/contacts/ai/lead-status-classifier"
import type { ActivityEntry } from "@/modules/contacts/ui/contact-activity-feed"

const ACTIVITY_EMPTY: ActivityEntry[] = []
function note(body: string, ageHours = 1, actor: string | null = "Mike"): ActivityEntry {
  return {
    id: `n-${body.slice(0, 8)}`,
    kind: "note",
    timestamp: new Date(Date.now() - ageHours * 60 * 60 * 1000),
    title: "Note added",
    body,
    actor,
  }
}

function facts(): ContactFacts {
  return {
    contactType: "Lead",
    lifecycleStatus: null,
    tags: ["wedding"],
    activityCount: 3,
    notesCount: 1,
    callsCount: 1,
    meetingsCount: 1,
    smsCount: 0,
    daysSinceCreated: 10,
    daysSinceLastActivity: 2,
    daysSinceLastInbound: null,
    hasUpcomingMeeting: true,
    referralsMade: 0,
    bookingCount: 0,
    highestProposalValue: 0,
    openTasks: [],
  }
}

function slice(): ContactSlice {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    primaryEmail: "ada@example.com",
    primaryPhone: null,
    contactType: "Lead",
    lifecycleStatus: null,
    leadSource: "Instagram",
    tags: ["wedding"],
    notes: "Inquired about August wedding",
  }
}

beforeEach(() => {
  aiCalls.length = 0
  aiQueue.length = 0
})

describe("generateContactSummary — Haiku success", () => {
  it("returns the model text on success", async () => {
    aiQueue.push({
      raw: "Ada is a hot lead from Instagram inquiring about an August wedding.",
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 90,
    })
    const r = await generateContactSummary(facts(), slice(), "Hot Lead", ACTIVITY_EMPTY)
    expect(r.source).toBe("haiku")
    expect(r.text).toContain("hot lead from Instagram")
    expect(r.tokensUsed).toBe(90)
  })

  it("prompt threads recent activity content (not just counts)", async () => {
    aiQueue.push({
      raw: "ok",
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 1,
    })
    await generateContactSummary(facts(), slice(), "Hot Lead", [
      note("Jimmy and Janie agreed we should be their photographer.", 2),
    ])
    const prompt = aiCalls[0]?.userPrompt ?? ""
    expect(prompt).toContain("Recent activity")
    expect(prompt).toContain("Jimmy and Janie")
    expect(prompt).toContain("Hot Lead")
    expect(prompt).toContain("Instagram")
  })

  it("uses the Haiku model id", async () => {
    aiQueue.push({ raw: "ok", modelName: "claude-haiku-4-5-20251001", tokensUsed: 1 })
    await generateContactSummary(facts(), slice(), null, ACTIVITY_EMPTY)
    expect(aiCalls[0]?.model).toBe("claude-haiku-4-5-20251001")
  })
})

describe("generateContactSummary — fallback paths", () => {
  it("Haiku error → falls back to deterministic template", async () => {
    aiQueue.push(new Error("AI Workflow Builder is not configured."))
    const r = await generateContactSummary(facts(), slice(), "Hot Lead", ACTIVITY_EMPTY)
    expect(r.source).toBe("fallback-template")
    expect(r.modelUsed).toBe("rules-engine@1")
    // Polish #5 Fix 9 — fallback no longer surfaces "is classified as ...";
    // it leads with the relationship line.
    expect(r.text).toContain("Lead from Instagram")
    expect(r.text).not.toMatch(/is classified as/i)
  })

  it("Haiku returns empty string → falls back to deterministic template", async () => {
    aiQueue.push({ raw: "   ", modelName: "claude-haiku-4-5-20251001", tokensUsed: 1 })
    const r = await generateContactSummary(facts(), slice(), null, ACTIVITY_EMPTY)
    expect(r.source).toBe("fallback-template")
  })
})

describe("Polish #5 Fix 9 — activity formatter caps", () => {
  it("returns '(none)' for empty activity", () => {
    const r = formatActivityForPrompt([])
    expect(r.text).toBe("(none)")
    expect(r.keptCount).toBe(0)
    expect(r.truncatedCount).toBe(0)
  })

  it("keeps all entries when under the 10-entry cap", () => {
    const entries = Array.from({ length: 9 }, (_, i) => note(`body ${String(i)}`, i + 1))
    const r = formatActivityForPrompt(entries)
    expect(r.truncatedCount).toBe(0)
    expect(r.text).not.toContain("more earlier entries")
  })

  it("truncates to 10 entries when given 11 + appends the count suffix", () => {
    const entries = Array.from({ length: 11 }, (_, i) => note(`body ${String(i)}`, i + 1))
    expect(entries.length).toBe(11)
    expect(MAX_ACTIVITY_ENTRIES).toBe(10)
    const r = formatActivityForPrompt(entries)
    expect(r.truncatedCount).toBe(1)
    expect(r.text).toContain("... and 1 more earlier entries.")
  })

  it("truncates by char cap before the entry cap when entries are long", () => {
    // 3 entries each ~700 chars → 2100 chars total. Char cap should
    // engage and keep at most 2 entries.
    const big = "x".repeat(700)
    const entries: ActivityEntry[] = [note(big, 1), note(big, 2), note(big, 3)]
    expect(MAX_ACTIVITY_BODY_CHARS).toBe(2000)
    const r = formatActivityForPrompt(entries)
    expect(r.truncatedCount).toBeGreaterThan(0)
    expect(r.text).toContain("more earlier entries")
  })
})

describe("Polish #5 Fix 9 — natural-prose guardrails", () => {
  it("system prompt forbids robotic phrasings", async () => {
    aiQueue.push({ raw: "ok", modelName: "claude-haiku-4-5-20251001", tokensUsed: 1 })
    await generateContactSummary(facts(), slice(), "Hot Lead", ACTIVITY_EMPTY)
    const sys = aiCalls[0]?.systemPrompt ?? ""
    expect(sys).toContain("is classified as")
    expect(sys).toContain("template pluralization")
  })

  it("fallback summary never emits '(s)' pluralization artifacts", () => {
    // Facts with referralsMade=1 used to render "Has made 1 referral(s)."
    // Polish #5 Fix 9 — outbound referral count is in the prompt facts
    // block, not the fallback summary. Assert fallback is clean.
    const f = { ...facts(), referralsMade: 1 }
    const out = buildFallbackSummary(f, slice(), "Hot Lead")
    expect(out).not.toMatch(/\(s\)/)
    expect(out).not.toMatch(/is classified as/i)
  })
})

describe("buildFallbackSummary — deterministic template (polish #5 Fix 9 rewrite)", () => {
  it("leads with the relationship line + surfaces last-touchpoint phrasing", () => {
    const t = buildFallbackSummary(facts(), slice(), "Hot Lead")
    // Polish #5 Fix 9 — natural prose, not "is classified as".
    expect(t).toContain("Lead from Instagram")
    expect(t).toContain("Last touchpoint 2 days ago")
    expect(t).toContain("Current read: hot lead")
  })

  it('surfaces "No activity logged yet" when activityCount is 0', () => {
    const empty: ContactFacts = {
      ...facts(),
      activityCount: 0,
      notesCount: 0,
      callsCount: 0,
      meetingsCount: 0,
      smsCount: 0,
      daysSinceLastActivity: null,
      hasUpcomingMeeting: false,
    }
    const t = buildFallbackSummary(empty, slice(), null)
    expect(t).toContain("No activity logged yet")
  })
})

describe("buildEmptyContactSummary — no-AI floor", () => {
  it('contactType="Lead" → "New Lead" + leadSource mention when present', () => {
    const r = buildEmptyContactSummary(slice())
    expect(r.status).toBe("New Lead")
    expect(r.summary).toContain("Instagram")
  })

  it('missing contactType still routes to "New Lead"', () => {
    const r = buildEmptyContactSummary({ ...slice(), contactType: null })
    expect(r.status).toBe("New Lead")
  })

  it("Vendor contact type → New Vendor", () => {
    const r = buildEmptyContactSummary({ ...slice(), contactType: "Vendor", leadSource: null })
    expect(r.status).toBe("New Vendor")
    expect(r.summary.toLowerCase()).toContain("vendor")
  })

  it("does NOT call Haiku (no aiCalls recorded)", () => {
    aiCalls.length = 0
    buildEmptyContactSummary(slice())
    expect(aiCalls.length).toBe(0)
  })
})

describe("formatOpenTasksForPrompt", () => {
  const TODAY = "2026-06-19"

  it("returns an empty string when there are no open tasks", () => {
    expect(formatOpenTasksForPrompt([], TODAY)).toBe("")
  })

  it("renders a header + one bullet per task", () => {
    const out = formatOpenTasksForPrompt(
      [{ title: "Send gallery", dueDate: "2026-06-30", priority: null }],
      TODAY,
    )
    expect(out).toContain("Open tasks (soonest/overdue first):")
    expect(out).toContain('- "Send gallery" — due 06/30/2026')
  })

  it("marks an overdue task", () => {
    const out = formatOpenTasksForPrompt(
      [{ title: "Pay deposit", dueDate: "2026-06-10", priority: null }],
      TODAY,
    )
    expect(out).toContain("(overdue)")
  })

  it("marks a due-soon task", () => {
    const out = formatOpenTasksForPrompt(
      [{ title: "Confirm timeline", dueDate: "2026-06-20", priority: null }],
      TODAY,
    )
    expect(out).toContain("(due soon)")
  })

  it("annotates a high-priority task and omits the date part when undated", () => {
    const out = formatOpenTasksForPrompt(
      [{ title: "Call back", dueDate: null, priority: "high" }],
      TODAY,
    )
    expect(out).toContain('- "Call back" [high priority]')
    expect(out).not.toContain("— due")
  })

  it("does not annotate low/medium priority", () => {
    const out = formatOpenTasksForPrompt(
      [{ title: "Tidy notes", dueDate: null, priority: "medium" }],
      TODAY,
    )
    expect(out).not.toContain("[high priority]")
  })
})
