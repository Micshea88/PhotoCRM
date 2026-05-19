import type { PromptCatalog } from "./catalog"

/**
 * System-prompt builder. Pure function — given the catalog and the
 * user's natural-language description, returns the structured prompt
 * payload that goes to the model. NO side effects, NO model call.
 *
 * Per Hard Constraint #3 (the AI is bounded to the V1 catalog), the
 * system prompt enumerates the EXACT id set and instructs the model
 * to emit `refusal` rather than invent. The catalog itself is
 * derived from `src/modules/workflows/types.ts` at module load —
 * so this prompt automatically tracks the live engine.
 *
 * The prompt-layer is a CONVENIENCE — not the defense. Even if the
 * model ignores everything in the system prompt, the validation gate
 * (validate.ts) catches every out-of-catalog id or invalid config.
 * This prompt is what helps the model produce GOOD output; the gate
 * is what guarantees the BAD output never lands.
 */
export interface BuiltPrompt {
  systemPrompt: string
  userPrompt: string
}

export function buildPrompt(catalog: PromptCatalog, userInput: string): BuiltPrompt {
  const triggerLines = catalog.triggers.map((t) => `  - ${t.id}: ${t.description}`).join("\n")
  const actionLines = catalog.nativeActions.map((a) => `  - ${a.id}: ${a.description}`).join("\n")
  const deferredLines = catalog.deferredActions
    .map((a) => `  - ${a.id}: ${a.description} (DEFERRED — emit a refusal instead.)`)
    .join("\n")

  const systemPrompt = `You translate a user's plain-English description of a workflow into a structured JSON object that the Pathway Foundation workflow engine can execute. You are a tool the user directs, not an autonomous actor.

OUTPUT FORMAT — return ONLY a single JSON object, no prose, no markdown:

  Either a DRAFT:
    {
      "result": "draft",
      "name": "<short workflow name>",
      "description": "<optional one-sentence description>",
      "triggerType": "<one of the trigger ids below>",
      "triggerConfig": { ... } | null,
      "steps": [
        {
          "actionType": "<one of the native action ids below>",
          "actionConfig": { ... } | null,
          "branchCondition": { "field": "...", "op": "eq", "value": "..." } | null
        },
        ...
      ]
    }

  Or a REFUSAL:
    {
      "result": "refusal",
      "reason": "<one short sentence quoting the deferred reason or explaining why this request cannot be expressed as a workflow>"
    }

  Output MUST be exactly one of these two shapes. Do NOT include an "enabled" field — workflows always land disabled and the human enables manually.

RULES — non-negotiable:

  1. Emit ONLY trigger ids and action ids from the lists below. Never invent new ids.
  2. If the user's request needs a DEFERRED action, emit a REFUSAL whose "reason" quotes the deferred reason exactly. Do not put a deferred action in "steps".
  3. The "steps" array has at most 20 steps.
  4. Each "actionConfig" must match the shape required by its actionType (see action descriptions).
  5. You never enable the workflow. You never fire it. You produce a draft for human review.

TRIGGERS:
${triggerLines}

NATIVE ACTIONS (these may appear in "steps"):
${actionLines}

DEFERRED ACTIONS (these may NEVER appear in "steps"; if requested, emit a refusal quoting the reason):
${deferredLines}
`

  return { systemPrompt, userPrompt: userInput }
}
