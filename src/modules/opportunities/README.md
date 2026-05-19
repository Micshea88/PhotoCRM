# opportunities module

The per-pipeline tracking record. Per Requirements §4.5 + §6.3,
Tech Arch §2.2, Build Spec §2.

## What it is

One **opportunity** = one project × one pipeline. Per Requirements §4.5:

> "Project ↔ Opportunity (one-to-many across pipelines)"

A Smith Wedding project typically has four opportunities across its
lifecycle:

1. **Sales** (won when booked)
2. **Production** (active during event prep)
3. **Wedding/Event Post-Production** (active during editing)
4. **Album Production** (if they bought an album)

Each lives in its own pipeline as a kanban card. Stage progression is
tracked per-opportunity via `stage_id` + `stage_changed_at`.

## What's here

- `schema.ts` — the `opportunities` table. 19 columns including
  `value_cents`, `probability_bps`, `status`, `stage_changed_at`,
  `lost_reason`. 5 indexes covering kanban board, forecast,
  per-project rollup, owner views, and average-time-in-stage.
- `types.ts` — `OPPORTUNITY_STATUSES` enum + Zod schemas for 7 actions.
- `queries.ts` — `listOpportunitiesForOrg`, `getOpportunityForOrg`
  (with project + stage joined), `listOpportunitiesByProject`,
  `listOpportunitiesByPipeline` (kanban source),
  `listOpportunitiesByStage`, `listOpportunitiesByOwner`,
  `listOpenOpportunitiesWithStage` (forecast source — returns the
  opp + its stage's probability for the value × probability sum).
- `actions.ts` — 7 actions:
  - `createOpportunity` (copies probability from stage if not provided)
  - `updateOpportunity` (general field patch)
  - `moveOpportunityStage` (specialized: sets stage + stage_changed_at;
    validates target stage belongs to the opp's pipeline; audit
    captures from/to)
  - `markOpportunityWon` (status='won', stage_changed_at=now)
  - `markOpportunityLost` (status='lost' + lost_reason)
  - `deleteOpportunity` (soft) / `restoreOpportunity`

## Probability behavior

`pipeline_stages.probability` is integer percent (0-100). The
opportunity stores `probability_bps` integer basis points (0-10000) so
the forecast math `SUM(value_cents × probability_bps / 10000)` stays
in integer cents.

| Scenario                                           | What the action does                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `createOpportunity` with `probabilityBps` omitted  | Copies from stage's `probability` × 100 (percent → bps)                  |
| `createOpportunity` with explicit `probabilityBps` | Uses the provided value                                                  |
| `moveOpportunityStage`                             | Does NOT touch `probability_bps`. User intent is preserved across moves. |
| `updateOpportunity` with `probabilityBps` set      | Updates the field directly.                                              |

That preserves user intent. If a Phase 4 admin UI wants a "reset to
stage default" affordance, it's a separate `updateOpportunity` call.

## FK cascade strategy

| FK                            | ON DELETE | Rationale                                                                              |
| ----------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `opportunities.project_id`    | CASCADE   | Purging a project takes its opportunities (the project owns them).                     |
| `opportunities.contact_id`    | SET NULL  | Primary contact changes; column is nullable already.                                   |
| `opportunities.pipeline_id`   | RESTRICT  | Can't purge a pipeline with active opportunities — caller must move/delete them first. |
| `opportunities.stage_id`      | RESTRICT  | Same — moving stages happens through `moveOpportunityStage`, not a stage purge.        |
| `opportunities.owner_user_id` | SET NULL  | Removed users leave their opportunities ownerless until reassigned.                    |

## RLS — single org-isolation policy

Same shape as companies/contacts/projects. Any org member can read and
write opportunities in V1. Phase 4 (invoices financial-RLS commit)
will overlay role-gated reads on the forecasting queries since
"Pipeline forecast" is financial-visible only.

## What's deferred

- **Cross-pipeline auto-creation** — Requirements §6.3: "Sales →
  Production (when Booked), Production → Post-Production (when Event
  Complete), Post-Production → Album (if Album Purchased)." This is
  workflow-engine logic that fires on `opportunities.stage_moved` /
  `opportunities.won` events. Lands with the workflow module (Phase 4).
  The data layer is ready: `moveOpportunityStage` audits with from/to,
  `markOpportunityWon` is its own action, both ready to be subscribed
  to.
- **Stale-card warnings** — Requirements §6.3. The kanban renderer
  compares `stage_changed_at` against per-stage thresholds stored in
  `pipeline_stages.config jsonb`. Implementation lives in the kanban
  module (Phase 4); the data is here.
- **Pipeline forecast report** — Requirements §6.15. The query
  (`listOpenOpportunitiesWithStage`) is ready; the report renderer
  is the reporting module (Phase 4).
- **Average time in stage / win rate by stage / lost-lead reasons
  breakdown** — Requirements §6.15. All three are aggregate queries
  over the `audit_log` (`opportunities.stage_moved`) and
  `opportunities` table itself. Reporting module.

## Hard rules

1. **Money is integer cents. Probability is integer basis points.**
   Same discipline as projects. No floats anywhere; the forecast helper
   `SUM(value_cents × probability_bps / 10000)` stays integer.
2. \*\*`moveOpportunityStage` is the ONLY action that changes `stage_id`
   - `stage_changed_at` together.\*\* Direct DB UPDATEs of `stage_id`
     without bumping `stage_changed_at` invalidate the "average time in
     stage" report. Don't bypass.
3. **`status` transitions go through `markOpportunityWon` /
   `markOpportunityLost`.** They bump `stage_changed_at` too so the
   "time to close" report works. Direct status updates via
   `updateOpportunity` are intentionally not allowed — the input
   schema doesn't include `status`.
4. **`lost_reason` is only meaningful when `status='lost'`.** The
   `markOpportunityLost` action sets both atomically.
5. **No unique constraint on (project_id, pipeline_id).** A lost deal
   can be re-opened as a fresh opportunity later; multiple cycles
   through the same pipeline are valid.
