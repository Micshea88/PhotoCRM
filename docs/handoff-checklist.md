# First-day setup

Day-one checklist for `pathway-foundation`. Work top-down. The deployment runbook is at [`docs/deployment.md`](deployment.md) — this checklist is the human-side prep.

## 1. Accounts

- [ ] **GitHub** account
- [ ] **Vercel** account (sign in with GitHub)
- [ ] **Resend** account, sender domain verified BEFORE first sign-up
- [ ] **Sentry** account (recommended — without it, prod errors are invisible)
- [ ] (Optional) BetterUptime or Checkly for synthetic monitoring

## 2. Repo

- [ ] Push this repo to your GitHub account.
- [ ] In **GitHub → Settings → Branches → Branch ruleset for `main`** (see `docs/deployment.md` §4 for the exact list):
  - Require PR + 1 review before merging
  - Require status checks: `Verify` and `E2E` to pass
  - Require linear history
  - Disallow bypass for non-admins

## 3. Local environment

- [ ] Install **Node 22 LTS** (`nvm install 22 && nvm use 22`)
- [ ] Install **pnpm** (`corepack enable && corepack prepare pnpm@latest --activate`)
- [ ] Install **Docker Desktop** (used for local Postgres)
- [ ] `pnpm install`
- [ ] `docker compose up -d` — starts local Postgres on `localhost:5432`
- [ ] `pnpm setup` — interactive, fills `.env.local`
- [ ] `pnpm db:migrate` — applies migrations to your dev DB
- [ ] `pnpm seed` — optional: creates a demo user (`demo@pathway.local` / `demopassword12345`) and an org with three sample items
- [ ] `pnpm dev` — runs on http://localhost:3000

If `pnpm dev` complains about `DATABASE_URL`, confirm `.env.local` points at `localhost`. The app refuses to start in development against any other host (`src/lib/db.ts` parses the URL and rejects non-local hostnames).

## 4. Vercel + production

Follow [`docs/deployment.md`](deployment.md) end-to-end. The short version:

- [ ] Import the repo. Build Command = `pnpm vercel-build`.
- [ ] Add Vercel Postgres (Neon). Pick the same region as your Functions region (`iad1` matches `vercel.json`).
- [ ] Add Vercel Blob.
- [ ] Set env vars (see deployment runbook table). All 14 of them.
- [ ] Decide on Preview DB isolation — separate Neon for Preview, OR accept that previews share prod data (migrations are gated to production-only either way).
- [ ] First deploy. Confirm migrations ran. Confirm cron jobs appear under **Cron Jobs**.

## 5. First sign-up

- [ ] Visit your production URL.
- [ ] Sign up. Verification email lands (check Resend logs if not).
- [ ] Click verify link. Land on `/onboarding`.
- [ ] Create your first organization. Land on `/dashboard`.
- [ ] Smoke test: create an item, delete it, restore it.

## 6. Billing alerts

- [ ] Vercel — Functions / Bandwidth alerts
- [ ] Neon — Compute / Storage alerts
- [ ] Vercel Blob — Bandwidth / Storage alerts
- [ ] Resend — monthly send count alert
- [ ] Sentry — event quota alert

## 7. First feature with Claude Code

Open Claude Code in this repo. Try:

```
/new-module todos
```

This delegates to the `add-module` skill, which walks the full checklist (copy items template, rename, regenerate migration, update reset-db + purge cron lists, scaffold routes + integration tests). Then prompt:

> Add a `priority` field to todos with values low/medium/high; add UI for it.

Claude will edit the schema, generate a migration, update the form, and run `pnpm verify`. Review the diff, commit, push.

## 8. When something breaks

- Check **Sentry** first if `SENTRY_DSN` is set.
- Check **Vercel deployment logs**.
- Check the specific route's **Vercel function logs**.
- Migration failed on deploy? Vercel keeps the previous version live. Look at `drizzle-kit migrate` output to understand why. Then generate a NEW migration that fixes it (never edit committed migrations).
- For ad-hoc data inspection in production, use `vercel env pull .env.production.local` then `pnpm db:studio` — and **delete `.env.production.local` immediately afterward**.

## 9. Outstanding work

The repo ships with [`TODO.md`](../TODO.md) at the root — a punch list of hardening items still open. The Critical block is fixed, but several High-priority items (rate limit storage for multi-region, audit-on-mutate static enforcement, password breach-corpus check) are flagged for follow-up.
