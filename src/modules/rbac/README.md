# rbac module

The 8-role + permission-override layer on top of Better Auth's
3-role organization model. Per Requirements §5.

## What's here

- `schema.ts` — two tables. `member_role` (one row per user per org)
  carries the extended role; `member_permission_override` (sparse) carries
  per-user grants/revokes against the role defaults.
- `types.ts` — `EXTENDED_ROLES` (8), `extendedToBetterAuth(role)` mapping,
  and `PERMISSION_KEYS` (the granular permissions from Requirements §5).
- `queries.ts` — `getExtendedMemberRole`, `hasPermission`, and
  `listMemberPermissionOverrides`. `ROLE_DEFAULTS` (the role → permission
  set baseline) lives here in code, not in DB.
- `seed.ts` — `seedMemberRoleForOrgOwner(db, orgId, userId)`. Idempotent.

## Better Auth coexistence (the Q5 decision)

Better Auth only knows three roles. We map ours onto theirs so its
internal plugin checks keep working:

| our role       | →   | BA `member.role` |
| -------------- | --- | ---------------- |
| owner          | →   | owner            |
| admin          | →   | admin            |
| manager        | →   | member           |
| photographer   | →   | member           |
| contractor     | →   | member           |
| editor         | →   | member           |
| accountant     | →   | member           |
| client_limited | →   | member           |

When the Phase 4 admin UI lets an admin change someone's role, the action
that ships with it must update **both** tables: `member_role.role` (our
extended) and Better Auth's `member.role` (the mapping). The
`extendedToBetterAuth` helper exists for this.

## RLS — two-policy pattern

Both tables enable FORCE ROW LEVEL SECURITY with TWO permissive policies:

1. **`*_org_select`** — `FOR SELECT USING (organization_id = current_setting(...))`.
   Any member of the org can read. A photographer can see who the admins
   are without being one.
2. **`*_admin_write`** — `FOR ALL` with `app.current_role IN ('owner', 'admin')`
   in both USING and WITH CHECK. Non-admins:
   - INSERT → rejected with a "row-level security" error
   - UPDATE → zero rows affected (USING denies; Postgres semantics, no error)
   - DELETE → zero rows affected (same)

The 10 negative tests in `tests/integration/rbac-rls.test.ts` exercise
both the org-isolation path and the admin-write gate, including the
self-escalation scenario (a photographer trying to UPDATE themselves to
owner — affects 0 rows).

## Bootstrap-trust: seeding the very first owner

The RLS write-gate requires `current_role` to be `owner|admin`. When an
org is just created, **there is no admin yet** — chicken-and-egg.

`seedMemberRoleForOrgOwner` is called from server-side trusted contexts
that assert `app.current_role='owner'` before inserting. Two callers:

- **Better Auth `afterCreateOrganization` hook** → via
  `src/lib/seed-new-org.ts`. By the time this fires, Better Auth has
  already verified the user authenticated themselves and is the creator
  of the new org.
- **Dev seed (`scripts/seed.ts`)** → connects as the BYPASSRLS admin
  role, so the gate doesn't apply at all.

**Do not call `seedMemberRoleForOrgOwner` from any user-controlled
route handler.** The bootstrap-trust assertion is only safe when the
caller is provably the creator of the org-being-seeded.

## Invitee role-seeding (afterAcceptInvitation)

Wired in `src/lib/auth.ts`. When a user accepts an invitation, the BA
hook fires `seedNewMember(orgId, userId, member.role)`.

This module operates at two layers, and the distinction is load-bearing:

### Layer 1 — Phase 4 invite UI (HARD REQUIREMENT)

When the admin UI ships (Phase 4 Settings module 4.34), the invite form
**MUST** require an explicit role selection before the "Send invite"
button is enabled:

- No default role on the form.
- "Send invite" is blocked/disabled until a role is explicitly chosen.
- No invite can be created or sent without a role.
- The form selects from the extended 8-role enum (manager, photographer,
  contractor, editor, accountant, etc.) — not the BA 3-role.
- The selected extended role is persisted on the invitation (custom
  column / metadata field) and read by `seedNewMember` directly when
  the invitee accepts.

This is to ensure every invitee gets their intended permissions — the
backend mapping below should never fire from the form path.

### Layer 2 — Backend defense-in-depth (V1 path; Phase 4 fallback)

In V1, Better Auth's invitation flow only carries the 3-role enum, so
`seedNewMember` derives the extended role from `member.role`:

| BA `member.role` | →   | extended role                                                 |
| ---------------- | --- | ------------------------------------------------------------- |
| owner            | →   | admin (defensive — only org creators are extended `owner`)    |
| admin            | →   | admin                                                         |
| member           | →   | photographer (productive default; an admin can promote later) |

**This mapping exists as a fail-safe fallback only**, for code paths
that reach `seedNewMember` without an explicit extended role:

- V1: the only path — the invite UI doesn't exist yet, so the mapping
  always runs.
- Phase 4+: bugs in the invite UI, future programmatic invite APIs
  that bypass the form, internal admin tools, BA core changes that
  reset the custom field, etc.

The fail-safe lands on the LOWEST productive role (`photographer`)
rather than failing closed (`hasPermission() === false`) because a
silently-permissionless invitee is harder to rescue than one who can
at least see contacts/events and ping an admin. **The fallback must
never be the normal path for an invite created through the UI.**

Each invitee lands with `hasPermission()` returning role-appropriate
results from day one. The seed is idempotent; re-firing the hook
(e.g., a rare BA retry) is a no-op via the (org, user) unique index.

## What's deferred

- **`afterRemoveMember` hook / cleanup.** When Better Auth removes a
  member, our `member_role` and `member_permission_override` rows for
  that user are orphaned. Queries that join through Better Auth's
  `member` hide them naturally, but the rows accumulate. The Phase 4
  admin UI's "remove member" action will handle cleanup; until then,
  orphans are harmless but cosmetic.
- **`app.current_role` is currently the Better Auth 3-role**, not the
  extended 8-role. The RLS policies that exist today only need
  owner/admin distinction, so this works. When financial-table RLS
  lands (Phase 2 invoices module), the layout's `runWithOrgContext`
  call and `orgAction` will need to set `app.current_role` to the
  extended role — at which point the `OrgContext.role` type must widen
  and both call sites refactor. Helper for that pre-ALS lookup:
  add a `lookupExtendedMemberRole(orgId, userId)` to `queries.ts`
  when the refactor lands.
- **Admin UI for editing roles + overrides.** Phase 4 Settings module 4.34.
- **`actions.ts`.** No user-facing mutations from this module in V1.
  Admin-only mutations land with the Phase 4 admin UI.

## Hard rules

1. **`member.role` (Better Auth) and `member_role.role` (us) must stay in
   sync.** Any code that updates one must update the other via
   `extendedToBetterAuth`.
2. **Bootstrap-trust is the only acceptable way to write an owner row
   when none exists.** Called only from `seedNewOrganization` (the
   org-create hook) or the dev seed. No exceptions.
3. **`hasPermission()` returns `false` for unknown users.** No
   member_role row → no permission → fail closed.
4. **`ROLE_DEFAULTS` is the source of truth for role-permission baselines.**
   Changing a role's defaults requires a code change reviewed in PR; it
   is not runtime-mutable.
5. **The invite UI (Phase 4) must hard-block sending without a role.**
   See "Invitee role-seeding" §"Layer 1" — the form must not allow a
   default and must not let "Send invite" fire until a role is
   explicitly chosen. The backend mapping is fail-safe, not normal
   flow; any code path that exercises the mapping from a UI-originated
   invite is a bug.
