import type { PromptCatalog } from "./catalog"

/**
 * System-prompt builder. Pure function — given the catalog and the
 * user's message + recent conversation history, returns the structured
 * prompt payload that goes to the model. No side effects, no model call.
 *
 * Per AI1 (docs/PIVOTS_LEDGER.md): the AI is bounded to the V1
 * retriever + route catalog. Refuse out-of-catalog requests. NEVER
 * invent retriever names or route ids — the validation gate
 * (validate.ts) catches these regardless, but the prompt-layer
 * convenience makes valid output more likely.
 *
 * Module 17a — the system prompt has no `write_proposal` instructions
 * because the model output schema has no such variant. Adding the
 * write surface is 17b's job.
 */
export interface BuiltPrompt {
  systemPrompt: string
  userPrompt: string
}

export interface ConversationTurn {
  role: "user" | "assistant"
  content: string
}

export function buildPrompt(
  catalog: PromptCatalog,
  history: ConversationTurn[],
  userMessage: string,
): BuiltPrompt {
  const retrieverLines = catalog.retrievers.map((r) => `  - ${r.name}: ${r.description}`).join("\n")
  const routeLines = catalog.routes
    .map((r) => `  - ${r.id} → ${r.title}: ${r.description}`)
    .join("\n")
  const historyText =
    history.length === 0
      ? "(no prior messages in this conversation)"
      : history.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n")

  const systemPrompt = `You are the Pathway AI Assistant. You help the user find records, navigate the app, and answer questions about their work. You are a tool the user directs; never an autonomous actor.

YOU CAN DO THREE THINGS — return ONE JSON object per turn:

  1. REPLY in plain text (greetings, clarifying questions, summary of a previous retrieval):
       { "kind": "reply", "text": "<your message to the user>" }

  2. RETRIEVE data via ONE of the allowed retrievers below:
       { "kind": "retrieve", "name": "<retriever name>", "args": { ... } }

  3. NAVIGATE the user to a screen via ONE of the catalog routes:
       { "kind": "navigate", "routeId": "<route id>", "message": "<optional one-line explanation>" }

  Or REFUSE if the request is out of scope:
       { "kind": "refusal", "reason": "<one short sentence>" }

RULES — non-negotiable:

  1. Emit ONLY retriever names from the list below; ONLY route ids from the catalog below. Never invent.
  2. You CANNOT write data in this module. If the user asks you to add, update, or change a record, refuse with: "Write actions are not available in this conversation. Please use the manual UI." (Module 17b will enable AI-proposed writes with explicit human confirmation per write.)
  3. Output ONLY a single JSON object, no prose, no markdown.
  4. Each retriever's "args" must match the documented shape exactly. You may not pass arbitrary fields.

RETRIEVERS YOU MAY INVOKE:
${retrieverLines}

ROUTES YOU MAY NAVIGATE TO:
${routeLines}

CONVERSATION HISTORY (most recent last):
${historyText}
`

  return { systemPrompt, userPrompt: userMessage }
}
