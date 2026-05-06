# Vercel deployment

This is the runbook for deploying `pathway-foundation` to Vercel against a Vercel Postgres (Neon) backend.

## TL;DR

1. Provision Vercel project + Vercel Postgres + Vercel Blob.
2. Verify the Resend sender domain BEFORE first sign-up.
3. Set environment variables on the Vercel project (Production + Preview separately).
4. Set the Build Command to `pnpm vercel-build`.
5. First production deploy: confirm migrations ran, sign up the first user.
6. Add GitHub branch protection rules.
7. Set up billing alerts.

The rest of this doc walks through each step in detail.

---

## 1. Pre-deploy

### Vercel project

- Import the repo in Vercel: **Add New → Project → Import from GitHub**.
- Framework preset: **Next.js** (auto-detected).
- Root directory: leave default.
- Build Command: `pnpm vercel-build` (this runs migrations only on production deploys).
- Install Command: `pnpm install --frozen-lockfile`.
- Output directory: leave default.

### Vercel Postgres (Neon)

- In the project, **Storage → Add Postgres → Neon**.
- Pick the **same region** as your Vercel functions (set under **General → Functions Region** — default is `iad1`, which matches `vercel.json`'s `regions`).
- Vercel auto-populates `DATABASE_URL`, `POSTGRES_URL`, etc. into your Production env. **You only need `DATABASE_URL`.** Delete the others if you want a clean env list.
- Neon offers **pooled** vs **direct** connection strings. The default Vercel integration uses the pooled URL, which is correct for runtime. Migrations also work over the pooled URL for this stack — if you ever switch to `@neondatabase/serverless`, set `MIGRATIONS_DATABASE_URL` separately to the direct URL.

### Preview environment isolation (IMPORTANT)

By default, Vercel inherits Production env vars into Preview. That means a PR-branch deploy will run against your **production** Postgres unless you override this:

- **Option A (recommended for safety):** create a separate Neon database for Preview. In Vercel **Storage → connect a new Postgres branch** to the Preview environment. Or set `DATABASE_URL` in Preview to a different Postgres instance.
- **Option B (simpler, less safe):** accept that previews share prod data. Migrations are gated to `VERCEL_ENV === "production"` in `scripts/vercel-build.mjs`, so previews never migrate prod schema — but they do read/write prod rows.

### Vercel Blob

- **Storage → Add Blob**. Vercel auto-populates `BLOB_READ_WRITE_TOKEN`.
- Files in this app upload as **private** (see `src/lib/blob.ts`). Browsers fetch them through `app/api/files/[id]/route.ts`, which re-checks org membership before streaming. There is no public CDN URL.

### Resend (transactional email)

- Sign up at [resend.com](https://resend.com), verify your sending domain (DNS records — usually 3 or 4 of them).
- **Verify the domain BEFORE the first user signs up.** Otherwise, sign-up emails won't deliver, the user can't verify, and they're locked out.
- Generate an API key (`re_...`); it goes in `RESEND_API_KEY`.
- Set `RESEND_FROM_EMAIL` to a verified sender on that domain (e.g., `noreply@yourdomain.com`).
- Smoke-test with: `curl -X POST https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" -d '{"from":"...","to":"you@example.com","subject":"test","text":"ok"}'`.

### Sentry (recommended)

- Create a Sentry org + project (Next.js).
- Copy the DSN. Set BOTH `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser) to that value — Next.js does NOT inline server-only env vars into the client bundle.
- For source-map upload (so prod stack traces are readable), also set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. Without these, traces work but file references will be minified.

---

## 2. Environment variables

All values go in **Project Settings → Environment Variables**. Set Production. Set Preview to its own values (especially `DATABASE_URL`) per "Preview environment isolation" above.

| Variable                 | Generate with                    | Notes                                               |
| ------------------------ | -------------------------------- | --------------------------------------------------- |
| `DATABASE_URL`           | (auto from Vercel Postgres)      | Pooled connection string.                           |
| `BETTER_AUTH_SECRET`     | `openssl rand -hex 32`           | 32+ chars. Refused if it contains "dev"/"test"/etc. |
| `BETTER_AUTH_URL`        | your prod URL, no trailing slash | e.g. `https://pathway.example.com`                  |
| `RESEND_API_KEY`         | from Resend dashboard            | Domain must be verified.                            |
| `RESEND_FROM_EMAIL`      | a verified sender                | e.g. `noreply@yourdomain.com`                       |
| `BLOB_READ_WRITE_TOKEN`  | (auto from Vercel Blob)          |                                                     |
| `CRON_SECRET`            | `openssl rand -hex 32`           | Vercel cron sets `Authorization: Bearer <this>`.    |
| `QUEUE_SECRET`           | `openssl rand -hex 32`           | Producer/consumer shared secret.                    |
| `SENTRY_DSN`             | from Sentry                      | Optional but recommended.                           |
| `NEXT_PUBLIC_SENTRY_DSN` | same as `SENTRY_DSN`             | Required for browser errors.                        |
| `SENTRY_AUTH_TOKEN`      | from Sentry                      | Build-time only; for source-map upload.             |
| `SENTRY_ORG`             | your sentry org slug             |                                                     |
| `SENTRY_PROJECT`         | your sentry project slug         |                                                     |
| `NEXT_PUBLIC_APP_URL`    | same as `BETTER_AUTH_URL`        |                                                     |

**Optional knobs** (set only if you want to override defaults):

| Variable            | Default | What it does                                            |
| ------------------- | ------- | ------------------------------------------------------- |
| `RETENTION_DAYS`    | `90`    | Days a soft-deleted row sits before purge.              |
| `PURGE_BATCH_LIMIT` | `1000`  | Max rows the purge cron processes per run per resource. |
| `PURGE_ENABLED`     | `true`  | Set to `"false"` to disable purge without a deploy.     |

---

## 3. First production deploy

```bash
git push origin main
```

Watch the Vercel build:

- `[vercel-build] VERCEL_ENV=production — running migrations` should appear.
- `drizzle-kit migrate` should report applied migrations (or "No new migrations").
- `next build` should succeed.
- The deployment URL goes live.

### Smoke-test

1. Open the production URL. Confirm the marketing page loads.
2. Sign up with a real email. Verify the email lands (check Resend logs).
3. Click the verification link. You'll land on `/onboarding`.
4. Create an organization.
5. Reach `/dashboard`. Try creating an item, deleting it, restoring it.
6. Hit `/api/jobs/cron/heartbeat` with `Authorization: Bearer $CRON_SECRET`. Expect `{"ok":true,"dbMs":<n>}`.

### Confirm cron jobs

In **Project Settings → Cron Jobs**, confirm both jobs from `vercel.json` appear:

- `/api/jobs/cron/heartbeat` — hourly
- `/api/jobs/cron/purge-deleted` — daily 04:00 UTC

If they don't appear, redeploy.

---

## 4. GitHub branch protection

In GitHub: **Settings → Branches → Add branch ruleset → Target branches: main**.

Required:

- **Require a pull request before merging** — yes; `1` approving review.
- **Require status checks to pass before merging** — yes; required checks:
  - `Verify (typecheck, lint, unit, integration, build)`
  - `E2E (Playwright)`
- **Require linear history** — yes (cleaner main branch).
- **Restrict pushes that create files larger than 100 MB** — yes.
- **Do not allow bypassing the above settings** — keep ON for everyone except a break-glass admin role.

Optional:

- **Require signed commits** — turn on if all contributors have GPG keys.
- **Require deployments to succeed** — turn on once Vercel deploy reliability is established.

---

## 5. Billing & monitoring

Set hard cost alerts so a runaway feature doesn't surprise you with a bill:

- **Vercel** → Account → Usage → set alerts on Functions, Bandwidth, Edge.
- **Neon (Postgres)** → set alerts on Compute time + Storage.
- **Vercel Blob** → set alerts on bandwidth + storage.
- **Resend** → set alerts on monthly send count.
- **Sentry** → set alerts on event quota.

Add a status page (BetterUptime / Checkly) that pings:

- `https://yourdomain/api/jobs/cron/heartbeat` (with auth header)
- `https://yourdomain/` (front page)

The heartbeat returns `{"ok":true,"dbMs":<n>}` with `dbMs` showing the DB roundtrip latency. Alert if `dbMs > 1000` for sustained periods.

---

## 6. Rolling back

Vercel keeps every deploy. To roll back:

- **Code-only rollback:** **Deployments** → pick a previous deploy → **Promote to Production**. The previous build artifact serves traffic immediately.
- **If a migration was the problem:** rolling back the deploy does NOT roll back the migration. Schema ratchets forward. You'll need to:
  1. Generate a _new_ migration that undoes the change (forward fix).
  2. Apply it to prod.
  3. Promote the rolled-back deploy.

This is why destructive migrations require the expand-migrate-contract pattern — you can't ALTER COLUMN ... DROP NOT NULL after the fact without orchestration. See `docs/architecture.md`.

---

## 7. Common failures

**Build fails with `BETTER_AUTH_SECRET contains a known-dev marker`**
Your secret has `dev`/`test`/`local`/etc. in it. Generate a new one: `openssl rand -hex 32`.

**Build fails with `DATABASE_URL is required`**
The Postgres integration didn't populate the env. Check **Project Settings → Storage**; sometimes the integration needs a re-attach.

**Migration fails on deploy**
Vercel keeps the previous version live. Look at the build logs to find the SQL that failed. Common causes: `NOT NULL` added without a default, type narrowing on existing data, missing FK target. Fix locally (generate a NEW migration — never edit a committed one), apply, push.

**Cron job doesn't fire**

- Confirm `vercel.json` is committed.
- Confirm the project has redeployed since the last `crons` change.
- Confirm `CRON_SECRET` is set on Production.

**Auth callback URLs don't match**
`BETTER_AUTH_URL` must match the production domain exactly (including `https://`, no trailing slash). If you change domains, update both `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL`.

**Browser errors not appearing in Sentry**
You probably set `SENTRY_DSN` but not `NEXT_PUBLIC_SENTRY_DSN`. Both need to be set; they typically have the same value.

**Stack traces in Sentry are unreadable (e.g. `chunks/page-abc.js:1:8421`)**
Source maps aren't uploading. Check `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are all set in the Production env.
