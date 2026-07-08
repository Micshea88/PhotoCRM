# Task T1.2–T1.5 Report

## Status: DONE

## Commit Hashes (in implementation order)

| Sub-task | Commit    | Summary                                                              |
| -------- | --------- | -------------------------------------------------------------------- |
| T1.3     | `85d3b18` | feat(rls): add FORCE ROW LEVEL SECURITY to user_preferences          |
| T1.4     | `f5285c1` | fix(auth): fail CLOSED on null membership in page context and layout |
| T1.5     | `71e14cf` | feat(ci): add check-rls-force guard + correct 0041 invariant         |
| T1.2     | `c96afc6` | docs: require pgPolicy+FORCE in new-module scaffold                  |

## One-Line Test Summary

`pnpm verify --tier=2` passed (typecheck + lint + check-actions + **check-rls-force** + check-drizzle-drift + 92 unit tests (1192 assertions) + 100 integration test files + build); cross-user isolation test added for `user_preferences` under `app_authenticated`; null-member redirect unit test passes.

## Changes Made

### T1.3 — user_preferences FORCE RLS (migration 0062)

- Added `.enableRLS()` to `src/modules/user-preferences/schema.ts` so drizzle tracks RLS state in the snapshot
- Ran `pnpm db:generate` → produced `0062_dizzy_madame_web.sql` with `ENABLE ROW LEVEL SECURITY`
- Hand-appended `ALTER TABLE "user_preferences" FORCE ROW LEVEL SECURITY;` per AGENTS.md §10a
- `pnpm db:migrate` applied to local DB
- Added cross-user isolation test in `tests/integration/rls-tenant-tables.test.ts`: seeds a user B preference row, switches `app_authenticated` context to user A, asserts 0 rows visible via the user-scoped RLS policy

### T1.4 — Fail CLOSED on null membership

**`src/lib/page-org-context.ts` (lines 56-57):** Replaced `const baRole = (memberRow?.role ?? "member") as BetterAuthRole` with an explicit null check:

```ts
if (!memberRow) redirect("/onboarding/create-organization")
const baRole = memberRow.role as BetterAuthRole
```

**`app/(app)/layout.tsx` (line 77-78):** Same fix applied — layout path now also redirects when memberRow is null, matching orgAction's FORBIDDEN throw on non-membership.

**Test:** `tests/unit/page-org-context.test.ts` — focused unit test mocking `getCurrentMember` to return null, asserting `withPageOrgContext` throws the redirect error and never invokes the page callback. Integration test is impractical (requires full cookie/session machinery → E2E territory); noted in the test file.

**App layout coverage:** CONFIRMED — both `src/lib/page-org-context.ts` (used by individual pages) AND `app/(app)/layout.tsx` were fixed. No org data is served before the redirect in either path.

### T1.5 — check-rls-force CI guard

**`scripts/check-rls-force.mjs`:** New script modeled on `check-actions.mjs` that:

1. Walks all `src/modules/<name>/schema.ts` files
2. For each `pgTable(...)` declaration, checks if the column block contains `"organization_id"` (the SQL column name)
3. Exempts Better-Auth tables: `user`, `organization`, `member`, `session`, `account`, `verification`, `invitation`
4. For each org-bearing table, greps `src/db/migrations/*.sql` for `ALTER TABLE "name" FORCE ROW LEVEL SECURITY`
5. Exits 1 listing any table missing FORCE

**`scripts/verify.mjs`:** Added `check-rls-force` to TIER1 immediately after `check-actions`. It runs on every `pnpm verify --tier=1` (pre-commit hook) and tier=2 (CI).

**Failure path verified:** Created a fake `src/modules/test-no-force/schema.ts` with an `organization_id` column and no FORCE migration → script exited 1 and listed the offender with actionable instructions. The fake module was not committed.

**Current state:** script checks 46 org-bearing tables, all pass (FORCE present in migrations).

**`docs/multi-tenant-remediation-plan.md` §T1.5:** Added STATUS note recording that the 0041 invariant is now actually true as of migrations 0061+0062, and that `check-rls-force` is the durable enforcement.

### T1.2 — Scaffold documentation

**`src/modules/items/schema.ts`:** Already has `pgPolicy` org-isolation + `.enableRLS()` from T1.1 (migration 0061). No change needed — it's the copy source.

**`AGENTS.md` "Adding a new feature":** Inserted step 5 — "Declare RLS (MANDATORY)" — between the per-module list update and `db:generate`. Renumbered subsequent steps. Explains pgPolicy pattern, FORCE requirement, and that `check-rls-force` catches omissions.

**`.claude/skills/add-module/SKILL.md`:** Expanded step 6 with explicit RLS + FORCE instructions and link to `items/schema.ts` as the canonical pattern.

**`.claude/commands/new-module.md`:** Added two checklist items for `pgPolicy + .enableRLS()` and `FORCE ROW LEVEL SECURITY` hand-append, noting that `pnpm verify --tier=2` catches forgetting.

## Concerns

None significant. One clarification:

- **T1.4 test is a unit test, not integration:** The brief flagged this as acceptable. A full integration test for the null-member redirect would require cookie + session infrastructure (E2E territory). The unit test mocks `getCurrentMember` → null and asserts the redirect fires before any page callback is invoked — which is the exact invariant the fix establishes.

- **`file_scan_diagnostics` not covered by check-rls-force:** Uses `org_id` (not `organization_id`) so falls outside the check's scope. Already has FORCE from migration 0061 and is covered by `rls-tenant-tables.test.ts`. Documented in the script's header comment.

## check-rls-force confirmation

- **Passes on fixed tree:** YES — 46 org tables, all have FORCE (`pnpm verify --tier=1` passed)
- **Failure path verified:** YES — temporary fake module with `organization_id` column + no FORCE migration → exit 1 with clear error message listing the offender (not committed)
- **Wired into tier-1:** YES — runs next to `check-actions` in `scripts/verify.mjs`

## Membership fail-closed coverage

- **`src/lib/page-org-context.ts`:** COVERED — redirects to `/onboarding/create-organization` when memberRow is null; never reaches role assignment or page callback
- **`app/(app)/layout.tsx`:** COVERED — same redirect when memberRow is null; no org data rendered
- Both paths now match `orgAction`'s FORBIDDEN throw for non-membership
