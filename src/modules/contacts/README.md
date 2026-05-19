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
> association field, or search result, the display is **"Last, First
> — Company"** (falling back to "Last, First — email" when there is no
> company, or "Last, First" when neither). Two same-named contacts
> are always distinguishable at a glance without opening either
> record. This is a display rule, low cost, but it must be enforced
> consistently or the two-Kelly-Smiths problem persists in the UI
> even when the data is correct.

Implementation: `contactLabel` in `display.ts`. Pure function; the
caller resolves the `companyName` via `getContactForOrg` /
`searchContactsByName` (both already join companies) or
`getCompanyForOrg`. **Never construct a contact display string
inline** — always go through `contactLabel`. Lint cannot enforce
this; PR review must.

The 6 tests in `tests/integration/contacts.test.ts > contactLabel`
exercise every path including edge cases.

## RLS — single org-isolation policy in V1

Same shape as companies. `app.current_role` is not consulted. Any
member of the org can read and write all contacts.

**Deferred — Phase 4 (invoices module triggers it):** the
photographer / contractor / editor roles should only see contacts
they're assigned to (via `project_photographers` / `project_contacts`,
which exist in a later Phase 2 module). When those tables ship, a
second permissive policy joins to them and restricts visibility for
the assignment-scoped roles. The current policy stays as the baseline
for owner/admin/manager/accountant. See the rbac README's "What's
deferred" §3.

## What's deferred (named consumers)

- **Activity timeline.** Sourced from messages / payments /
  workflow_executions / etc., not a separate table. The detail page
  renders it by querying those tables filtered to this contact_id.
  Lands per consumer module.
- **Duplicate detection UI.** The `(organization_id, primary_email)`
  index is in place; the matching algorithm (email / phone / name+
  address) and merge flow are Phase 4 work (Requirements §6.1).
- **Bulk operations** (tag, add to workflow, email, SMS, export,
  delete, reassign owner). Phase 4 — needs a list-view UI first.
- **CSV import + AI interpretation.** Requirements §6.27. Whole
  module (4.27); lands in Phase 4.
- **Routes.** No `/contacts` page yet. Lands in Phase 2 when the
  saved-views engine is built — both ship together because the
  contacts list IS a saved-view configuration per Requirements
  §4.11.

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
