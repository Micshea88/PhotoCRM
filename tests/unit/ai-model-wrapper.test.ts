/**
 * `callAiModel` wrapper contract — defensive coverage for the
 * SDK→wrapper response-shape boundary.
 *
 * The wrapper concatenates text from "text" content blocks and
 * surfaces `stopReason` + `contentBlockTypes` so any future
 * empty-`raw` branch is self-describing in prod logs. These are
 * pre-existing return-value fields whose contract is validated here
 * — they don't change wrapper behavior for normal calls (a plain
 * messages.create with no `thinking` request param and no tools
 * returns a single text block, exercised by the happy-path case).
 *
 * The non-text-block cases (thinking-only, mixed thinking+text,
 * refusal) are speculative fixtures — they assert the wrapper would
 * handle those response shapes if they ever appeared. They do not
 * reproduce or prove any specific live failure.
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

describe("callAiModel — wrapper contract", () => {
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

  it("thinking-only response (speculative shape): raw is empty, stopReason + types name the cause", async () => {
    // Speculative — a plain Haiku call (no `thinking` request param,
    // no tools) does not return this shape. The fixture asserts the
    // wrapper would handle a thinking-only block if one ever
    // appeared, by surfacing stopReason + contentBlockTypes.
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
