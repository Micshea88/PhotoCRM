# ai-workflow-builder module

The first generative-AI capability in this repo. Module 16a — the
**safety architecture only**. The model client is stubbed; module 16b
adds the real provider call.

## AI LAYER GUIDING PRINCIPLE — IT IS A TOOL, NOT THE LEADER

This is the locked spec for every AI capability in this codebase.
Quoted verbatim from the user's instruction:

> "The AI is a tool the human drives, never an autonomous actor. It
> never self-directs, never decides on its own to build/modify/execute
> things it wasn't asked for, never enables its own workflows, never
> acts against client data or money without the human having explicitly
> asked for that specific action. Every AI write = a human request
> routed through the identical human action path."

This module's enforcement of that principle:

- The AI never enables a workflow it generates (Hard Constraint #2).
- The AI never fires a workflow — there is no code path in this module
  that creates a `workflow_executions` row.
- Every write that creates a workflow routes through the SAME
  `createWorkflow` / `addWorkflowStep` flow a human uses (same RLS,
  same validation, same audit log).
- The human MUST explicitly confirm a draft before any workflow row
  exists. `confirmAiWorkflowDraft` requires `confirmed: true` as a
  Zod literal — there is no default.

Recorded in `docs/PIVOTS_LEDGER.md` Section 1 as the AI layer's
guiding principle.

## What's here

- `schema.ts` — `ai_workflow_drafts` table. Standard org-isolation RLS.
- `types.ts` — model-output contract (`modelOutputSchema`) + Zod input
  schemas for the three actions.
- `catalog.ts` — DERIVED from `src/modules/workflows/types.ts` at module
  load. The bounded universe the model can emit from. Single source of
  truth.
- `validate.ts` — THE validation gate. Imports canonical schemas
  verbatim. No "repair" branch. No third success state.
- `render.ts` — plain-language rendering of a validated draft for the
  human-review step.
- `rate-limit.ts` — per-user / per-org / per-day quotas. Rejected and
  refused drafts COUNT toward the limit (bounded abuse).
- `actions.ts` — `draftWorkflowFromPrompt`, `confirmAiWorkflowDraft`,
  `discardAiWorkflowDraft`. All `orgAction`. All gated by
  `hasPermission('manage_workflows')` (same permission manual workflow
  creation uses).

## THE FOUR HARD CONSTRAINTS — how they're enforced in code

### Constraint 1 — AI output is NEVER trusted directly

**Enforcement point:** `validate.ts:validateModelOutput()` is the ONLY
path between model output and a persisted draft.

**Proof of no bypass:**

- `validate.ts` imports `actionConfigSchema`, `triggerTypeSchema`,
  `branchConditionSchema` from `@/modules/workflows/types` — the
  canonical schemas, verbatim. No copies. No "ai-permissive" variants.
- No `try/catch` swallows Zod errors. Schema failure → rejection.
- No repair branch. The function returns one of three kinds:
  `{ kind: "rejected" }`, `{ kind: "refusal" }`, `{ kind: "draft" }`.
  There is no fourth state and no "fix it up" loop.
- `actions.ts:draftWorkflowFromPrompt` calls `validateModelOutput`
  exactly once per model response; on rejection the function persists
  the rejection and returns the errors to the user. No re-prompt.

### Constraint 2 — AI-generated workflows ALWAYS land enabled=false

**Enforcement point:** `actions.ts:confirmAiWorkflowDraft` — the ONLY
path from a draft to a real workflow.

**Proof of no bypass:**

- The INSERT into `workflows` has `enabled: false` HARD-CODED as a
  literal. Not pulled from any model output field, not from the draft
  row, not parameterized.
- The `modelOutputSchema` for the draft branch uses `.strict()` —
  unknown keys (including a model-emitted `enabled: true`) are
  rejected at validation time. The validated-draft jsonb shape has
  no `enabled` field by Zod construction.
- `confirmAiWorkflowDraftInput` requires `confirmed: z.literal(true)`.
  There is no default. The user explicitly affirms before any
  workflow row exists.

### Constraint 3 — AI is bounded to the V1 catalog; refuses out-of-catalog requests

**Enforcement point:** `catalog.ts:buildCatalogForPrompt()` derives the
catalog from `src/modules/workflows/types.ts` at module load. The
system prompt enumerates the EXACT id set and instructs the model to
emit `refusal` rather than invent.

**Two-layer enforcement:**

- **Prompt layer:** model is told to refuse for deferred capabilities
  with the documented deferral reason.
- **Validation gate (the real defense):** `validate.ts` ADDITIONALLY
  asserts every step's `actionType` is in `NATIVE_ACTION_SET`. Stubs
  emitted as a step (e.g., `take_payment` as an action rather than a
  refusal) are rejected with a `stubInStep` error.

### Constraint 4 — Own module, standard org-isolation RLS, Module 15 UNCHANGED

- Own module folder. Own table. Standard single org-isolation RLS.
- This commit edits `src/modules/workflows/*` ONLY to read from it
  (`catalog.ts` + `validate.ts` import canonical schemas). No new
  exports added to the workflows module. No schema edits. No action
  edits. No executor edits.
- `confirmAiWorkflowDraft` writes to `workflows` and `workflow_steps`
  directly (mirroring the orgAction's body) with `enabled: false`
  hard-coded. Module 15's actions are not called from this module
  in 16a — but the validated input shape is the SAME shape Module 15
  accepts.

## The mandatory human review step

```
User prompt → draftWorkflowFromPrompt
              ├─ rate-limit check
              ├─ call model (16a: stub throws; 16b: real provider)
              ├─ validate output
              ├─ persist ai_workflow_drafts row (status: pending_review/rejected/refused)
              └─ return { draftId, status, validatedDraft, renderedProse, errors }

User reviews the renderedProse + raw draft in the UI.
User clicks "Confirm and save as draft":
              → confirmAiWorkflowDraft({ draftId, confirmed: true })
                ├─ re-validate stored draft (tamper defense)
                ├─ INSERT workflows with enabled: false (HARD-CODED)
                ├─ INSERT workflow_steps for each
                └─ mark draft status='confirmed'

The workflow is now in the workflows table but DISABLED. The user
must explicitly enable it via the existing Module 15 enableWorkflow
action before it can fire.
```

The "Confirm" button is the ONLY mutation path from a draft to a
workflow. Page refresh / navigate away → nothing is saved. The draft
persists in `ai_workflow_drafts` so the user can return.

## Rate limits (V1 defaults)

| Limit           | Default   |
| --------------- | --------- |
| Per-user hourly | 5 drafts  |
| Per-org hourly  | 10 drafts |
| Per-org daily   | 50 drafts |

Rejected and refused drafts COUNT toward the limit. This is intentional
— a user attempting to evade the validation gate via repeated bad
prompts hits the limit. Module 16b will switch defaults to env reads
(`AI_WORKFLOW_BUILDER_HOURLY_USER` / `_ORG` / `_DAILY`).

## Hard rules

1. **The validation gate is the defense, not prompt-sanitization.**
   `validate.ts` is the single point of truth. Don't add input
   sanitization that creates a false sense of safety; assume the
   model is adversarial.
2. **No repair branch in `validate.ts`.** A failed validation is
   final. Adding a "normalize action type" or "try a similar action"
   path is forbidden — it silently widens what the AI can emit.
3. **Canonical schemas only.** `validate.ts` imports from
   `@/modules/workflows/types`. Re-defining or extending those
   schemas inside this module is forbidden.
4. **Hard-coded `enabled: false` in confirm.** Never read from a
   model-influenced field. Never parameterize.
5. **No new external dependency.** Per `docs/INTEGRATION_STRATEGY.md`,
   the model client (module 16b) goes through whatever provider
   access the stack already has. No Zapier-class middleware.
6. **The AI is a tool, not the leader.** Every AI write routes
   through the identical human action path. No AI-specific
   back-channel. No self-firing, no self-enabling.

## What's deferred to module 16b

- Model provider + SDK choice (Anthropic Claude recommended per the
  plan)
- API key + env-var wiring (`ANTHROPIC_API_KEY` etc.)
- Real `callAiModel` implementation in `src/lib/ai-model.ts`
- `setup.ts` prompts for the API key
- README updates documenting the provider choice + cost-per-draft
  guidance

In 16a the module is fully wired except for the model call itself.
Tests prove the safety architecture; 16b swaps the stub for a real
call without changing the function signature.

## What's deferred to Module 17 (AI Assistant)

Per the user's locked scope, a separate planned-future module covers:

- **READ/RETRIEVE** — natural-language find + summarize over real data
  (read path only).
- **NAVIGATE** — "where do I do X" → directs the user to the right screen.
- **WRITE (human-requested, human-grade path)** — when the user asks
  the AI to add/update a record, the AI calls the EXACT SAME orgAction
  manual UI uses. No AI-specific write back-channel.

Module 17 ships AFTER 16a/16b are approved, with its own plan-first
checkpoint. Hard constraints (recorded in `docs/PIVOTS_LEDGER.md`):

- Same "it is a tool, not the leader" principle
- Every write routes through identical orgAction (same RLS, same
  validation, same audit)
- No path bypasses orgAction/RLS/audit
- AI never self-initiates an action the user didn't ask for
