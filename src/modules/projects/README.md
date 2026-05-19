# projects module

The central engagement record — **stored as `projects`, displayed as
"Event"**. Per Requirements §4.1 + §6.2, Tech Arch §2.2, Build Spec §2.
This is the locked architecture decision from STEP 2 (a) — the schema
must never say "shoot" or "event" at the object level; only display
strings resolve through `terminology_map`.

## What's here

- `schema.ts` — 4 tables. `projects` (the engagement) + 3 sub-tables
  (`project_contacts`, `project_photographers`, `project_sub_events`).
  Money fields are integer cents; percentages are integer basis points.
  Venue coordinates as jsonb `{lat, lng}`, not pg `point`.
- `types.ts` — enums for `PROJECT_TYPES`, `PROJECT_LIFECYCLE_STATUSES`,
  `DISCOUNT_TYPES`, `TAX_SIGNS`, `PROJECT_CONTACT_ROLES`,
  `PHOTOGRAPHER_ROLES`, `CONFIRMATION_STATUSES`, `SUB_EVENT_TYPES`.
  Zod schemas for ~12 actions.
- `queries.ts` — `listProjectsForOrg`, `getProjectForOrg` (with all 3
  relations), `listProjectsByLifecycle`, `listProjectsByPhotographer`,
  plus targeted relation queries.
- `actions.ts` — 12 actions: 4 CRUD on projects, 2 contact-association,
  3 photographer-assignment (add/remove/confirm), 3 sub-event
  (add/update/remove). Defensive checks for cross-org refs on every
  association action.

## Money discipline

All money lives in `*_cents` integer columns. All percentages live in
`*_bps` integer columns (basis points; 8.25% = 825 bps). The reasoning
is Tech Arch §4: **"Integer-cents internally, never float."**

V1 schema today STORES these fields. The COMPUTATION (subtotal, tax
amount, total) lands with the invoices module's recompute engine
(Tech Arch §4 — payment-schedule + task-plan share one helper). Until
then `subtotal_cents`, `tax_amount_cents`, `total_value_cents` stay
null.

`discount_value` interpretation depends on `discount_type`:

| discount_type | discount_value               |
| ------------- | ---------------------------- |
| 'none'        | ignored (typically null)     |
| 'percent'     | basis points (1500 = 15.00%) |
| 'flat'        | cents                        |

## Anniversary auto-derivation

When `project_type='Wedding'` AND the caller doesn't pass an explicit
`anniversaryDate`, `createProject` sets it to the project's
`primaryDate`. The action keeps an explicit override if provided;
non-Wedding types pass through whatever the caller sent (typically
null). This is in `actions.ts`, not the DB — a future override case
(e.g., re-vow renewals) wouldn't fight a trigger.

## Sub-tables — no soft-delete

`project_contacts`, `project_photographers`, `project_sub_events` are
join/sub records that hard-delete when the association ends. The
audit log captures every add/remove. Soft-delete on join tables would
mean two query paths (active vs. tombstoned associations) for no
operational gain — the spec doesn't ask to surface "who used to be
assigned to this event" as a feature.

FK cascade strategy:

| FK                                      | ON DELETE |
| --------------------------------------- | --------- |
| project_contacts.project_id             | CASCADE   |
| project_contacts.contact_id             | RESTRICT  |
| project_photographers.project_id        | CASCADE   |
| project_photographers.user_id           | CASCADE   |
| project_sub_events.project_id           | CASCADE   |
| project_sub_events.photographer_user_id | SET NULL  |

RESTRICT on `contact_id` means a contact with active project
associations can't be hard-deleted by the purge cron — you must
dissociate first. (Soft-deleting the contact still works; the
association just points at a tombstoned contact until the cron skips
that contact too.)

## RLS — org-isolation + assignment-scoped overlay (as of commit 14a)

The `projects` table now carries four per-operation policies
(`projects_select` / `projects_insert` / `projects_update` /
`projects_delete`) replacing the single `projects_org_isolation`
policy. Per migration `0015_assignment_scoped_rls_overlay`:

- Owner / admin / manager / accountant / client_limited: full
  org-scoped read + write (unchanged).
- Photographer / contractor / editor: **read** only projects they
  are assigned to (via `project_photographers.user_id`); **write**
  blocked entirely.

The three sub-tables (`project_contacts`, `project_photographers`,
`project_sub_events`) continue to use their original single
org-isolation policy. The overlay scopes through them via JOINs but
their own policies are unchanged.

The org-isolation predicate is the OUTER AND-clamp on every new
projects policy, so the overlay cannot loosen cross-org isolation —
proven by the cross-org attack test in
`tests/integration/assignment-scoped-rls.test.ts` and by the DO-block
probe inside the migration.

## Hard rules

1. **Money is integer cents. Percentages are integer basis points.**
   No floats anywhere. The recompute engine when it lands will assume
   this invariant; a stored `numeric` would force a rewrite.
2. **The schema object name is `projects`. The UI label is "Event."**
   `terminology_map` resolves the label. Don't grep for "shoot" or
   "event" in code; the seed pack maps `project → "Event"`.
3. **Sub-tables hard-delete. Only `projects` itself has soft-delete.**
4. **Every association action defensively checks cross-org refs.**
   RLS would block them anyway, but a clear `VALIDATION` error beats
   "you submitted a real id but got zero rows back."
5. **The kanban view does NOT live here.** It's a future module (4.3
   Pipeline + Kanban) that reads `pipelines` + `pipeline_stages`
   from the pipelines module and overlays `opportunities` (when that
   ships) on top. Projects are referenced from opportunities, not
   stored on the kanban.

## What's deferred

- **Recompute engine** — payment-schedule + task-plan share one
  helper that fills `subtotal_cents`, `tax_amount_cents`,
  `total_value_cents`. Lands with the invoices module per Tech Arch §4.
- **Sun-calc fill** — `sun_data jsonb` is null until the sun-calc
  module (Phase 2 module 4.20) reads `primary_venue_coordinates` +
  `primary_date` and writes sunrise/sunset/golden hour.
- **Geocoding fill** — `primary_venue_coordinates` is null until the
  geocoder runs against `primary_venue_address`. Phase 2.
- ~~**Assignment-scoped RLS overlay**~~ — **CLOSED** in commit 14a (migration
  `0015_assignment_scoped_rls_overlay`). Photographer/contractor/editor now
  see only projects they're project-photographer-assigned to, and only the
  contacts on those projects. See "RLS" section above.
- **Opportunities** — the per-pipeline tracking records that point at
  a project. Next Phase 2 module.
- **Tasks + dependencies + checklists** — Phase 2, sits on top of
  projects via `task.project_id`.
- **Templated task plans / instantiation engine** — Phase 2 (4.30).
  `projects.template_id` is the breadcrumb.
