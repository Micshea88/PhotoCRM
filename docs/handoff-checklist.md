# First-day setup

This is your day-one checklist when you receive this repo. Work top-down.

## 1. Accounts

- [ ] **GitHub** account
- [ ] **Vercel** account (sign in with GitHub)
- [ ] **Resend** account (verify a sender domain or use the test domain initially)
- [ ] **Sentry** account (optional but recommended)

## 2. Repo

- [ ] Clone this repo into your GitHub account.
- [ ] In **GitHub repo settings → Branches**, add a rule for `main`:
  - [ ] Require status checks to pass: `verify`, `e2e`
  - [ ] Require pull request before merging

## 3. Local environment

- [ ] Install Node 22 LTS (`nvm install 22 && nvm use 22`)
- [ ] Install pnpm (`corepack enable && corepack prepare pnpm@latest --activate`)
- [ ] Install Docker Desktop (used for local Postgres)
- [ ] `pnpm install`
- [ ] `pnpm setup` — interactive, fills `.env.local`
- [ ] `docker compose up -d` — starts local Postgres on `localhost:5432`
- [ ] `pnpm db:migrate` — applies migrations to your dev DB
- [ ] `pnpm dev` — runs locally on http://localhost:3000

If something breaks at `pnpm dev`, check that `DATABASE_URL` in `.env.local` points at `localhost`. The app refuses to start in development against any other host.

## 4. Vercel

- [ ] Import the repo into Vercel.
- [ ] In Project Settings → **Storage**, add Postgres (Neon) integration. This auto-populates `DATABASE_URL`.
- [ ] In Project Settings → **Storage**, add Blob integration. This auto-populates `BLOB_READ_WRITE_TOKEN`.
- [ ] In Project Settings → **Environment Variables**, fill the values from `.env.example` for Production (and Preview if you want previews to use the same):
  - `BETTER_AUTH_SECRET` — 32+ char random string. Generate with: `openssl rand -hex 32`
  - `BETTER_AUTH_URL` — your production URL (e.g., `https://pathway.example.com`)
  - `RESEND_API_KEY` — from your Resend dashboard
  - `RESEND_FROM_EMAIL` — your verified sender (e.g., `noreply@yourdomain.com`)
  - `CRON_SECRET` — 32+ char random string. Generate with: `openssl rand -hex 32`
  - `QUEUE_SECRET` — 32+ char random string
  - `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (optional)
  - `NEXT_PUBLIC_APP_URL` — same as `BETTER_AUTH_URL`
- [ ] In Project Settings → **Build & Development**, set **Build Command** to `pnpm vercel-build`. This runs `drizzle-kit migrate && next build` so migrations apply atomically before the new app version goes live.
- [ ] In Project Settings → **Cron Jobs**, confirm the two scheduled jobs from `vercel.json` (`heartbeat` hourly, `purge-deleted` daily 04:00 UTC) appear.

## 5. First sign-up

- [ ] Visit your production URL.
- [ ] Sign up. You'll receive a verification email from Resend.
- [ ] Click the verification link. You'll land on the org-create page.
- [ ] Create your first organization.
- [ ] Land on the dashboard. The foundation is live.

## 6. First feature with Claude Code

Open Claude Code in this repo. Try:

```
/new-module todos
```

This scaffolds a new feature module from the items template. Then prompt:

> Add a `priority` field to todos with values low/medium/high; add UI for it.

Claude Code will edit the schema, generate a migration, update the form, and run `pnpm verify`. Review the diff, commit, push.

## 7. When something breaks

- Check Sentry first if SENTRY_DSN is set.
- Check Vercel deployment logs.
- Check Vercel function logs for the specific route.
- If a migration fails on deploy, Vercel keeps the previous version live. Look at `drizzle-kit migrate` output to understand why.
- If you need to inspect production data, ask Mike (consulting moment).
