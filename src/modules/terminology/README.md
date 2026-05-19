# terminology module

Per-org label pack. The UI never hard-codes object names like "Event" or
"Shoot" — it resolves them through this module so future vertical packs
(planner, videographer, venue) become configuration, not a codebase fork.
See Requirements §4.7 and Technical Architecture §2.1.

## What's here

- `schema.ts` — `terminology_map` table. `(organizationId, object_key)` is
  unique; `labelSingular` and `labelPlural` per row.
- `queries.ts` — `getTerminologyMap()` returns the full map for the active
  org; `getLabel(objectKey)` returns one tuple with a capitalized fallback.
- `seed.ts` — `seedTerminologyForOrg(db, orgId)`: idempotent insert of the
  V1 photographer pack.

## Hard rules

1. **No soft-delete columns.** This is a configuration table; rows aren't
   user-deletable in V1. Same precedent as `audit_log`. If V2 adds an admin
   UI for editing terminology, that migration adds `deletedAt`/`deletedBy`.
2. **RLS is enforced.** The migration that creates the table also enables
   FORCE ROW LEVEL SECURITY and adds an `organization_id = current_setting(...)`
   policy. Don't add cross-org reads to this module; they will return zero
   rows by design.
3. **UI never hard-codes labels.** Every user-facing string that refers to
   one of these objects reads from `getLabel()` or `getTerminologyMap()`.
   `"Event"` does not appear as a literal anywhere except this module's seed
   pack. Domain _values_ (e.g., "Engagement Shoot" as a session type) are
   data, not labels, and are NOT subject to this rule.
4. **`getLabel()` falls back; never throws.** A missing key logs a warning
   and returns the capitalized key (e.g., `"project"` → `{singular: "Project",
plural: "Projects"}`) so the page renders. If you see a fallback warning
   in logs, fix the seed pack — don't catch the warning.
5. **Seeding is idempotent.** Re-running `seedTerminologyForOrg` on a populated
   org is a no-op (relies on the `(organization_id, object_key)` unique index
   via `onConflictDoNothing`).

## How seeding gets called

- **Dev:** `scripts/seed.ts` calls `seedTerminologyForOrg(db, demoOrgId)`
  after creating the demo org. It runs with `DATABASE_URL_ADMIN` (BYPASSRLS),
  so the WITH CHECK constraint isn't a factor.
- **Production (TODO):** Better Auth's `organization` plugin needs a
  `afterOrganizationCreate` hook (or equivalent) that invokes
  `seedTerminologyForOrg` inside the new org's `orgAction` context so the
  WITH CHECK passes. Until that lands, freshly-created orgs in prod will
  have no terminology rows and labels will fall back to capitalized keys.
  Tracked alongside the rbac module's seeding.

## Conventions enforced here

- All reads via `withOrgContext` — never `db` directly. RLS is the safety
  net; the helper is the discipline that proves it ran.
- No `actions.ts` in V1. There's no user-facing mutation surface; the seed
  helper is dev/system code, not a server action.
- Pack content (`PHOTOGRAPHER_PACK` in `seed.ts`) is the single place V1
  terminology decisions live. Adding `task` ≠ shipping the tasks module —
  it just ensures a sane label is ready when that module lands.
