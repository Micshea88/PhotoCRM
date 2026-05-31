/**
 * Push 3 polish #5 Fix 9.2 — `callAiModel` wrapper contract test.
 *
 * The Fix 9.1 test mocked the wrapper itself, so a real request/parse
 * failure was invisible. This test mocks the Anthropic SDK INSIDE
 * `callAiModel`'s import boundary — exercising the wrapper's request
 * build + response extraction against fixture-shaped responses that
 * mirror what the SDK actually returns.
 *
 * Covers the bug Mike reported: when Haiku 4.5 returns a non-text
 * content block (thinking / refusal / tool_use), the wrapper used to
 * silently discard it, leaving `raw` empty and downstream callers
 * with no diagnostic. Fix 9.2 surfaces `stopReason` and
 * `contentBlockTypes` so the empty-raw path is debuggable from prod
 * logs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const createMock = vi.fn()
class FakeAnthropic {
  messages = { create: createMock }
}
vi.mock("@anthropic-ai/sdk", () => ({
  default: FakeAnthropic,
}))

vi.mock("@/lib/env", () => ({
  env: { ANTHROPIC_API_KEY: "test-key", AI_WORKFLOW_BUILDER_MODEL: "claude-sonnet-4-6" },
}))

beforeEach(() => {
  createMock.mockReset()
})

describe("callAiModel — Fix 9.2 wrapper contract", () => {
  it("happy path: extracts text from a TextBlock, exposes stopReason + types", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Wedding lead — Jimmy and Janie." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 30 },
    })
    const { callAiModel } = await import("@/lib/ai-model")
    const r = await callAiModel({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "claude-haiku-4-5-20251001",
      maxTokens: 1200,
    })
    expect(r.raw).toBe("Wedding lead — Jimmy and Janie.")
    expect(r.stopReason).toBe("end_turn")
    expect(r.contentBlockTypes).toEqual(["text"])
    expect(r.tokensUsed).toBe(130)
    expect(r.modelName).toBe("claude-haiku-4-5-20251001")
  })

  it("thinking-only response (the real Fix 9.2 bug): raw is empty, stopReason + types name the cause", async () => {
    // This is what Haiku 4.5 can return when it burns its output
    // budget on internal thinking and hits max_tokens before any
    // text is emitted. The wrapper now surfaces it.
    createMock.mockResolvedValueOnce({
      content: [{ type: "thinking", thinking: "Let me reason about this contact..." }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 800, output_tokens: 1200 },
    })
    const { callAiModel } = await import("@/lib/ai-model")
    const r = await callAiModel({
      systemPrompt: "sys",
      userPrompt: "user",
      model: "claude-haiku-4-5-20251001",
    })
    expect(r.raw).toBe("")
    expect(r.stopReason).toBe("max_tokens")
    expect(r.contentBlockTypes).toEqual(["thinking"])
  })

  it("mixed thinking + text: text is extracted, thinking is filtered, types lists both", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        { type: "thinking", thinking: "internal reasoning..." },
        { type: "text", text: "Wedding lead — Jimmy and Janie at the Vinoy." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 200 },
    })
    const { callAiModel } = await import("@/lib/ai-model")
    const r = await callAiModel({
      systemPrompt: "sys",
      userPrompt: "user",
    })
    expect(r.raw).toBe("Wedding lead — Jimmy and Janie at the Vinoy.")
    expect(r.contentBlockTypes).toEqual(["thinking", "text"])
    expect(r.stopReason).toBe("end_turn")
  })

  it("refusal stop_reason surfaces as stopReason (caller decides what to do)", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "" }],
      stop_reason: "refusal",
      usage: { input_tokens: 100, output_tokens: 5 },
    })
    const { callAiModel } = await import("@/lib/ai-model")
    const r = await callAiModel({ systemPrompt: "sys", userPrompt: "user" })
    expect(r.stopReason).toBe("refusal")
    expect(r.raw).toBe("")
  })
})
