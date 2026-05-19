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

## Visibility model

| Row state                  | Visible to              |
| -------------------------- | ----------------------- |
| `shared = true`            | Every member of the org |
| `shared = false` (private) | The owner only          |

The DB RLS policy is **org-isolation only** — the owner-vs-shared
filter is applied at the queries.ts layer. Why: pushing
`current_user_id` into the RLS session settings would require another
`set_config` call in every `withOrgContext` / `orgAction`. V1 carries
`app.current_org` + `app.current_role` only; the user-id-aware filter
lives in queries. Phase 4 may extend if a hard-policy boundary is
needed.

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

`visible_columns jsonb` is a string array of column keys per the
object type's column registry (defined by the list-view renderer in
each module).

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
time would freeze the window to org-create day.

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
