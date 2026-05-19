import "server-only"

/**
 * AI model client — STUBBED in module 16a. The actual provider/SDK
 * choice + key handling lands in module 16b per the flagged decision
 * in `src/modules/ai-workflow-builder/README.md` §"What's deferred to 16b".
 *
 * This stub is the ONE file that imports the model SDK (when 16b
 * adds one). ESLint's `no-restricted-imports` should enforce — but
 * even without it, this is the single grep-able surface.
 *
 * Tests inject scripted outputs via `vi.mock("@/lib/ai-model")`. The
 * module 16a tests demonstrate this pattern; module 16b will swap the
 * stub for a real Anthropic / OpenAI / etc. call without changing the
 * function signature.
 */

export interface CallAiModelArgs {
  systemPrompt: string
  userPrompt: string
}

export interface CallAiModelResult {
  /** The model's raw text output. Caller is responsible for JSON.parse. */
  raw: string
  /** Identifier for the model used (e.g. "claude-sonnet-4-6"). */
  modelName: string
  /** Tokens consumed by this call. */
  tokensUsed: number | null
}

/**
 * Call the AI model. In module 16a this throws — the entire AI
 * capability is unwired in production. Tests inject mocks.
 *
 * Per the AI layer guiding principle ("it is a tool, not the leader"),
 * this function is ONLY callable from human-initiated action paths.
 * It has no scheduled/cron caller and never self-fires.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function callAiModel(_args: CallAiModelArgs): Promise<CallAiModelResult> {
  // Touch param so the unused-vars lint stays quiet.
  void _args
  throw new Error(
    "AI model is not yet configured. The AI Workflow Builder is in safety-architecture phase (module 16a); the model client lands in module 16b.",
  )
}
