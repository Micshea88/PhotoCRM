# ai-assistant module

The conversational AI surface. Modules 17a (READ + NAVIGATE) and 17b
(PROPOSE WRITE → human-confirm → invoke canonical orgAction).

## AI LAYER GUIDING PRINCIPLE — IT IS A TOOL, NOT THE LEADER

Locked in `docs/PIVOTS_LEDGER.md` Section 1 as rule AI1. Quoted
verbatim from the user's instruction:

> "The AI is a tool the human drives, never an autonomous actor. It
> never self-directs, never decides on its own to build/modify/execute
> things it wasn't asked for, never enables its own workflows, never
> acts against client data or money without the human having explicitly
> asked for that specific action. Every AI write = a human request
> routed through the identical human action path."

This module's enforcement (17a + 17b):

- Reads go through `queries.ts` surfaces only. RLS bounds visibility
  exactly to what the requesting user could see by clicking through
  the UI.
- The assistant is invoked from a human-initiated request
  (`assistantTurn` action). It has no cron caller; it never
  self-fires.
- The AI cannot write directly. It can only PROPOSE a write
  (`write_proposal` output) — a row is persisted as `pending` and the
  user must call `confirmWriteProposal({ confirmed: z.literal(true) })`
  for the canonical orgAction to be invoked. The AI cannot self-confirm
  (the model output schema has no `confirmed` field; `.strict()`
  rejects it).
- Writers route through the IDENTICAL human orgAction path. `writers.ts`
  is the only file in this module permitted to import
  `@/modules/<x>/actions` (ESLint + static-grep enforce). The writer
  allowlist is narrow (9 V1 entries); destructive deletes are excluded.

## What's here

- `schema.ts` — `ai_assistant_messages` table (transcript + audit +
  write-proposal lifecycle: action / input / status / resulting
  resource id).
- `retrievers.ts` — the **fixed read allowlist**. Each entry wraps a
  `queries.ts` function which uses `withOrgContext`. RLS bounds
  visibility automatically.
- `writers.ts` (17b) — the **fixed write allowlist** (9 V1 entries).
  ONLY file in this module permitted to import
  `@/modules/<x>/actions`. Each entry pairs with the action's
  canonical Zod inputSchema imported verbatim from the source
  module's `types.ts`. No AI-permissive variants.
- `route-catalog.ts` — hand-maintained ~9 routes. The AI cannot
  invent routes.
- `catalog.ts` — derives the combined catalog from retrievers +
  routes (+ writers, in 17b) at module load.
- `prompt.ts` — system-prompt builder (mirrors
  `ai-workflow-builder/prompt.ts`).
- `validate.ts` — the validation gate. Imports canonical schemas
  verbatim. No repair branch. Five kinds: `reply` / `retrieve` /
  `navigate` / `refusal` / `write_proposal`.
- `render.ts` — plain-language rendering of retriever summaries,
  navigation prose, and write-proposal review text.
- `rate-limit.ts` — per-user / per-org / per-day quotas. Operator-cost
  backstop, NOT a user paywall (see below).
- `actions.ts` — `assistantTurn` (gated by
  `hasPermission('use_ai_assistant')`) + `confirmWriteProposal` +
  `rejectWriteProposal`.

## Defense-in-depth: NO covert write back-channel

Three layers guarantee the AI cannot write without explicit human
confirmation:

1. **ESLint**: `@/modules/<x>/actions` imports are blocked everywhere
   in this module EXCEPT `writers.ts` (`eslint.config.mjs`).
2. **Static-grep** (Zone 1 — `ai-assistant-privileged-write-bypass.test.ts`):
   - NO file other than `writers.ts` imports `@/modules/<x>/actions`.
   - `writers.ts` imports ONLY `@/modules/<x>/actions`,
     `@/modules/<x>/types`, `zod`, `server-only`.
3. **Runtime validator**: `validateAssistantOutput` checks the
   proposed `action` is in `ASSISTANT_WRITER_NAMES` and the proposed
   `input` parses through the writer's canonical inputSchema. Anything
   not in the allowlist (`rawSqlExec`, `deleteContact`, `deleteProject`)
   is rejected.

`assistantTurn` NEVER invokes an orgAction itself. The write happens
only via the separate `confirmWriteProposal` action — which:

- Requires `confirmed: z.literal(true)` from the USER (no default,
  no model field).
- Loads the pending proposal org-scoped (RLS).
- **Re-validates** the stored input through the canonical schema
  (tamper-defense — same pattern as `confirmAiWorkflowDraft`).
- Invokes the canonical orgAction. Same RLS, same audit, same
  `hasPermission`, same input validation that the manual UI runs.

The static-grep test at
`tests/integration/ai-assistant-no-db-imports.test.ts` additionally
proves `retrievers.ts` does NOT import drizzle / `@/db` / `@/lib/db` /
`@/modules/<x>/schema`.

## The three capabilities

### Capability A — READ/RETRIEVE

Translates NL → an existing `queries.ts` function call via the fixed
retriever allowlist. RLS bounds visibility through `withOrgContext`.

| Retriever                                                    | Wraps                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `findContactsByName({ q, limit? })`                          | `contacts/queries:searchContactsByName`                  |
| `getContactById({ id })`                                     | `contacts/queries:getContactForOrg`                      |
| `listContactsForCompany({ companyId })`                      | `contacts/queries:listContactsByCompany`                 |
| `findProjectsByName({ q, limit? })`                          | `projects/queries:listProjectsForOrg` + in-memory filter |
| `getProjectById({ id })`                                     | `projects/queries:getProjectForOrg`                      |
| `listProjectsByLifecycleStatus({ lifecycleStatus, limit? })` | `projects/queries:listProjectsByLifecycle`               |

Each retriever's Zod input is `.strict()` with no `orgId` field — the
AI cannot smuggle a different orgId; RLS uses `app.current_org` set
by the layout.

### Capability B — NAVIGATE

Returns a route+title from the hand-maintained `ROUTE_CATALOG`. The
AI cannot invent routes. When asked about a screen that isn't in the
catalog, it returns a refusal listing what exists.

V1 catalog has ~9 entries (dashboard, events list, items, settings/\*,
onboarding). Codegen from the filesystem is a deferred future change.

### Capability C — PROPOSE WRITE (17b)

The model emits `write_proposal` outputs. The flow:

```
1. User: "Add the phone number 555-1234 to Jane Doe's contact."
2. assistantTurn → model proposes { kind: "write_proposal", action: "updateContact",
   input: {...}, summaryForUser: "I'll update Jane's phone. Confirm?" }
3. validate.ts: action in allowlist + input parses through SAME Zod schema
   (updateContactInput) used by the manual UI. Invalid → rejected; no proposal
   persisted.
4. Proposal persisted as a `write_proposal` row with status="pending".
   No mutation against the target table occurs at this step.
5. UI renders the proposal in plain language; user clicks Confirm or Reject.
6. confirmWriteProposal({ proposalId, confirmed: z.literal(true) }):
   - Loads the proposal org-scoped (RLS).
   - Re-validates stored input through the canonical schema (tamper defense).
   - Invokes the EXACT EXISTING orgAction (updateContact). Same RLS, same
     audit, same hasPermission, same validation.
   - Marks the proposal status="confirmed", records resultingResourceType +
     resultingResourceId.
   - Appends a `write_confirmed` transcript row.
7. rejectWriteProposal({ proposalId }) → marks status="rejected"; appends
   `write_rejected` row.
```

V1 writer allowlist (final):

| Writer                | Source action                     |
| --------------------- | --------------------------------- |
| `createContact`       | `@/modules/contacts/actions`      |
| `updateContact`       | `@/modules/contacts/actions`      |
| `updateProject`       | `@/modules/projects/actions`      |
| `createTask`          | `@/modules/tasks/actions`         |
| `updateTask`          | `@/modules/tasks/actions`         |
| `markTaskDone`        | `@/modules/tasks/actions`         |
| `updateOpportunity`   | `@/modules/opportunities/actions` |
| `markOpportunityWon`  | `@/modules/opportunities/actions` |
| `markOpportunityLost` | `@/modules/opportunities/actions` |

Hard constraints (per `docs/PIVOTS_LEDGER.md` Section 2, Module 17):

- Writes route through the IDENTICAL human orgAction path (no AI
  back-channel).
- Single-record writes only; no batch in V1.
- Explicit human confirmation per write — `confirmed: z.literal(true)`,
  no default.
- Destructive actions (`deleteContact`, `deleteProject`) **EXCLUDED
  from V1 writers allowlist** — own future commit with extra-friction
  confirmation (type-the-name pattern).
- Status-flip mutators (`markOpportunityWon`, `markTaskDone`, etc.)
  INCLUDED — canonical state-change actions.
- `createProject` NOT in V1 — users create projects via the manual UI
  for now; V2 once the AI can handle the multi-step kickoff cleanly.
- Association adds/removes (project_photographers, task dependencies,
  checklist items) NOT in V1 — manual UI is sufficient.

## RBAC

New permission key: `use_ai_assistant`. Default-granted to all roles
EXCEPT `client_limited`. Photographer/contractor/editor get it; their
writes (when 17b lands) are still bounded by their existing RLS +
permission checks because the writers will call the same orgActions
the manual UI does.

## Rate limits — OPERATOR-COST BACKSTOP, NOT A USER PAYWALL

> Same locked posture as `ai-workflow-builder` (module 16b). These
> are an operator-cost / abuse backstop, NOT a user paywall, NOT a
> usage tier, NOT a paid-plan gate. Defaults are GENEROUS — invisible
> to honest use, hard ceiling only against runaway / abuse / bug.
> Treat as a circuit breaker, not a monetization lever. If a future
> change to this module turns them into a paid-plan gate, that's a
> separate flagged decision and needs to be surfaced — they are NOT
> a paywall in disguise today.

| Limit           | Default        | Env var                    |
| --------------- | -------------- | -------------------------- |
| Per-user hourly | 300 turns/hr   | `AI_ASSISTANT_HOURLY_USER` |
| Per-org hourly  | 1500 turns/hr  | `AI_ASSISTANT_HOURLY_ORG`  |
| Per-org daily   | 6000 turns/day | `AI_ASSISTANT_DAILY_ORG`   |

Counts user-initiated turns only (each `assistantTurn` invocation =
one turn regardless of how many tool calls or replies it produces in
17b+).

## Conversation persistence

ALL turns persisted to `ai_assistant_messages` (per the locked
decision). Forensic record of every prompt and every model output.

TTL via the existing purge-deleted cron (added when 17b lands the
sweep schedule):

- Chatter (user/assistant/tool_result/refusal) — 30 days
- Write proposals + confirmations (17b) — 90 days

## Model client

Reuses `src/lib/ai-model.ts` UNCHANGED from 16b. Same Anthropic SDK
allowlist enforcement (only `src/lib/ai-model.ts` may import the
SDK). NO new external dependency in this module.

When `ANTHROPIC_API_KEY` is missing, `callAiModel` throws the
existing "AI Workflow Builder is not configured" error. The
assistant inherits the graceful-disable behavior automatically.

## Hard rules

1. **Writes go through the writers.ts allowlist only.** ESLint blocks
   `@/modules/<x>/actions` imports everywhere in this module except
   `writers.ts`. Zone-1 static-grep test enforces from the other
   direction (writers.ts may only import actions + types + zod +
   server-only).
2. **Reads only through queries.ts.** `retrievers.ts` may not import
   drizzle / `@/db` / `@/lib/db` / `@/modules/<x>/schema`. Lint +
   static-grep enforce.
3. **The retriever input schemas are strict; no `orgId` field.** RLS
   uses `app.current_org` set by the layout, never a model argument.
4. **The route catalog is closed.** AI cannot invent routes; emits
   refusals for screens not in `ROUTE_CATALOG`.
5. **No `repair` path in `validate.ts`.** Failed validation is final;
   reply to user with a rejection. Same posture as
   ai-workflow-builder/validate.ts.
6. **Model cannot self-confirm.** `write_proposal` output schema has
   NO `confirmed` field; `.strict()` rejects it. `confirmWriteProposal`
   requires `confirmed: z.literal(true)` from the USER.
7. **Tamper defense.** `confirmWriteProposal` re-validates stored input
   through the canonical schema before invoking the orgAction.
8. **Rate limits are operator-cost backstops, not paywalls.** Don't
   re-frame this surface as a paid-plan gate without an explicit
   product-decision checkpoint.
9. **Module 15 + Module 16 + `src/lib/ai-model.ts` are byte-unchanged
   in 17a's and 17b's commits.** Pre-commit `git diff` of those
   surfaces MUST be empty.

## What's deferred (named owners)

- **Batch writes** ("update all contacts matching X"): own future
  module, own plan-first checkpoint.
- **Multi-turn refinement of a pending write proposal**: V2 of this
  module.
- **Destructive write actions** (`deleteContact`, `deleteProject`):
  own future commit with type-the-name confirmation friction.
- **AI-initiated proactive suggestions** ("you might want to email X"):
  out of scope — violates AI1 unless the user explicitly opts in
  per-suggestion.
- **AI editing existing records without per-write confirmation**:
  NEVER (this is a hard rule, not a V1 limitation).
- **Voice input**: Phase 5+.
- **Org-fine-tuned model**: out of scope.
- **Long-running cross-session memory**: V1 keeps the conversation
  scoped; cross-session memory is V2+.
- **Cross-record summaries** (joins beyond what existing queries
  helpers express): deferred — the AI cannot invent SQL.
- **Route-catalog codegen from `app/(app)/**/page.tsx`\*\*: deferred.
  V1 is hand-maintained.
