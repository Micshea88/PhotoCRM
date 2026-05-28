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
      return next
    })
  }),
}))

import {
  generateContactSummary,
  buildEmptyContactSummary,
  buildFallbackSummary,
} from "@/modules/contacts/ai/summary-generator"
import type { ContactFacts } from "@/modules/contacts/ai/lead-status-rules"
import type { ContactSlice } from "@/modules/contacts/ai/lead-status-classifier"

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
    const r = await generateContactSummary(facts(), slice(), "Hot Lead")
    expect(r.source).toBe("haiku")
    expect(r.text).toContain("hot lead from Instagram")
    expect(r.tokensUsed).toBe(90)
  })

  it("prompt includes activity counts + classified status when provided", async () => {
    aiQueue.push({
      raw: "ok",
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 1,
    })
    await generateContactSummary(facts(), slice(), "Hot Lead")
    const prompt = aiCalls[0]?.userPrompt ?? ""
    expect(prompt).toContain("activityCounts")
    expect(prompt).toContain("Hot Lead")
    expect(prompt).toContain("Instagram") // leadSource
  })

  it("uses the Haiku model id", async () => {
    aiQueue.push({ raw: "ok", modelName: "claude-haiku-4-5-20251001", tokensUsed: 1 })
    await generateContactSummary(facts(), slice(), null)
    expect(aiCalls[0]?.model).toBe("claude-haiku-4-5-20251001")
  })
})

describe("generateContactSummary — fallback paths", () => {
  it("Haiku error → falls back to deterministic template", async () => {
    aiQueue.push(new Error("AI Workflow Builder is not configured."))
    const r = await generateContactSummary(facts(), slice(), "Hot Lead")
    expect(r.source).toBe("fallback-template")
    expect(r.modelUsed).toBe("rules-engine@1")
    expect(r.text).toContain("hot lead")
  })

  it("Haiku returns empty string → falls back to deterministic template", async () => {
    aiQueue.push({ raw: "   ", modelName: "claude-haiku-4-5-20251001", tokensUsed: 1 })
    const r = await generateContactSummary(facts(), slice(), null)
    expect(r.source).toBe("fallback-template")
  })
})

describe("buildFallbackSummary — deterministic template", () => {
  it("includes status + last-activity day count", () => {
    const t = buildFallbackSummary(facts(), slice(), "Hot Lead")
    expect(t).toContain("hot lead")
    expect(t).toContain("Last activity 2")
  })

  it('returns "No activity recorded yet." when activityCount is 0', () => {
    const empty: ContactFacts = {
      ...facts(),
      activityCount: 0,
      notesCount: 0,
      callsCount: 0,
      meetingsCount: 0,
      smsCount: 0,
      daysSinceLastActivity: null,
    }
    const t = buildFallbackSummary(empty, slice(), null)
    expect(t).toContain("No activity recorded yet")
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
