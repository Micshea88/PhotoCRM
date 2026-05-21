# contacts module

The central record of the three-record data model (Contact / Project /
Opportunity) per Requirements §4.1 + §6.1. A Contact is the **person** —
permanent data that doesn't change between projects.

## What's here

- `schema.ts` — `contacts` table. 32 columns: name, contact channels
  (emails, phones, social, mailing address jsonb), dates (dob,
  anniversary), classification (`contact_type`, `lifecycle_status`,
  tags), associations (`company_id`, `referred_by_contact_id`,
  `owner_user_id`), notes (`notes`, `internal_notes`), `custom_fields
jsonb`, standard lifecycle.
- `types.ts` — Zod input schemas + the `CONTACT_TYPES` /
  `LIFECYCLE_STATUSES` enums. `mailingAddressSchema` for the jsonb
  shape.
- `queries.ts` — `listContactsForOrg`, `getContactForOrg` (with
  company join), `searchContactsByName` (typeahead with company name),
  `listContactsByCompany`, `listContactsByType`, `listContactsByTags`.
- `actions.ts` — `createContact`, `updateContact`, `deleteContact`
  (soft), `restoreContact`. Plus `assertCompanyInOrg` defensive check
  before insert/update.
- `display.ts` — `contactLabel(contact, companyName?)` per the
  mandatory disambiguation rule (Requirements §6.1).

## The "Name — Company" display rule (MANDATORY)

> Anywhere a contact appears in a list, picker, autocomplete,
> association field, or search result, the display is **"First Last
> — Company"** (falling back to "First Last — email" when there is no
> company, or "First Last" when neither). Two same-named contacts
> are always distinguishable at a glance without opening either
> record. This is a display rule, low cost, but it must be enforced
> consistently or the two-Kelly-Smiths problem persists in the UI
> even when the data is correct.
>
> Revised 2026-05-21 (P4.2 push 1) from the original "Last, First"
> ordering to natural reading order "First Last". Same dedup
> property, simpler phrasing. See PIVOTS_LEDGER §1 row for the
> canonical rule.

Implementation: `contactLabel` in `display.ts`. Pure function; the
caller resolves the `companyName` via `getContactForOrg` /
`searchContactsByName` (both already join companies) or
`getCompanyForOrg`. **Never construct a contact display string
inline** — always go through `contactLabel`. Lint cannot enforce
this; PR review must.

The 6 tests in `tests/integration/contacts.test.ts > contactLabel`
exercise every path including edge cases.

## RLS — org-isolation + assignment-scoped overlay

As of commit 14a (migration `0015_assignment_scoped_rls_overlay`; role
name updated to `user` in migration `0021_role_rename_to_user`), the
single `contacts_org_isolation` policy is replaced by four per-operation
policies (`contacts_select` / `contacts_insert` / `contacts_update` /
`contacts_delete`) that AND-clamp on the org-isolation predicate as the
OUTER condition, with an assignment-scope inner OR for the `user` tier:

| Probe role                                    | SELECT                                                                                                  | INSERT / UPDATE / DELETE |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------ |
| owner / admin / manager / accountant / client | All in-org contacts                                                                                     | All in-org contacts      |
| user (the standard team-member tier)          | Only contacts on projects the team member is assigned to (`project_photographers` ⋈ `project_contacts`) | **Blocked** at the gate  |

Empty / unset `app.current_role` is treated as a non-assignment-scoped
role (COALESCE to empty string). orgAction and runWithOrgContext both
always set the role explicitly; the COALESCE is for raw-pg test helpers
and defense-in-depth, not a production code path.

The org-isolation outer AND-clamp is the proof that the overlay cannot
loosen cross-org isolation — verified by the cross-org attack test in
`tests/integration/assignment-scoped-rls.test.ts` AND by the DO-block
probe inside the migration itself.

## P4.2 additions (this commit — push 1 of 4)

Three new schema tables related to contacts:

- **`contact_company_associations`** — many-to-many contact↔company
  with an optional free-form `role` text. The existing
  `contacts.company_id` stays as the "primary" company (fast-path
  indexed FK); additional roled associations go in this table. The
  detail-page Companies tab will render the primary on top + the
  association list below (UI ships in a later push).
- **`contact_notes`** — time-stamped notes for the activity feed. The
  legacy `contacts.notes` / `contacts.internal_notes` scalar columns
  stay in the schema for back-compat but the P4.2 UI writes only to
  `contact_notes`.
- **`call_log`** (in `src/modules/calls/`) — manual + future
  RingCentral. Manual entries get `source="manual"`, `external_id=null`.
  Partial unique on `(org, source, external_id) WHERE external_id IS
NOT NULL` prevents webhook dupes in the future integration.

Plus a new `faq_entries` table (in `src/modules/help/`) which is
**global** (no organization_id, no RLS) — seeded by the migration.

Mailing address Zod schema (in `types.ts`) was rewritten in this
commit to remove `country` and split `street` → `street1` + `street2`
per LOC1 (US-only).

## What's deferred (named consumers)

- **Activity timeline.** Sourced from notes + calls + messages /
  payments / workflow_executions / etc. The detail page renders it
  by querying those tables filtered to this contact_id. Notes + calls
  ship in P4.2 push 3; other sources land per consumer module.
- **Duplicate detection UI.** The `(organization_id, primary_email)`
  index is in place; the matching algorithm and merge flow are
  Phase 4 work.
- **Bulk operations** beyond bulk restore (tag, add to workflow,
  email, SMS, export, reassign owner). Phase 4.
- **CSV import + AI interpretation.** Own module — Phase 4.
- **Routes.** P4.2 pushes 2-4 ship: list (saved-views-powered), new,
  detail (5 tabs incl. inline editing), trash with bulk restore.

## Hard rules

1. **Always use `contactLabel` to render a contact's display string.**
   Never construct `${first} ${last}` inline; the disambiguation case
   (two same-named contacts at different companies) breaks silently
   when this rule is violated.
2. **The owner-user FK on a soft-delete cascade is ON DELETE SET
   NULL.** A user removed from the system leaves the contact intact
   but ownerless; reassign via the future admin UI.
3. **`referred_by_contact_id` is self-referential + ON DELETE SET
   NULL.** A referring contact being purged null-fills the pointer
   on the referred contact rather than cascading.
4. **`custom_fields` values are validated per-FieldType at write time.**
   `createContact` and `updateContact` look up
   `custom_field_definitions` for `record_type='contact'` and run each
   value through `validateCustomFieldsPayload` (in
   `src/modules/custom-fields/validators.ts`). A bad value throws
   `ActionError("VALIDATION")` with the field name; an unknown
   definition id is dropped with a log warning (handles the
   soft-deleted-between-render-and-submit case). When a future module
   ships its own `custom_fields` writes, it must follow the same
   pattern — there is no DB-side enforcement.
5. **Domain values are NOT subject to terminology resolution.**
   "Engagement Shoot" as a future event type, contact types like
   "Vendor"/"Active Client", lifecycle statuses like "Do Not Contact"
   — these are data values that don't change per-vertical. Only the
   _object_ labels go through `getLabel` (e.g., the page title
   "Contacts").
