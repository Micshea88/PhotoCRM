# ai-assistant module

The conversational AI surface. Module 17a — **READ + NAVIGATE only**.
The write surface (proposed writes through the existing orgActions
with explicit human confirmation per write) lands in **17b**.

## AI LAYER GUIDING PRINCIPLE — IT IS A TOOL, NOT THE LEADER

Locked in `docs/PIVOTS_LEDGER.md` Section 1 as rule AI1. Quoted
verbatim from the user's instruction:

> "The AI is a tool the human drives, never an autonomous actor. It
> never self-directs, never decides on its own to build/modify/execute
> things it wasn't asked for, never enables its own workflows, never
> acts against client data or money without the human having explicitly
> asked for that specific action. Every AI write = a human request
> routed through the identical human action path."

This module's enforcement in 17a:

- The AI has **NO write path against other modules' data** in 17a.
  Mathematically incapable, not just policy-bound — `writers.ts` does
  not exist; `assistantOutputSchema` has no `write_proposal` variant;
  ESLint forbids `@/modules/*/actions` imports module-wide.
- Reads go through `queries.ts` surfaces only. RLS bounds visibility
  exactly to what the requesting user could see by clicking through
  the UI.
- The assistant is invoked from a human-initiated request
  (`assistantTurn` action). It has no cron caller; it never
  self-fires.

## What's here (17a)

- `schema.ts` — `ai_assistant_messages` table (transcript + audit).
- `retrievers.ts` — the **fixed read allowlist**. Each entry wraps a
  `queries.ts` function which uses `withOrgContext`. RLS bounds
  visibility automatically.
- `route-catalog.ts` — hand-maintained ~9 routes. The AI cannot
  invent routes.
- `catalog.ts` — derives the combined catalog from retrievers + routes
  at module load.
- `prompt.ts` — system-prompt builder (mirrors
  `ai-workflow-builder/prompt.ts`).
- `validate.ts` — the validation gate. Imports canonical schemas
  verbatim. No repair branch. Four kinds: `reply` / `retrieve` /
  `navigate` / `refusal`. **No `write_proposal` variant in 17a.**
- `render.ts` — plain-language rendering of retriever summaries +
  navigation prose.
- `rate-limit.ts` — per-user / per-org / per-day quotas. Operator-cost
  backstop, NOT a user paywall (see below).
- `actions.ts` — single `assistantTurn` orgAction gated by
  `hasPermission('use_ai_assistant')`.

## What does NOT exist in 17a (mathematical-incapacity guarantee)

- `writers.ts` — the orgAction allowlist for writes. Lands in 17b.
- `confirmWriteProposal` / `rejectWriteProposal` actions.
- `write_proposal` variant of `assistantOutputSchema`.
- Any import of `@/modules/*/actions` (ESLint enforces; static-grep
  test confirms).

The static-grep test at
`tests/integration/ai-assistant-no-db-imports.test.ts` proves:

- `retrievers.ts` does NOT import drizzle / `@/db` / `@/lib/db` /
  `@/modules/*/schema`. Reads go through queries.ts.
- NO file in this module imports `@/modules/*/actions`. There is no
  write back-channel against other modules' data in 17a.

## The three capabilities (17a ships only the first two)

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

### Capability C — WRITE (deferred to 17b)

In 17b, the model will be able to emit `write_proposal` outputs. The
flow is:

```
1. User: "Add the phone number 555-1234 to Jane Doe's contact."
2. assistantTurn → model proposes { kind: "write_proposal", action: "updateContact", input: {...} }
3. validate.ts parses input through the SAME Zod schema (updateContactInput)
   used by the manual UI. Invalid input → rejected; no proposal persisted.
4. UI renders the proposal in plain language; user clicks Confirm.
5. confirmWriteProposal({ proposalId, confirmed: z.literal(true) }) invokes
   the EXACT EXISTING orgAction (updateContact). Same RLS, same audit,
   same hasPermission, same validation.
```

Hard constraints locked NOW (per `docs/PIVOTS_LEDGER.md` Section 2,
Module 17 entry):

- Writes route through the IDENTICAL human orgAction path (no AI
  back-channel).
- Single-record writes only; no batch in V1.
- Explicit human confirmation per write — `confirmed: z.literal(true)`,
  no default.
- Destructive actions (`deleteContact`, `deleteProject`) **EXCLUDED
  from V1 writers allowlist** — own future commit with extra-friction
  confirmation (type-the-name pattern).
- Status-flip mutators (`markOpportunityWon`, `markTaskDone`, etc.)
  INCLUDED in 17b — canonical state-change actions.

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

1. **No write back-channel against other modules' data in 17a.**
   `writers.ts` does not exist; the model output schema has no
   `write_proposal` variant; ESLint blocks `@/modules/*/actions`
   imports module-wide. Static-grep test enforces.
2. **Reads only through queries.ts.** `retrievers.ts` may not import
   drizzle / `@/db` / `@/lib/db` / `@/modules/*/schema`. Lint +
   static-grep enforce.
3. **The retriever input schemas are strict; no `orgId` field.** RLS
   uses `app.current_org` set by the layout, never a model argument.
4. **The route catalog is closed.** AI cannot invent routes; emits
   refusals for screens not in `ROUTE_CATALOG`.
5. **No `repair` path in `validate.ts`.** Failed validation is final;
   reply to user with a rejection. Same posture as
   ai-workflow-builder/validate.ts.
6. **Rate limits are operator-cost backstops, not paywalls.** Don't
   re-frame this surface as a paid-plan gate without an explicit
   product-decision checkpoint.
7. **Module 15 + Module 16 + `src/lib/ai-model.ts` are byte-unchanged
   in 17a's commit.** Pre-commit `git diff` of those surfaces MUST
   be empty.

## What's deferred (named owners)

- **17b**: writers.ts + write_proposal flow + confirm/reject actions +
  Zone 1/2/4 tests (privileged-write bypass / prompt injection forcing
  write / write-input validation gate).
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
