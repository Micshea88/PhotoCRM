/**
 * Push 3 (C6b CORRECTED) — Haiku classifier unit tests.
 *
 * Covers:
 *   - Successful Haiku call: returns free-form status (NOT enum-constrained)
 *   - First-pass unparseable → stricter retry → parsed
 *   - Both passes unparseable → fallback to rules
 *   - No API key (callAiModel throws) → fallback to rules
 *   - Prompt includes facts + contact slice context
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Stub callAiModel BEFORE the classifier imports it. The stub is
// configurable per-test via the exported aiMock.calls / aiMock.next
// channel.
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
const consumeNext = (): AiResult => {
  const next = aiQueue.shift()
  if (!next) throw new Error("aiQueue exhausted")
  if (next instanceof Error) throw next
  return next
}

// log.ts reads env.NODE_ENV at module-load — env is server-only and
// crashes in jsdom. Stub the log surface the classifier uses.
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
    return Promise.resolve().then(() => consumeNext())
  }),
}))

import { classifyLeadStatus } from "@/modules/contacts/ai/lead-status-classifier"
import type { ContactFacts } from "@/modules/contacts/ai/lead-status-rules"
import type { ContactSlice } from "@/modules/contacts/ai/lead-status-classifier"

function facts(): ContactFacts {
  return {
    contactType: "Lead",
    lifecycleStatus: null,
    tags: ["wedding"],
    activityCount: 4,
    notesCount: 1,
    callsCount: 1,
    meetingsCount: 1,
    smsCount: 1,
    daysSinceCreated: 10,
    daysSinceLastActivity: 2,
    daysSinceLastInbound: 2,
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
    notes: "Inquired about August date",
  }
}

beforeEach(() => {
  aiCalls.length = 0
  aiQueue.length = 0
})

describe("classifyLeadStatus — successful Haiku call", () => {
  it("returns free-form Haiku status (NOT enum-constrained)", async () => {
    aiQueue.push({
      raw: JSON.stringify({
        status: "Premium engaged hot lead",
        reasoning: "Recent inbound + upcoming meeting + wedding tag.",
      }),
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 150,
    })
    const r = await classifyLeadStatus(facts(), slice())
    expect(r.status).toBe("Premium engaged hot lead")
    expect(r.source).toBe("haiku")
    expect(r.modelUsed).toBe("claude-haiku-4-5-20251001")
    expect(r.tokensUsed).toBe(150)
    expect(r.errorMessage).toBeNull()
  })

  it("tolerates code-fence-wrapped JSON output", async () => {
    aiQueue.push({
      raw: '```json\n{"status":"Active Lead","reasoning":"Engaged."}\n```',
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 100,
    })
    const r = await classifyLeadStatus(facts(), slice())
    expect(r.status).toBe("Active Lead")
    expect(r.source).toBe("haiku")
  })

  it("passes facts + contact slice context in the user prompt", async () => {
    aiQueue.push({
      raw: '{"status":"Hot Lead","reasoning":"X."}',
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 50,
    })
    await classifyLeadStatus(facts(), slice())
    expect(aiCalls.length).toBe(1)
    const prompt = aiCalls[0]?.userPrompt ?? ""
    // Facts present in the prompt
    expect(prompt).toContain("contactType")
    expect(prompt).toContain("daysSinceLastActivity")
    expect(prompt).toContain("activityCounts")
    // Slice context present
    expect(prompt).toContain("Instagram") // leadSource
    expect(prompt).toContain("Ada Lovelace")
  })

  it("uses the Haiku model id (claude-haiku-4-5-20251001)", async () => {
    aiQueue.push({
      raw: '{"status":"X","reasoning":"Y"}',
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 1,
    })
    await classifyLeadStatus(facts(), slice())
    expect(aiCalls[0]?.model).toBe("claude-haiku-4-5-20251001")
  })

  it("caps status at 80 chars + reasoning at 400 chars", async () => {
    aiQueue.push({
      raw: JSON.stringify({
        status: "X".repeat(200),
        reasoning: "Y".repeat(1000),
      }),
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 1,
    })
    const r = await classifyLeadStatus(facts(), slice())
    expect(r.status.length).toBe(80)
    expect(r.reasoning.length).toBe(400)
  })
})

describe("classifyLeadStatus — unparseable + retry", () => {
  it("first-pass unparseable → retries with stricter prompt → returns retry result", async () => {
    aiQueue.push({
      raw: "I think this contact is a hot lead.",
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 80,
    })
    aiQueue.push({
      raw: '{"status":"Hot Lead","reasoning":"Engaged."}',
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 60,
    })
    const r = await classifyLeadStatus(facts(), slice())
    expect(r.status).toBe("Hot Lead")
    expect(r.source).toBe("haiku")
    // Two AI calls happened (first pass + stricter retry)
    expect(aiCalls.length).toBe(2)
    expect(aiCalls[1]?.systemPrompt).toContain("Your previous output was not valid JSON")
  })

  it("both passes unparseable → falls back to rules-engine", async () => {
    aiQueue.push({
      raw: "not json",
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 10,
    })
    aiQueue.push({
      raw: "still not json",
      modelName: "claude-haiku-4-5-20251001",
      tokensUsed: 10,
    })
    const r = await classifyLeadStatus(facts(), slice())
    expect(r.source).toBe("fallback-rules")
    expect(r.modelUsed).toBe("rules-engine@1")
    expect(r.errorMessage).toContain("unparseable")
  })
})

describe("classifyLeadStatus — no API key / API error → fallback", () => {
  it("falls back to rules when callAiModel throws (no key)", async () => {
    aiQueue.push(new Error("AI Workflow Builder is not configured."))
    const r = await classifyLeadStatus(facts(), slice())
    expect(r.source).toBe("fallback-rules")
    expect(r.modelUsed).toBe("rules-engine@1")
    expect(r.errorMessage).toContain("not configured")
    // The rules-engine fires for Lead + inbound-within-7d → Hot Lead
    // (takes precedence over upcoming-meeting in the fixture). The
    // exact label isn't load-bearing; what matters is the source +
    // model id reflect the fallback path.
    expect(r.status).toBe("Hot Lead")
  })
})
