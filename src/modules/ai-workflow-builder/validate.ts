import { actionConfigSchema, type ActionType, type TriggerType } from "@/modules/workflows/types"
import { modelOutputSchema } from "./types"
import { NATIVE_ACTION_SET } from "./catalog"

/**
 * THE VALIDATION GATE — Hard Constraint #1.
 *
 * AI output is NEVER trusted directly. Every model output passes through
 * THIS function. The function imports the CANONICAL schemas from
 * `src/modules/workflows/types.ts` verbatim — no copies, no derivatives,
 * no "ai-permissive" variants.
 *
 *   - If the output fails ANY check, this returns `{ kind: "rejected" }`.
 *     The caller stores the rejection and surfaces the errors to the user.
 *     NEVER auto-repaired. NEVER silently saved.
 *
 *   - If the output is a valid REFUSAL (e.g., the model declined to emit
 *     a deferred action), this returns `{ kind: "refusal", reason }`.
 *     The caller stores the refusal and shows the reason to the user.
 *
 *   - If the output is a valid DRAFT (passes shape AND each step passes
 *     the canonical actionConfigSchema AND every step's actionType is in
 *     `NATIVE_ACTION_SET` — see below), returns `{ kind: "draft",
 *     validatedDraft }`.
 *
 * Per Hard Constraint #3 (the AI is bounded to the V1 catalog), this
 * function ADDITIONALLY asserts every step's actionType is in
 * `NATIVE_ACTION_SET`. Stubs (take_payment, send_sms, etc.) cannot be
 * emitted as a step — the model must emit a REFUSAL instead. Even
 * though the live engine accepts stubs at the schema level (recording
 * `deferred` status at run time), AI-generated workflows must never
 * contain them — the AI is supposed to refuse upstream.
 *
 * This function:
 *   - has NO try/catch that swallows ZodErrors
 *   - has NO "repair" branch — failure is final
 *   - has NO third success state — strictly { rejected | refusal | draft }
 *
 * Hard Constraint #1 proof: the only way out of this function with
 * `kind: "draft"` is past every Zod schema + the NATIVE_ACTION_SET
 * check. There is no "fix it up and try again" path; the caller would
 * have to call this function AGAIN with new (or repaired) input to get
 * a different result.
 */

export interface ValidatedDraft {
  name: string
  description: string | null
  triggerType: TriggerType
  triggerConfig: Record<string, unknown> | null
  steps: {
    actionType: ActionType
    actionConfig: Record<string, unknown> | null
    branchCondition: Record<string, unknown> | null
  }[]
}

export type ValidationResult =
  | { kind: "rejected"; errors: ValidationError[] }
  | { kind: "refusal"; reason: string }
  | { kind: "draft"; validatedDraft: ValidatedDraft }

export interface ValidationError {
  /** Which top-level thing failed: "shape" (outer schema), "step" (a step's config), or "stubInStep" (Hard Constraint #3 violation). */
  type: "shape" | "step" | "stubInStep"
  /** Step index (0-based) when applicable. */
  stepIndex?: number
  /** Human-readable description. */
  message: string
  /** Zod issues array when applicable. */
  zodIssues?: unknown
}

/**
 * Run the model's raw output through the validation gate.
 *
 * `raw` must be the JSON-parsed model output. If JSON.parse failed
 * upstream, the caller records the parse failure and does not invoke
 * this function — there is nothing to validate.
 */
export function validateModelOutput(raw: unknown): ValidationResult {
  // Step 1 — shape validation against the discriminated union.
  const outer = modelOutputSchema.safeParse(raw)
  if (!outer.success) {
    return {
      kind: "rejected",
      errors: [
        {
          type: "shape",
          message: "Model output does not match the required shape.",
          zodIssues: outer.error.issues,
        },
      ],
    }
  }

  // Step 2 — refusal branch.
  if (outer.data.result === "refusal") {
    return { kind: "refusal", reason: outer.data.reason }
  }

  // Step 3 — draft branch. Validate each step's actionConfig against
  // the CANONICAL actionConfigSchema (imported from workflows/types.ts).
  // Per-step errors accumulate; if ANY step fails, the whole draft is
  // rejected.
  const errors: ValidationError[] = []
  for (const [stepIndex, step] of outer.data.steps.entries()) {
    // 3a. Hard Constraint #3: stub actions cannot appear as a step.
    // The model must emit a `refusal` for deferred capabilities.
    if (!NATIVE_ACTION_SET.has(step.actionType)) {
      errors.push({
        type: "stubInStep",
        stepIndex,
        message: `Action type "${step.actionType}" is deferred and cannot appear as a workflow step. The model must emit a "refusal" instead.`,
      })
      // Do NOT continue to actionConfigSchema for this step — the
      // stub-in-step error is sufficient.
      continue
    }
    // 3b. Canonical config validation — the SAME schema manual workflow
    // creation uses (workflows/types.ts:actionConfigSchema). The field
    // name remap (actionConfig → config) matches the workflows action
    // layer's validateActionShape().
    const stepResult = actionConfigSchema.safeParse({
      actionType: step.actionType,
      config: step.actionConfig ?? null,
    })
    if (!stepResult.success) {
      errors.push({
        type: "step",
        stepIndex,
        message: `Step ${String(stepIndex + 1)} (${step.actionType}) has invalid config.`,
        zodIssues: stepResult.error.issues,
      })
    }
  }

  if (errors.length > 0) {
    return { kind: "rejected", errors }
  }

  // Step 4 — all checks passed. Return the validated draft.
  return {
    kind: "draft",
    validatedDraft: {
      name: outer.data.name,
      description: outer.data.description ?? null,
      triggerType: outer.data.triggerType,
      triggerConfig: outer.data.triggerConfig ?? null,
      steps: outer.data.steps.map((s) => ({
        actionType: s.actionType,
        actionConfig: s.actionConfig ?? null,
        branchCondition: s.branchCondition ?? null,
      })),
    },
  }
}
