import { assistantOutputSchema, type AssistantOutput } from "./types"
import { ASSISTANT_RETRIEVER_INPUT_SCHEMAS, ASSISTANT_RETRIEVER_NAMES } from "./retrievers"
import { findRouteById } from "./route-catalog"

/**
 * THE VALIDATION GATE. Mirror of the ai-workflow-builder's
 * `validate.ts` (Module 16). No repair branch, no third success
 * state.
 *
 * For 17a (READ + NAVIGATE only):
 *   - `reply`       — always accepted (text-only)
 *   - `retrieve`    — name in `ASSISTANT_RETRIEVER_NAMES` AND args
 *                     match the retriever's canonical Zod input
 *   - `navigate`    — routeId in `ROUTE_CATALOG`
 *   - `refusal`     — always accepted (reason text)
 *
 * A model output of `kind: "write_proposal"` fails the discriminated
 * union here — 17a has no write surface.
 */

export interface ValidationError {
  type: "shape" | "retriever_name" | "retriever_args" | "navigate_route"
  message: string
  zodIssues?: unknown
}

export type ValidationResult =
  | { kind: "reply"; text: string }
  | {
      kind: "retrieve"
      name: (typeof ASSISTANT_RETRIEVER_NAMES)[number]
      args: Record<string, unknown>
    }
  | {
      kind: "navigate"
      routeId: string
      route: ReturnType<typeof findRouteById>
      message: string | null
    }
  | { kind: "refusal"; reason: string }
  | { kind: "rejected"; errors: ValidationError[] }

export function validateAssistantOutput(raw: unknown): ValidationResult {
  // Step 1 — discriminated-union shape check.
  const outer = assistantOutputSchema.safeParse(raw)
  if (!outer.success) {
    return {
      kind: "rejected",
      errors: [
        {
          type: "shape",
          message: "Assistant output does not match the required shape.",
          zodIssues: outer.error.issues,
        },
      ],
    }
  }
  const out: AssistantOutput = outer.data

  switch (out.kind) {
    case "reply":
      return { kind: "reply", text: out.text }
    case "refusal":
      return { kind: "refusal", reason: out.reason }
    case "navigate": {
      const route = findRouteById(out.routeId)
      if (!route) {
        return {
          kind: "rejected",
          errors: [
            {
              type: "navigate_route",
              message: `Route id "${out.routeId}" is not in the catalog.`,
            },
          ],
        }
      }
      return { kind: "navigate", routeId: out.routeId, route, message: out.message ?? null }
    }
    case "retrieve": {
      // Hard re-check: the name is in the allowlist (the Zod enum
      // already enforces, but we belt-and-suspenders the runtime Set
      // check so a future enum-drift bug fails closed).
      if (
        !ASSISTANT_RETRIEVER_NAMES.includes(out.name as (typeof ASSISTANT_RETRIEVER_NAMES)[number])
      ) {
        return {
          kind: "rejected",
          errors: [
            {
              type: "retriever_name",
              message: `Retriever "${out.name}" is not in the allowlist.`,
            },
          ],
        }
      }
      // Validate args through the retriever's canonical Zod input
      // schema. This is the SAME schema the retriever uses internally;
      // we just call it here to fail-fast before invoking the function.
      const argSchema =
        ASSISTANT_RETRIEVER_INPUT_SCHEMAS[
          out.name as keyof typeof ASSISTANT_RETRIEVER_INPUT_SCHEMAS
        ]
      const argResult = argSchema.safeParse(out.args)
      if (!argResult.success) {
        return {
          kind: "rejected",
          errors: [
            {
              type: "retriever_args",
              message: `Retriever "${out.name}" received invalid args.`,
              zodIssues: argResult.error.issues,
            },
          ],
        }
      }
      return {
        kind: "retrieve",
        name: out.name as (typeof ASSISTANT_RETRIEVER_NAMES)[number],
        args: argResult.data,
      }
    }
  }
}
