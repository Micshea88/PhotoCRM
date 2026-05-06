# auth module

Better Auth schema + session helpers. The Better Auth runtime config lives in
`src/lib/auth.ts`; this module owns the database schema for users, sessions,
accounts, organizations, members, invitations, and verification tokens.

## What's here

- `schema.ts` — Better Auth's prescribed tables. Don't edit field names; they're
  hard-coded in the Better Auth library.
- `session.ts` — small helper to read the current session from React Server
  Components.

## Hard rules

- **Don't change Better Auth config in `src/lib/auth.ts` without an end-to-end
  test.** Auth flows are stateful and easy to break in subtle ways. After any
  change, manually walk: sign-up → verify email → create org → sign-out →
  sign-in → forgot password → reset.
- **Don't add columns to these tables for application-specific data.** If you
  need profile fields or org metadata, add a separate table that references
  `user.id` / `organization.id`.
- **`requireEmailVerification` is hard-coded to `true` in production.** Don't
  re-introduce the env-var override (it was removed because it was a one-flip
  path to allowing unverified sign-ups).
- **Rate limits are configured in `src/lib/auth.ts` `rateLimit.customRules`.**
  Tighten for sensitive endpoints; the in-memory store is fine for single-region
  deploys but switch to Upstash if scaling out.

## Where things live

- Sign-in / sign-up / verify routes: `app/(auth)/`
- Auth handler endpoint: `app/api/auth/[...all]/route.ts`
- Email templates: `src/emails/*.tsx`

## Adding a new auth-adjacent feature

If you need "remember this device" or "social login" or similar, do it through
Better Auth plugins (in `src/lib/auth.ts`), not by adding columns here.
