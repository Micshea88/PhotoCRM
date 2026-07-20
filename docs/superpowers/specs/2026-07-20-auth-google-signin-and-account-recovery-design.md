# Auth: Google sign-in + account-recovery — design

**Date:** 2026-07-20
**Status:** proposed (awaiting owner review)
**Branch:** `feat/auth-google-signin-and-recovery`

## Why

Bring Pathway's auth to **parity with what CRM/PM competitors actually ship** — no more, no less
(researched 2026-07-20; photo-CRM field is ~a decade behind mainstream, so parity already leads it).
Two concrete gaps to close:

1. **Social login** — competitors that offer it (Dubsado, HoneyBook) do **Google**. We do Google now.
2. **Back-end account recovery** — none of our competitors document this, but it's a real support need:
   a locked-out user has no path today except self-serve email. Build two levels of recovery.

## Scope

Three self-contained pieces, built in order (A → B → C), likely three small PRs.

- **A. Google sign-in.**
- **B. Team-member recovery** — a studio owner/admin can recover their own team member.
- **C. Owner recovery** — Pathway staff can recover a fully-locked-out account owner (cross-tenant).

## Non-goals (explicitly out — parity, not gold-plating)

- **No Apple / Microsoft** social login (Google only for now).
- **No MFA / TOTP / passkeys** (deferred by owner 2026-07-20; defers policy #11 MFA baseline — a
  deliberate decision).
- **No enterprise SSO / SAML / SCIM.**
- **No impersonation** and **no user-facing session/device-manager or login-history UI** (recovery may
  _revoke_ sessions, but we do not build a session browser).

## Current state (verified 2026-07-20)

- Better Auth (`src/lib/auth.ts`), plugins: `organization` only. Email/password (min 8), email
  verification, self-serve password reset (`sendResetPassword` → Resend), built-in rate limiter.
- Client (`src/lib/auth-client.ts`): `organizationClient()` only.
- Reset infra exists: `authClient.requestPasswordReset` (`forgot-password-form.tsx`) → `sendResetPassword`.
- Members surface exists: `settings/organization/members/page.tsx`, `members-list.tsx`, `invite-member-form.tsx`.
- No `admin` plugin, no superadmin concept, no lockout/ban/recovery tooling.

---

## A. Google sign-in

**Google is an OPTIONAL alternate, not a replacement.** Email + password (Better Auth `emailAndPassword`,
where the email is the login identifier — no separate "username" field, matching every competitor) remains
the default login and stays exactly as it is today. Google sign-in is an additional "Continue with Google"
option; a user who declines Google just signs up / signs in with email + password. Nothing about the existing
email/password flow is removed or changed.

**Server** (`src/lib/auth.ts`): add

```ts
socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
```

**Env** (`src/lib/env.ts`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (both `.optional()` so local/dev without
them still boots; the button is shown only when configured).

**Account linking (security-critical).** Configure Better Auth account linking to link a Google login to
an existing email/password user **only when the email is verified** (`account.accountLinking.trustedProviders`
with verified-email requirement). This prevents hijacking an existing account via a Google identity whose
email we haven't proven.

**Client** (`sign-in-form.tsx`, `sign-up-form.tsx`): a "Continue with Google" button →
`authClient.signIn.social({ provider: "google", callbackURL: "/dashboard" })`. Core feature — no client plugin.

**Onboarding.** A brand-new Google user has no organization. The post-login redirect must send a session
with no active org into the existing `/onboarding/create-organization` flow (same as a fresh email signup).
Verify the middleware/redirect (`proxy.ts` / dashboard guard) already routes org-less sessions there; if not,
add that branch. No new onboarding UI.

**Owner ops (not code):** create an OAuth 2.0 Client ID in Google Cloud Console (authorized redirect URI =
`<app-url>/api/auth/callback/google`), set the two env vars in Vercel.

**Test (LAW 7):** an integration/e2e assertion that a Google sign-in with a **verified** email matching an
existing user links to that user (one user row, not two); and that an org-less social session lands on
create-organization. Unit-cover the account-linking config choice.

---

## B. Team-member recovery (in-tenant; owner/admin → their own team)

**Enable** Better Auth `admin` plugin (server) + `adminClient()` (client).

**New org-scoped actions** in `src/modules/org/actions.ts` (or a new `account-recovery` area), each:
`orgAction` gated to **owner/admin**, `.inputSchema(...)`, and **verifies the target user is a member of the
actor's active org** before doing anything, and calls `audit()`:

- `sendMemberPasswordReset` — trigger a fresh reset email to the member **and** return a copyable one-time
  reset link the owner can relay out-of-band (covers "the reset email isn't arriving / lost inbox access").
- `revokeMemberSessions` — sign the member out everywhere (compromise / departed).
- `resendMemberVerification` — re-send verification if their email is unverified.

**Guardrail.** The in-org membership check is the isolation boundary — an owner can never act on a user in
another studio. The admin-plugin primitives are only ever called after that check passes.

**UI.** A per-row "⋯" menu on `members-list.tsx`: _Send password reset_, _Revoke sessions_, _Resend verification_,
each behind a confirm. Shown only to owner/admin.

**Test (LAW 7):** assert an owner action on an **in-org** member succeeds and writes an audit row; assert the
same action targeting an **out-of-org** user is rejected (the isolation proof); assert `revokeMemberSessions`
actually invalidates the member's sessions (observable: a subsequent authed call fails).

---

## C. Owner recovery (Pathway staff; cross-tenant — the sensitive one)

**Superadmin identity.** `PATHWAY_SUPERADMIN_EMAILS` env var (comma-separated, `.optional()`). A helper
`isPathwaySuperadmin(email)` is the single gate. No DB role, no in-app escalation path.

**Capabilities — credential-only, for any user by email:**

- reset password (generate a reset link),
- resend verification,
- revoke sessions.

**Hard limits (LAW 4 safety):** **no impersonation**, and these operations touch **only auth tables**
(user / session / verification) — never tenant business data. So a support action can restore access without
ever reading a studio's data. Every action `audit()`'d (organizationId may be null for a system/auth event —
resolve or record as a system row; see open question below).

**Surface.** A minimal protected page at `app/(app)/admin/recovery` (or `app/(admin)/recovery`), server-guarded:
the page/route handler rejects anyone whose session email isn't in `PATHWAY_SUPERADMIN_EMAILS` (404/redirect,
not just hidden). Form: enter a user email → the three actions, each with a confirm and an audit write.

**Test (LAW 7):** assert a non-superadmin session is **denied** the page and each action (the gate); assert a
superadmin can reset/revoke and it writes an audit row; assert the recovery path performs **no tenant-data read**
(the action only touches auth tables).

---

## Cross-cutting

- **Audit for auth-internal events.** The recovery actions call our own `audit()` directly (they're server
  actions, so `check-actions.mjs` already requires it). We are NOT wiring Better Auth's `databaseHooks` for
  general auth-event logging in this scope (that was the old H10 over-scope) — only the recovery actions audit.
- **Open question — audit org for cross-tenant recovery (C).** `audit_log.organizationId` is `NOT NULL`.
  Owner-recovery acts on a user who belongs to some org; we can record that user's org on the audit row (we
  know it), so we likely do **not** need to relax the column. Confirm during implementation; if a truly
  org-less case appears, fall back to the nullable-org system-row pattern the durable queue already uses.
- **Rate limiting.** Add the recovery/superadmin routes to Better Auth's `customRules` (sensitive endpoints).

## Rollout / ops checklist (owner)

1. Google Cloud Console: OAuth Client ID + redirect URI → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in Vercel.
2. `PATHWAY_SUPERADMIN_EMAILS` in Vercel (your email).
3. Deploy; smoke-test Google sign-in + one recovery action each (B and C) in production.

## Dependencies / order

A (independent) → B (proves the `admin` plugin in-tenant) → C (reuses the plugin cross-tenant; most sensitive,
last). Three PRs. Each ships behind `pnpm verify --tier=2`.
