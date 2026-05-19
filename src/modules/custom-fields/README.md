# custom-fields module

The custom-fields engine. Definitions live in `custom_field_definitions`;
values live on each host table's `custom_fields jsonb` column, keyed by
the definition's `id`. Per Requirements §4.3 and Build Spec §2.

## What's here

- `schema.ts` — `custom_field_definitions` table. Soft-delete standard.
  Partial unique index on `(organization_id, record_type, name)` filtered
  to `deleted_at IS NULL` so deleting and recreating a field by the same
  name works.
- `types.ts` — `FIELD_TYPES` (the 18 V1 types), `fieldTypeSchema` (Zod
  enum), `fieldOptionsSchema` (the shape of `options jsonb`),
  `customFieldDefinitionInput` (validated CRUD shape for the future admin
  UI).
- `queries.ts` — `listFieldDefinitionsForRecordType(recordType)` returns
  ordered definitions for one record type; `getFieldDefinition(id)`
  resolves a single definition for value validation.

## Architecture (read this before touching values)

- **Definitions:** rows in `custom_field_definitions`. One row = one field
  on one record type on one org. Keyed by `id` (cuid2).
- **Values:** in each host table's `custom_fields jsonb`. Shape:
  `{ "<definition_id>": <value> }`. The jsonb key is the definition's
  `id`, NOT the definition's `name`. This is the right call because:
  1. Names can change; `id` doesn't.
  2. Definitions can be soft-deleted; their `id` is the stable backreference.
  3. Two same-name fields on different record types coexist trivially.
- **Validation:** host modules' `actions.ts` are responsible for validating
  their `custom_fields` payload against the org's definitions. This module
  exposes the lookup helpers (`getFieldDefinition`); a shared
  `validateCustomFieldValue(def, value)` helper will land here when the
  first host module (contacts) needs it.

## Hard rules

1. **The jsonb key is the definition `id`.** Never use `name` or `slug`.
   Renaming a field doesn't rewrite host rows; deleting a field doesn't
   strand keys (they just stop resolving).
2. **RLS is enforced.** Migration 0005 enables FORCE ROW LEVEL SECURITY +
   `organization_id = current_setting('app.current_org', true)`. Cross-org
   reads return zero, cross-org writes are rejected by WITH CHECK. Negative
   tests live in `tests/integration/custom-fields-rls.test.ts` — 4/4 pass.
3. **`field_type` is `text`, validated by Zod, not a pg enum.** Adding the
   19th field type later is just a Zod enum update + app code; no migration
   needed. The 18 V1 types are listed in `types.ts:FIELD_TYPES`.
4. **`formula` text lives on the row; no evaluator in V1.** Storing the
   expression now means future evaluator work is additive. Reading a
   formula-typed value before the evaluator ships should be a no-op or a
   clearly-flagged placeholder — not an error.

## What's deferred (do not add these without explicit scope)

- **Admin UI for editing definitions.** Phase 4 Settings module 4.34.
- **Formula evaluator.** STEP 2 Q8 flagged this as a Phase 4 stretch.
  Adding it requires: expression parser, type system, dependency tracking
  for recompute on input change, cycle detection. Substantial.
- **Per-host-table validation helpers.** A `validateCustomFieldValue(def,
value)` helper that maps each `FieldType` to a Zod schema lands when the
  contacts module ships and needs it. Until then, this module is read-only
  to the rest of the codebase.
- **`actions.ts`.** No user-facing mutations in V1 from this module. When
  the admin UI lands, its server actions go in Phase 4's settings module
  (or — if simpler — in `src/modules/custom-fields/actions.ts` with
  `.use(adminGuard)` middleware).
