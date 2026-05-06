# org module

The organization primitive. Every authenticated request resolves an
`activeOrg` (via `orgAction`) and product modules scope all reads/writes by
`organizationId`. Better Auth's `organization` plugin owns the underlying
tables (in `src/modules/auth/schema.ts`); this module exposes queries and
helpers on top.

## What's here

- `queries.ts` — read helpers for "list orgs the user is in", "get org by
  slug", "get current member's role", etc.
- `ui/` — sidebar / org-switcher components (if present).

## Hard rules

- **Org membership is checked by `orgAction` in `src/lib/safe-action.ts`.**
  Don't re-implement the check in product modules — call `orgAction` and
  trust `ctx.activeOrg.id`.
- **Don't expose role-elevation actions from product modules.** Role changes
  go through Better Auth's `organization.invite-member` / `update-member-role`
  endpoints.
- **`onDelete: "restrict"` on every product table's `organizationId` FK.**
  Org deletion is intentionally hard — there's no "delete org" path right
  now, because cascading delete across many product tables is the kind of
  destructive operation that should be deliberate, not reflexive.

## Active org

`ctx.session.session.activeOrganizationId` is the source of truth. It's set
by `auth.setActiveOrganization(...)` and persists across sessions for the
user. The `(app)/onboarding/` flow handles "I have no active org yet".
