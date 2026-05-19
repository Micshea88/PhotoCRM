# project-templates module

The BLUEPRINT for new projects. Two tables per Requirements §4.9,
Tech Arch §2.3, Build Spec §2:

- `project_templates` — the per-event-type blueprint with package
  defaults, payment schedule defaults, default workflows, and pointers
  to questionnaire + contract templates
- `project_template_task_items` — the templated task plan: ordered
  task definitions with relative date offsets and assignee ROLES

## V1 scope — storage + admin CRUD only

This module ships the data layer and admin actions. It does NOT
contain the **instantiation engine** — the function that walks a
template, creates a real project's `project_stages` + `tasks` +
`task_dependencies` + `task_checklist_items` rows, resolves
`assignee_role` strings to real users, and computes absolute due
dates from `relative_offset_days`.

That engine is **module #12** (the recompute helper, shared with
payment-schedule recompute per Tech Arch §4). It reads:

- the project's `template_id`
- the project's `primary_date` (the "event date")
- the project's photographer assignments (to resolve `assignee_role`)

and writes the real PM-engine rows. Until that lands, templates are
inert: created, edited, but never realized.

## Relative-offset convention

`relative_offset_days` is an integer:

| Example task          | Offset | Meaning                   |
| --------------------- | -----: | ------------------------- |
| "Send welcome packet" |    −90 | 90 days BEFORE event date |
| "Confirm timeline"    |     −7 | 7 days BEFORE event date  |
| "Back up files"       |      2 | 2 days AFTER event date   |
| "Deliver sneaks"      |      5 | 5 days AFTER event date   |

The instantiation engine computes
`task.due_date = project.primary_date + offset_days` (in days).
On recompute (event-date change), it skips tasks whose
`due_date_overridden=true` per Tech Arch §4.

## What's here

- `schema.ts` — two tables. `blocked_by_template_item_id` is a self-FK
  ON DELETE SET NULL — deleting one item nulls the pointer on its
  dependents rather than cascading. Items hard-delete when the
  template hard-deletes (purge cron).
- `types.ts` — Zod schemas for 8 actions; `packageDefaults` and
  `paymentScheduleDefaults` schemas accept the V1 shape with future
  tightening by the invoices module.
- `queries.ts` — `listProjectTemplatesForOrg`, `listProjectTemplatesByType`,
  `getProjectTemplateWithItems` (template + ordered items, one shape
  for the future instantiation engine to consume),
  `listTemplateTaskItems`.
- `actions.ts` — 8 actions:
  - Template CRUD: `createProjectTemplate`, `updateProjectTemplate`,
    `deleteProjectTemplate` (soft), `restoreProjectTemplate`
  - Item CRUD: `addTemplateTaskItem`, `updateTemplateTaskItem`,
    `removeTemplateTaskItem` (hard)
  - `reorderTemplateTaskItems` (batched; mirrors
    `reorderPipelineStages`)

## Hard rules

1. **`blockedByTemplateItemId` must reference an item in the SAME
   template.** Cross-template blockers would be unresolvable at
   instantiation time (the engine creates one `tasks` row per
   `project_template_task_items` row, scoped to the in-flight project;
   a blocker pointing at another template's item has no corresponding
   task to point at). Validated in `addTemplateTaskItem` and
   `updateTemplateTaskItem` via `assertItemInTemplateAndOrg`.
2. **Self-block rejected at the Zod refinement** for
   `updateTemplateTaskItemInput`. `addTemplateTaskItem` doesn't need
   this check because the item's own id doesn't exist until after
   insert.
3. **No FKs to questionnaires / contract templates** in V1.
   `questionnaire_id` and `contract_template_id` are plain text;
   when those modules ship, they'll add FKs in a follow-up migration
   with `ON DELETE SET NULL`.
4. **`projectType` matches the projects module's enum.** The
   instantiation engine uses this to suggest templates to the user
   when creating a project of a matching type. Validated by re-using
   `projectTypeSchema` from `@/modules/projects/types`.

## What's deferred (named consumers)

- **Instantiation engine.** Module #12 — the recompute helper. Reads
  this module's data, writes to `tasks` / `task_dependencies` /
  `task_checklist_items` / `project_stages`.
- **Default seeded templates.** The spec doesn't require seeded
  templates in V1 — orgs configure their own. If onboarding wants
  starter templates, they land per-pack alongside the terminology
  seed.
- **`packageDefaults` / `paymentScheduleDefaults` schema tightening.**
  The Phase 3 invoices module will define the canonical shapes. For
  now these are loose Zod objects accepting the spec's vocabulary
  (split methods, due-date rules) with the integer-cents/basis-points
  discipline.
- **Default-workflow validation.** `defaultWorkflowIds` is a `text[]`
  with no FK; the Phase 4 workflow module will validate references
  when the user picks them.
- **Cycle detection on blockedByTemplateItemId** beyond
  self-reference. Same logic as tasks module — UI-side prevention
  for V1.
