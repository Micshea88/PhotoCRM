# Deployment guide

## Current state (as of 2026-05-06)

The foundation is **already deployed** to Vercel by Mike at `https://pathway-foundation.vercel.app`. It's running on Mike's accounts as a smoke-test deploy. All four golden paths are verified working:

1. Sign-up → onboarding → dashboard
2. Org creation
3. Items CRUD with soft-delete
4. Sign-out → sign-in with active-org restoration

The deploy is currently using **placeholder values** for Resend and **email verification disabled** so the smoke test could complete without working email. Sage's job today is to take this over onto his own accounts and flip the placeholders to real values.

## What Sage does today

These are sequential — finish each before starting the next.

### 1. GitHub takeover

- Create a GitHub account (or use existing).
- Mike will transfer the repo to Sage's account, OR Sage forks it. Either way, Sage's GitHub account ends up owning `pathway-foundation`.
- Confirm `git remote get-url origin` on Sage's local clone points at Sage's account.

### 2. Vercel takeover

Two paths — pick one.

**Path A — Transfer the existing project (faster, keeps Mike's smoke-test data).** Mike clicks "Transfer Project" in Vercel project settings → Sage's team. The Neon database, Blob store, and existing env vars all carry over. Sage just changes ownership.

**Path B — Sage creates his own project (clean slate, throws away test data).** Sage signs up at vercel.com → imports the repo → goes through Stage 1–5 of the original walkthrough below.

If unsure, **prefer Path A** — it's faster and the data isn't precious.

### 3. Resend setup

- Sign up at https://resend.com (free tier — 3k emails/month).
- **API Keys → Create API Key** → name it `pathway-prod` → copy the `re_...` key.
- For sending domain:
  - **Quickest**: use `onboarding@resend.dev` as the sender. Works immediately but only sends to the email tied to your Resend account. Fine for first-week testing.
  - **Production**: in **Domains**, add your domain → paste DNS records (typically 3 TXT/MX records) into your DNS provider → wait for verification → use `noreply@yourdomain.com`.
- In Vercel **Settings → Environment Variables**:
  - Replace `RESEND_API_KEY` with the real `re_...` key.
  - Replace `RESEND_FROM_EMAIL` with the actual sender address.

### 4. Flip email verification back on

In Vercel **Settings → Environment Variables**:

- Change `AUTH_REQUIRE_EMAIL_VERIFICATION=false` to `AUTH_REQUIRE_EMAIL_VERIFICATION=true`.

### 5. (Optional) Sentry

If you want error monitoring:

- Sign up at https://sentry.io (free tier — 5k errors/month).
- Create a Next.js project → copy the DSN.
- In Vercel env vars: set `SENTRY_DSN=https://...sentry.io/...`.
- For source-map upload (better stack traces): create an auth token in Sentry → set `SENTRY_AUTH_TOKEN` in Vercel.

Skip if you don't want it; the foundation degrades gracefully when `SENTRY_DSN` is empty.

### 6. Trigger a redeploy

After changing env vars, Vercel does **not** auto-redeploy. You have to manually trigger one so the new values take effect.

- **Deployments tab** → latest deployment → `⋯` → **Redeploy** → uncheck "use existing build cache" → confirm.

### 7. Verify

When the redeploy is green:

1. Visit `https://pathway-foundation.vercel.app` (or your project's URL).
2. Sign up with a real email address (one tied to your Resend account if you used `onboarding@resend.dev`).
3. **Expect**: a verification email lands in your inbox within 30 seconds. Click the link.
4. **Expect**: redirected to org-create page.
5. Create an org → land on dashboard.
6. Create an item, edit it, delete it. All four golden paths should work.

If the verification email doesn't arrive:

- Check Vercel function logs for `Email send failed` errors.
- Check Resend dashboard → Logs — there should be a record of the send attempt.
- Common causes: `RESEND_API_KEY` typo, `RESEND_FROM_EMAIL` not matching a verified sender.

### 8. (Optional) Custom domain

In Vercel **Settings → Domains**:

- Add your domain → follow the DNS instructions Vercel gives you (one ALIAS or CNAME record).
- Once verified, Vercel auto-issues an SSL cert.
- **Update env vars** to match: `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` should both be `https://your-new-domain.com`. **Redeploy**.

### 9. (Optional) GitHub branch protection

In **GitHub repo settings → Branches → Add branch ruleset** for `main`:

- Require status checks to pass before merging: `verify`, `e2e`.
- Require a pull request before merging.

This means you can't push directly to `main` — every change goes through a PR with passing CI.

## After today

Day-to-day work uses Claude Code in the repo. The conventions are in `AGENTS.md` and `CLAUDE.md`. Slash commands automate most repetitive tasks:

- `/new-module <name>` — scaffold a new feature module from the items template.
- `/new-migration <description>` — generate, review, apply a schema migration safely.
- `/migration-review` — check the latest migration for destructive operations.
- `/seed` — load development data locally.

For local development:

- `pnpm install`
- `pnpm setup` (interactive — fills `.env.local`)
- `docker compose up -d` (local Postgres on port 5432)
- `pnpm db:migrate`
- `pnpm dev`

Sign in locally with `demo@pathway.local` / `demopassword12345` (created by `pnpm seed`).

## Reference: complete env var list

```
DATABASE_URL=                           # auto-populated by Vercel/Neon integration
BLOB_READ_WRITE_TOKEN=                  # auto-populated by Vercel/Blob integration
BETTER_AUTH_SECRET=                     # 32+ char random; generate with: openssl rand -hex 32
BETTER_AUTH_URL=                        # production URL, e.g., https://pathway-foundation.vercel.app
RESEND_API_KEY=                         # re_... from Resend dashboard
RESEND_FROM_EMAIL=                      # noreply@yourdomain.com or onboarding@resend.dev
CRON_SECRET=                            # 32+ char random; Vercel sends as Bearer for cron jobs
QUEUE_SECRET=                           # 32+ char random; shared between queue producer/consumer
SENTRY_DSN=                             # optional; empty = Sentry disabled
SENTRY_AUTH_TOKEN=                      # optional; for source-map upload
NEXT_PUBLIC_APP_URL=                    # same as BETTER_AUTH_URL
AUTH_REQUIRE_EMAIL_VERIFICATION=true    # MUST be "true" in production
```

## Troubleshooting

**Build fails with `DATABASE_URL is required`**
The Neon integration didn't fully attach. In Vercel **Settings → Storage**, click the database → re-attach to the project.

**Migration fails on deploy: "could not obtain advisory lock"**
The pooled `DATABASE_URL` doesn't support session-level advisory locks. Update `package.json` `vercel-build` script to use the unpooled connection: `DATABASE_URL=$DATABASE_URL_UNPOOLED drizzle-kit migrate && next build`.

**Sign-up succeeds but verification email never arrives**
Check Resend dashboard logs first. Common issues: API key typo, sender domain not verified, hitting the test-domain restriction (only sends to your own email).

**"You are not a member of this organization" after sign-out + sign-in**
This means `activeOrganizationId` didn't get restored. The sign-in form already has fallback logic — if you see this, check Vercel function logs for errors during the `setActive` call.

**Cron jobs aren't firing**
In Vercel **Settings → Cron Jobs**, confirm both `heartbeat` and `purge-deleted` appear. If not, the project hasn't redeployed since `vercel.json` was committed — trigger a redeploy.

**Auth callback URLs don't match production domain**
`BETTER_AUTH_URL` must be the _exact_ production domain (including `https://`, no trailing slash). After changing custom domains, update both `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` and redeploy.
