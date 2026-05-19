# workflows module

The event-driven automation engine per Requirements §4.4 + §261 + §265,
Build Spec §2, Tech Arch §3.

## What's here

- `schema.ts` — three tables: `workflows`, `workflow_steps`, `workflow_executions`.
- `types.ts` — `TRIGGER_TYPES`, `ACTION_TYPES` (split into `NATIVE_ACTION_TYPES`
  and `STUB_ACTION_TYPES`), Zod input schemas including the canonical
  **`actionConfigSchema`** discriminated union — used by both manual creation
  and (future) AI-Workflow-Builder per the locked PIVOTS_LEDGER hard constraint.
- `dispatch.ts` — action handlers. Native handlers delegate to existing
  modules + `src/lib/email.ts`. Stub handlers throw `ActionError("VALIDATION", "<action> is deferred …")`.
- `executor.ts` — `executeWorkflow(db, executionId)`. Idempotent;
  terminal-status check at entry, per-step `stepResults[N].status` skip
  on retry.
- `trigger-matcher.ts` — `matchAuditEventsToWorkflows(db, args)`. Audit-
  driven matcher with `ON CONFLICT DO NOTHING` on the idempotency-key
  partial unique index.
- `actions.ts` — `createWorkflow` / `updateWorkflow` / `enableWorkflow` /
  `deleteWorkflow` / `restoreWorkflow` / `addWorkflowStep` /
  `updateWorkflowStep` / `removeWorkflowStep` / `reorderWorkflowSteps`.
  All `orgAction`; all gated by `hasPermission('manage_workflows')`.

Cron entry points:

- `app/api/jobs/cron/workflow-trigger-matcher/route.ts` — every 1 min
- `app/api/jobs/cron/workflow-execute/route.ts` — every 1 min

## Integration policy (LOCKED — `docs/INTEGRATION_STRATEGY.md`)

Every action delegates to ALREADY-BUILT native modules or to
`src/lib/email.ts` (Resend, outbound-only). **No new external service**
is introduced to make a stub work. Stripe-blocked / SMS-blocked /
Smart-Documents-blocked / etc. actions ship as STUBS that throw at
execute time:

| Stub                           | Deferred until                            |
| ------------------------------ | ----------------------------------------- |
| `send_invoice`                 | Stripe Connect unlock                     |
| `take_payment`                 | Stripe Connect unlock                     |
| `send_sms`                     | SMS provider configured                   |
| `send_smart_document`          | Smart Documents module                    |
| `send_smart_doc_for_signature` | Smart Documents module                    |
| `send_questionnaire`           | Questionnaires module                     |
| `send_webhook`                 | Outbound-webhook infrastructure (Phase 4) |
| `create_calendar_event`        | Calendar provider configured              |

A stub failure is recorded on the execution as `status='deferred'`
(NOT `failed`, NOT silent success). `stepResults[N].status='deferred'`.
The audit log records the deferral. The executor terminates the
execution cleanly so the user can see WHY their workflow didn't fully run.

## Idempotency contract (THE TOP DANGER ZONE — silent-corruption mode 1)

A duplicate `send_email` is real-world client-facing harm. Two-layer
defense:

### Layer 1 — execution-level

`workflow_executions` carries a partial unique index on
`(organizationId, workflowId, idempotencyKey) WHERE deleted_at IS NULL`.
The matcher INSERTs with `ON CONFLICT DO NOTHING`. A duplicate audit
sweep produces zero new rows. Key format: `<triggerType>:<eventId>:<workflowId>`
for audit-driven; `<triggerType>:<resourceId>:<workflowId>:<date>` for
time-based (the date prevents repeated firings on different days from
colliding).

### Layer 2 — per-step

`workflow_executions.stepResults` is the parallel array of per-step
outcomes. The executor reads it BEFORE dispatching step N and SKIPS
already-`succeeded` steps. So even if the executor crashes mid-run
and is re-invoked, `sendEmail` is called at most once.

### The proof

`tests/integration/workflow-idempotency.test.ts` — 8 cases including
the end-to-end "double-fire" test that asserts `sendEmail` is called
EXACTLY ONCE across two trigger fires + two executor invocations.

## RLS posture

Standard single org-isolation policy on all three tables. **No new
role gate at the RLS layer.** The `manage_workflows` permission is
enforced at the ACTION layer via `hasPermission()` — already in
`rbac/types.ts:PERMISSION_KEYS` and defaults to manager and above
(`rbac/queries.ts:ROLE_DEFAULTS`).

Executor RLS context: the cron route sets `app.current_org` from the
workflow's `organization_id` (a system-trusted read) + `app.current_role='admin'`
so all subsequent action writes pass RLS WITH CHECK.

## Trigger catalog (V1)

| Trigger type                  | Source                                           |
| ----------------------------- | ------------------------------------------------ |
| `opportunity.stage_changed`   | audit_log `opportunities.stage_moved`            |
| `opportunity.won`             | audit_log `opportunities.won`                    |
| `opportunity.lost`            | audit_log `opportunities.lost`                   |
| `task.completed`              | audit_log `tasks.marked_done`                    |
| `task.due_soon`               | daily cron sweep over tasks                      |
| `project.created`             | audit_log `projects.created`                     |
| `contact.created`             | audit_log `contacts.created`                     |
| `payment_installment.overdue` | daily cron sweep over payment_installments       |
| `date_relative`               | daily cron sweep against configured field+offset |

Deferred triggers (named owner): `form.submitted` → forms module;
`email.opened` / `email.clicked` → email-tracking phase (post-Resend-
webhook integration); `sms.received` → SMS module; `ig_dm.received` →
Meta Messaging API (Meta-blocked); `calendar.*` → calendar module;
`payment.received` / `payment.failed` → Stripe Connect commit;
`contract.sent` / `contract.signed` → Smart Documents module;
`webhook.received` → inbound-webhook receiver (Phase 4).

## Hard rules

1. **No new external service.** Every native action delegates to an
   existing native module or `src/lib/email.ts`. Stub actions throw —
   never silently no-op, never pull in a new package. Locked per
   `docs/INTEGRATION_STRATEGY.md`.
2. **Idempotency is mandatory.** Every new trigger type MUST contribute
   to a deterministic `idempotencyKey`. Time-based triggers MUST include
   the date in the key. The unique index does the rest.
3. **`stepResults` is append-only within an execution.** The executor
   writes the array fresh each finalize-tx; do NOT mutate prior entries.
4. **The matcher and the executor are independent cron routes.** Failure
   of one does not affect the other.
5. **`hasPermission('manage_workflows')` gates ALL workflow CRUD actions.**
   Don't bypass at the action layer — the role-default is manager+; the
   action enforces.
6. **AI-generated workflows always land `enabled=false`.** When the
   AI-Workflow-Builder module ships (planned future), its action MUST
   force `enabled=false` regardless of the AI's output. Documented as a
   hard constraint in `docs/PIVOTS_LEDGER.md`.

## Deliberately deferred — PLANNED FUTURE capabilities

These are NOT abandoned — they are planned future work with their own
plan-first checkpoints. They are NOT in V1.

### Workflow-chaining (`add_to_workflow` / `remove_from_workflow`)

Per the user's decision recorded with module 15: chaining is a
deliberately-planned future capability. The action types are reserved
in `ACTION_TYPES` but not implemented; the trigger from one workflow
into another is the unbuilt half. When this lands:

- Its own plan-first checkpoint
- Hard cycle-depth limit (initial proposal: `WORKFLOW_RECURSION_LIMIT=5`
  env-configurable, revisited at design time)
- Test-first on the cycle-detection invariant — a workflow that calls
  itself directly or transitively MUST fail with `lastError = "cycle detected"`
  BEFORE any downstream action fires
- Same idempotency-key discipline — chained executions get their own
  derived key based on the parent execution + step

This is recorded in `docs/PIVOTS_LEDGER.md` Section 2 "Deliberately
deferred planned future capabilities" with a cross-reference to this
README.

### AI Workflow Builder (planned future module)

A natural-language-to-workflow generator. The user describes a workflow
in plain English; an AI drafts a workflow definition that is then run
through the IDENTICAL Zod validation schemas as the manual builder
(`createWorkflowInput`, `addWorkflowStepInput`, and especially
`actionConfigSchema`) before anything is saved. **Hard constraints
locked now so they aren't lost:**

1. **AI output is never trusted directly.** It MUST parse through the
   identical Zod schemas used by manual creation. Invalid output is
   rejected and shown to the user; never silently saved.
2. **AI-generated workflows ALWAYS land `enabled=false`** as drafts
   requiring explicit human enable. The AI can never enable or fire a
   workflow. The action layer must enforce this regardless of what the
   AI emits.
3. **The AI is bounded to the existing V1 trigger + action catalogs**
   from this module. When the user requests a deferred action
   (e.g., `take_payment`), the AI must explicitly REFUSE / surface the
   deferral rather than emit a broken workflow.
4. **It is its own module with its own plan-first checkpoint.** NOT
   folded into module 15. Lands after module 15 ships, pending the
   user's go-ahead and a dedicated plan.

Recorded in `docs/PIVOTS_LEDGER.md` Section 2 "Deliberately deferred
planned future capabilities" with the four hard constraints quoted
verbatim.
