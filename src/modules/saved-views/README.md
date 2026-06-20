# saved-views module

The universal saved-query engine per Requirements §4.11. Every list view
in the app — Contacts, Events, Opportunities, Tasks, Companies — reads
from this engine.

> "Vendor Matrix and Team This Week are both just saved-view
> configurations, not bespoke features."

## What's here

- `schema.ts` — one `saved_views` table. Loose jsonb for `filters`,
  `sort`, `visible_columns`, plus a `grouping` text column.
- `types.ts` — `SAVED_VIEW_OBJECT_TYPES` enum, `FILTER_OPS`, Zod
  schemas for the 5 actions, canonical `Filter` and `Sort` shapes.
- `queries.ts` — `listSavedViewsForObject(objectType, userId)`,
  `getSavedViewForUser`, `listSharedSavedViews`, `listMySavedViews`,
  `listAllSavedViewsForOrg` (admin helper). All apply the
  owner-or-shared visibility filter at the queries layer.
- `actions.ts` — 5 actions: `createSavedView`, `updateSavedView`,
  `deleteSavedView` (soft), `restoreSavedView`, `duplicateSavedView`.
  Owner-only mutations.

## Visibility model (Push 2b — 3-tier, enforced at DB)

| `visibility`   | Visible to                                          |
| -------------- | --------------------------------------------------- |
| `private`      | Owner only                                          |
| `shared_users` | Owner + every user in `shared_with_user_ids text[]` |
| `org`          | Every member of the org                             |

System defaults (`owner_user_id IS NULL AND is_default = true`) bypass
the visibility filter — they're always visible to every org member.

**RLS enforces visibility at the database layer** using
`current_setting('app.current_user_id')`. The SELECT policy has four
branches: owned / org / shared-with-me / system-default. The
INSERT/UPDATE/DELETE policies are scoped to "own views only," with an
explicit carve-out for the seed path so null-owner system defaults can
be inserted from `seedDefaultSavedViewsForOrg`.

`app.current_user_id` is set by `runWithOrgContext` (page renders) and
by `safe-action` (mutations). The test harness's `setOrgContext`
accepts a `userId` arg.

## Mutation policy — owner-only writes

| Action               | Authorized                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| `createSavedView`    | Any org member (owner auto-set)                                                   |
| `updateSavedView`    | Owner only — throws FORBIDDEN otherwise                                           |
| `deleteSavedView`    | Owner only                                                                        |
| `restoreSavedView`   | Owner only                                                                        |
| `duplicateSavedView` | Anyone who can see the source (own or shared); clone is private + owned by caller |

Admins do not override in V1. The Phase 4 settings module can add an
admin override action if needed.

## Canonical filter / sort shapes

`filters jsonb` is an array of:

```ts
{ field: "contactType", op: "eq", value: "Vendor" }
```

`op` values supported in V1:

`eq` `ne` `gt` `gte` `lt` `lte` `in` `not_in` `contains`
`starts_with` `ends_with` `is_null` `is_not_null`

`sort jsonb` is either:

```ts
{ field: "lastName", direction: "asc" }
```

or an array of those for multi-column sort (max 8 columns).

`column_config jsonb` is an array of `{id, visible, order, width}`
entries. Replaces the legacy `visible_columns text[]` in Push 2b — the
new shape carries column order + per-column width in addition to
visibility. The list-view renderer in each module owns its column
registry; the saved-view persists only the per-column tweaks.

`grouping` is a single column key (text) or null. Multi-column
grouping is not in V1.

## Vendor Matrix and Team This Week (as saved-view configs)

Per Requirements §4.10 + §4.11 — these are deliberately not bespoke features:

```
Vendor Matrix:
  object_type: "contact"
  shared:       true
  filters:      [{ field: "contactType", op: "eq", value: "Vendor" }]
  visibleColumns: ["firstName", "lastName", "company", "category",
                  "primaryEmail", "primaryPhone", "instagramHandle"]
  grouping:     "category"

Team This Week:
  object_type: "task"
  shared:       true
  filters:      [{ field: "dueDate", op: "gte", value: "<startOfWeek>" },
                 { field: "dueDate", op: "lte", value: "<endOfWeek>" }]
  sort:         { field: "dueDate", direction: "asc" }
  visibleColumns: ["assigneeUserId", "title", "dueDate", "status", "priority"]
  grouping:     "assigneeUserId"
```

**Team This Week is now SEEDED** by this module (Phase 2). Its column
keys (`assigneeUserId`, `title`, `dueDate`, `status`, `priority`) all
exist on the tasks schema today, so the prior "seeding-would-couple-to-
nonexistent-keys" concern doesn't apply. See `seed.ts` —
`seedDefaultSavedViewsForOrg` is wired into `seedNewOrganization`
(production BA hook) and `scripts/seed.ts` (dev).

Vendor Matrix is NOT yet seeded — its column keys (`primaryEmail`,
`primaryPhone`, `instagramHandle`, `company`) reference contact fields
that exist, but until the contacts list-view renderer ships and confirms
the final column-key spelling, seeding it would risk a key/renderer
mismatch. Land Vendor Matrix in the contacts list-view module commit.

### Seeded-default semantics (the `is_default` + null-owner pattern)

The seeded Team This Week row is special-shaped:

| Column          | Value          | Effect                                                                                                                       |
| --------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `owner_user_id` | `NULL`         | Owner-only mutation rule (`assertOwnsSavedView`) throws FORBIDDEN for any caller — the seeded default is IMMUTABLE           |
| `shared`        | `true`         | Visible to every member of the org                                                                                           |
| `is_default`    | `true`         | Marker for the list-view renderer to pin it / distinguish from user-created views                                            |
| (mutation)      | (none allowed) | Users who want a tweaked variant call `duplicateSavedView` — clone is private + owned by caller (standard V1 customize path) |

Date-window filters use the placeholder strings `<startOfWeek>` /
`<endOfWeek>`. The list-view renderer (Phase 4) resolves them at render
time against the caller's timezone — storing concrete dates at seed
time would freeze the window to org-create day. When that resolver is
built it **must** use the ISO 8601 Monday–Sunday week (Mike,
2026-06-20), matching `resolveMondaySundayWeek` in `src/lib/format` —
do not reintroduce a Sunday-start week.

### Idempotency

The partial unique index on (org, owner_user_id, object_type, name) is
ineffective for null-owner rows (Postgres treats NULL as distinct in
unique indexes by default). The seed uses an explicit existence check
on (org, object_type, name, is_default=true, owner_user_id IS NULL,
deleted_at IS NULL) instead of `onConflictDoNothing`.

## Hard rules

1. **`shared=true` is org-wide visibility.** A shared view can be
   read by every member of the org. Don't introduce per-user share
   targeting in V1; if a user needs a one-off view they create their
   own private view.
2. **Owner-only mutations.** Even admins do not override in V1.
   `duplicateSavedView` is the V1 workaround for "I want to customize
   someone else's shared view."
3. **The DB does not enforce the owner-vs-shared boundary** — only
   queries.ts does. Any code path that reads `saved_views` directly
   must apply the visibility filter manually. The `listAllSavedViewsForOrg`
   helper is the documented admin-only escape hatch.
4. **Filters / sort / visibleColumns are loose jsonb.** The renderer
   per object type is the source of truth for what fields and ops
   are valid. The action validates the SHAPE (filter has field/op),
   not the SEMANTICS (op valid for field-type). The renderer
   degrades gracefully on unknown ops — displays "filter ignored"
   rather than crashing.

## What's deferred

- **Per-user-targeted sharing.** Right now `shared` is org-wide; if
  V2 needs "shared with this team" the policy moves to a junction
  table.
- **Default-view seeding.** Phase 4 list-view renderers seed sensible
  defaults when they ship.
- **Move filter / sort / grouping validation** from "loose jsonb +
  graceful degradation" to "strict per-object-type validation."
  Lands with each list-view renderer.
