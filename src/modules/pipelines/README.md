# pipelines module

The configurable kanban backbone — `pipelines` + `pipeline_stages`.
Per Requirements §6.3, Tech Arch §2.2, Build Spec §2.

## What's here

- `schema.ts` — two tables. `pipelines` carries `type`, `displayOrder`,
  `config jsonb`. `pipeline_stages` carries `pipelineId` FK (ON DELETE
  CASCADE), `order`, `probability`, `color`, `config jsonb`. Both tables
  carry `organization_id` directly (denormalized on stages for RLS).
- `types.ts` — `PIPELINE_TYPES` enum (5 V1 types) + Zod input schemas
  for the 8 actions (CRUD on both tables + a batched
  `reorderPipelineStages`).
- `queries.ts` — `listPipelinesForOrg`, `listPipelinesByType`,
  `getPipelineForOrg` (with stages joined), `listStagesForPipeline`,
  `getPipelineStageForOrg`.
- `seed.ts` — `seedDefaultPipelines(db, orgId)`. Idempotent. Inserts
  the V1 photographer pack: 5 pipelines, ~54 stages total, with
  reasonable probability defaults for the Sales pipeline (the others
  are non-probabilistic and stay null).
- `actions.ts` — 8 actions: `createPipeline`, `updatePipeline`,
  `deletePipeline` (soft), `restorePipeline`, `createPipelineStage`,
  `updatePipelineStage`, `deletePipelineStage` (soft),
  `reorderPipelineStages` (batched).

## The 5 V1 default pipelines

| Type                    | Name                            | Stages |
| ----------------------- | ------------------------------- | -----: |
| sales                   | Sales                           |      8 |
| production              | Production                      |      9 |
| post_production_wedding | Wedding/Event Post-Production   |     13 |
| post_production_family  | Family/Portrait Post-Production |      9 |
| album_production        | Album Production                |     15 |

Stage names are verbatim from Requirements §6.3. `Sales` probabilities
seed sensible defaults (New Inquiry 10 → Retainer Paid/Booked 100,
Closed Lost 0); other pipelines have NULL probability since they don't
participate in pipeline forecasting.

Seeded per-org by:

- **Production:** `seedNewOrganization` (Better Auth's
  `afterCreateOrganization` hook) — wired in `src/lib/seed-new-org.ts`.
- **Dev:** `scripts/seed.ts` calls `seedDefaultPipelines` after the
  demo org is set up.

## RLS — single org-isolation policy

Both tables: `USING (organization_id = current_setting('app.current_org', true))`.
No role gate in V1. Any org member can manage pipelines — they're
operational config that managers should tune without admin intervention.

**Deferred:** Phase 4 may add a manager-and-above write gate if config
drift becomes an issue (the rbac module's two-policy pattern is already
proven for this). Currently a photographer could in principle reorder
your sales pipeline; in practice, the UI gates this and no harm done.

## Reorder semantics

`reorderPipelineStages({ pipelineId, stageOrders })` is the canonical
batched reorder API. The drag-and-drop kanban UI emits one stable
`{ id, order }[]` payload per drop; the action validates that every
id belongs to the named pipeline (in the active org, not soft-deleted)
and issues one UPDATE per row. A single audit row covers the whole
batch (`pipeline_stages.reordered` with `metadata.count`).

Atomicity: the action runs inside the orgAction transaction, so
either all order changes commit or none do.

## Hard rules

1. **`pipeline_stages.organization_id` mirrors its pipeline's
   `organization_id`.** The seed sets it; every create-stage action
   reads from `ctx.activeOrg.id`. Don't change one without the
   other — RLS will silently lose stages otherwise.
2. **`reorderPipelineStages` validates pipeline membership.** Passing
   a stage id from a different pipeline (or another org) throws
   `VALIDATION`. The defensive check is in the action; do not bypass
   it with a direct UPDATE.
3. **Cascade-delete is hard-delete only.** `ON DELETE CASCADE` on
   `pipeline_id` means the purge cron drops stages with their parent
   pipeline. Soft-deleting a pipeline does NOT touch its stages
   (intentional — restore-pipeline should bring stages back too).
4. **Default pipelines are seeded, not coded into the UI.** When the
   Phase 4 kanban view ships, it queries `listPipelinesForOrg` rather
   than hardcoding a 5-pipeline list. Owners can delete or rename
   defaults; the UI just renders what's in the DB.

## What's deferred

- **Stage-change automation hooks** (Requirements §6.3 — "automation
  rules per stage", "stale-card warnings", "WIP limits"). The `config
jsonb` column on `pipeline_stages` is where these settings will
  land in Phase 4; the kanban renderer reads them.
- **Cross-pipeline auto-creation** ("Sales → Production when Booked",
  Requirements §6.3 end). This is a workflow-engine rule (Phase 4
  Workflow module 4.4); the stage trigger goes through the workflow
  trigger system, not bespoke code here.
- **The kanban UI itself** (Phase 2 Pipeline + Kanban module per Build
  Spec — module 4.3). Data layer is complete; presentation is its own
  module.
