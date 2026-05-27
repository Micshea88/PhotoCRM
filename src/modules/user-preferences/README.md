# user_preferences

Push 3 (C2) — generic key/value preference store, user-scoped with
optional org scoping. Backs the sidebar collapse state today and is the
foundation for future per-user UI prefs (saved-view defaults, density,
column-width memory, etc.).

## Shape

`user_preferences (id, user_id, organization_id?, key, value jsonb,
created_at, updated_at)`.

- `organization_id` is **nullable**. NULL = the pref is global to the
  user across orgs (UI prefs that should follow the user regardless of
  which workspace they switch into). When set, the pref is scoped to a
  single org.
- Uniqueness is split into two partial indexes so the NULL-org case is
  portable across PG versions (no reliance on `NULLS NOT DISTINCT`).
- No soft-delete columns. Prefs are recreated as needed.

## RLS

Enabled in migration `0033_push3_c2_user_preferences.sql`. Policies
scope SELECT/INSERT/UPDATE/DELETE to
`user_id = current_setting('app.current_user_id', true)`. orgAction /
authAction set that GUC alongside `app.current_org`, so existing
write paths continue to work without changes.

## Reads

- `getUserPreference(key, organizationId?)` — ALS-based; for use from
  RSC page loaders / server components after a `runWithOrgContext`
  scope is established.
- `getUserPreferenceWithDb(tx, userId, key, organizationId?)` —
  parametric; for use from inside orgAction transactions (mirrors the
  A3 hotfix pattern in `custom-fields/queries.ts`).
- `listUserPreferences(organizationId?)` — bulk read for a single
  user/org pair.

## Writes

- `setUserPreference({ key, value, organizationId? })` — upserts. The
  zod input schema validates `value` against the per-key value schema
  in `types.ts:userPreferenceValueSchemas`.
- `deleteUserPreference({ key, organizationId? })` — drops the row.

Both actions emit an audit log entry
(`user_preferences.set` / `user_preferences.deleted`) — required by
hard rule #5. Metadata kept light because nav-toggle can fire often;
the audit row is still useful for forensic "when did this user
flip nav state" lookups.

## Adding a new key

1. Add the key string to `USER_PREFERENCE_KEYS` in `types.ts`.
2. Add the corresponding zod value schema to
   `userPreferenceValueSchemas`.
3. The consumer reads via `getUserPreference("your_key", ...)` and
   should parse the returned `unknown` through its own zod schema for
   type safety at the call site.

No migration needed — the storage is jsonb.
