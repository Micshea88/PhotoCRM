import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { env } from "@/lib/env"

/**
 * AI model client. The ONE deliberate external dependency in this
 * build, contained to THIS file. Per `docs/PIVOTS_LEDGER.md` Section 1
 * row AI1 ("the AI is a tool, not the leader"), this file is the only
 * SDK importer — `eslint.config.mjs` enforces the allowlist.
 *
 * GRACEFUL DISABLE: when `ANTHROPIC_API_KEY` is missing, this function
 * throws a clear `AI Workflow Builder not configured` error. The build
 * does not fail. Tests inject mocks via `vi.mock("@/lib/ai-model")`.
 *
 * The provider/SDK choice is the ONLY external dependency this module
 * is permitted to introduce — module 16b's locked decision. It does not
 * open the door to additional providers (e.g., adding OpenAI would be
 * a new flagged decision, not an addition).
 *
 * Per the AI layer guiding principle: this function is only callable
 * from human-initiated action paths (`draftWorkflowFromPrompt`). It
 * has no scheduled / cron caller and never self-fires.
 */

export interface CallAiModelArgs {
  systemPrompt: string
  userPrompt: string
  /**
   * P3 (C6b) — optional per-call model override. When omitted, falls
   * back to `env.AI_WORKFLOW_BUILDER_MODEL` (the original behavior).
   *
   * Lets the contacts AI engine pick Haiku for classifier + summary
   * (cheap, fast) without locking the whole codebase to one model.
   * Single-importer rule preserved — this file is still the only
   * `@anthropic-ai/sdk` consumer, and the ESLint allowlist is
   * unchanged.
   */
  model?: string
  /** Optional max tokens override. Defaults to DEFAULT_MAX_TOKENS. */
  maxTokens?: number
}

export interface CallAiModelResult {
  /** Model's raw text output. Caller is responsible for JSON.parse. */
  raw: string
  /** Model identifier used (e.g. "claude-sonnet-4-6"). */
  modelName: string
  /** Tokens consumed by this call (input + output), null if unknown. */
  tokensUsed: number | null
}

const NOT_CONFIGURED_MESSAGE =
  "AI Workflow Builder is not configured. Set ANTHROPIC_API_KEY in your environment to enable it."

const DEFAULT_MAX_TOKENS = 2000

export async function callAiModel(args: CallAiModelArgs): Promise<CallAiModelResult> {
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(NOT_CONFIGURED_MESSAGE)
  }
  const client = new Anthropic({ apiKey })
  const model = args.model ?? env.AI_WORKFLOW_BUILDER_MODEL
  const response = await client.messages.create({
    model,
    max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: args.systemPrompt,
    messages: [{ role: "user", content: args.userPrompt }],
  })

  // Anthropic responses carry an array of content blocks. The AI
  // builder prompt instructs the model to return ONLY a single JSON
  // object — so we expect a single text block. If something else
  // arrives (tool_use, multi-block), we surface the concatenation;
  // the validation gate will reject if it's not parseable JSON.
  const raw = response.content.map((block) => (block.type === "text" ? block.text : "")).join("")

  const tokensUsed =
    typeof response.usage.input_tokens === "number" &&
    typeof response.usage.output_tokens === "number"
      ? response.usage.input_tokens + response.usage.output_tokens
      : null

  return { raw, modelName: model, tokensUsed }
}
