/**
 * Unit test for the AI model client (module 16b).
 *
 * Two assertions:
 *   1. Graceful disable when ANTHROPIC_API_KEY is missing — throws a
 *      clear "AI Workflow Builder not configured" error, no crash.
 *   2. The single SDK-importing surface is `src/lib/ai-model.ts` —
 *      enforced by ESLint allowlist (this test confirms the function
 *      exists; the allowlist confirms only this file imports it).
 *
 * The actual Anthropic API call is NOT exercised in tests — production
 * `vi.mock("@/lib/ai-model")` injects scripted outputs in the 16a
 * integration tests. This unit test only covers the not-configured
 * path + the function-shape contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("ai-model — graceful disable when key missing", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it("throws 'AI Workflow Builder is not configured' when ANTHROPIC_API_KEY is undefined", async () => {
    // Stub @/lib/env to return undefined for the key — defensive
    // pattern so we don't need to muck with process.env at test time
    // (env.ts validates at module load and caches).
    vi.doMock("@/lib/env", () => ({
      env: {
        ANTHROPIC_API_KEY: undefined,
        AI_WORKFLOW_BUILDER_MODEL: "claude-sonnet-4-6",
      },
    }))
    const { callAiModel } = await import("@/lib/ai-model")
    await expect(callAiModel({ systemPrompt: "x", userPrompt: "y" })).rejects.toThrow(
      /not configured/i,
    )
  })

  it("the error message points the user to ANTHROPIC_API_KEY", async () => {
    vi.doMock("@/lib/env", () => ({
      env: {
        ANTHROPIC_API_KEY: undefined,
        AI_WORKFLOW_BUILDER_MODEL: "claude-sonnet-4-6",
      },
    }))
    const { callAiModel } = await import("@/lib/ai-model")
    await expect(callAiModel({ systemPrompt: "x", userPrompt: "y" })).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    )
  })
})
