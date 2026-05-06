# Vercel deployment

This document gets filled out collaboratively when you (the user, not Sage) actually run the first deploy. Until then, this is a placeholder pointing at the rough steps.

## What's already wired

- `vercel.json` declares the cron jobs.
- `pnpm vercel-build` runs `drizzle-kit migrate && next build`. Set this as the Vercel project's Build Command so migrations apply before each deploy.
- `.github/workflows/ci.yml` runs verify + E2E on every push and PR. Vercel's built-in preview deploys are independent and require no GitHub Actions wiring.
- All env vars are documented in `.env.example` and validated at app startup via `@t3-oss/env-nextjs`.

## What we'll do together

Coming back to this when the user is ready:

1. Import the repo into Vercel.
2. Attach Vercel Postgres (Neon) and Vercel Blob integrations.
3. Set environment variables (see `docs/handoff-checklist.md`).
4. First deploy → confirm migrations run → confirm preview URL works.
5. Sign up, verify email, create first org, smoke-test items CRUD.
6. Set the Vercel project's Build Command to `pnpm vercel-build`.
7. Confirm cron jobs appear in Vercel dashboard.
8. Configure custom domain + Resend domain verification.
9. Add branch protection rules in GitHub.

## Commands you'll want handy

```bash
# Deploy preview from current branch
vercel --no-clipboard

# Deploy to production
vercel --prod --no-clipboard

# Pull production env vars to local (for ad-hoc debugging — DO NOT commit)
vercel env pull .env.production.local

# Force a redeploy of the current production
vercel --prod --force
```

## Troubleshooting

**Build fails with `DATABASE_URL is required`**
The Postgres integration didn't populate `DATABASE_URL` in the build environment. Check **Project Settings → Storage** — sometimes the integration needs a re-attach.

**Migration fails on deploy**
Vercel keeps the previous version live. Look at the build logs to find the SQL that failed. Common causes: `NOT NULL` added without a default, type narrowing on existing data, missing FK target. Fix the migration locally (create a new one — never edit a committed migration), apply locally, push.

**Cron job doesn't appear in Vercel dashboard**
`vercel.json` is committed but the project hasn't redeployed since the last `crons` change. Trigger a deploy.

**Auth callback URLs don't match**
`BETTER_AUTH_URL` must match the production domain _exactly_ (including `https://` and no trailing slash). If you change domains, update both `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL`.
