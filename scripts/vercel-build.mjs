#!/usr/bin/env node
/**
 * Vercel build entrypoint.
 *
 * On PRODUCTION deploys (VERCEL_ENV=production), this runs
 * `drizzle-kit migrate` against DATABASE_URL_UNPOOLED before invoking
 * `next build`. Using the unpooled Neon connection is required —
 * drizzle-kit needs session-level advisory locks which the pooled
 * connection does not support (docs/deployment.md troubleshooting:
 * "Migration fails on deploy: could not obtain advisory lock").
 *
 * On PREVIEW and unknown environments, migrations are skipped. Preview
 * deploys from feature branches share the production database (per the
 * Vercel/Neon integration's default scope), so running their migrations
 * automatically would let an experimental schema change land in
 * production data. If a preview needs its own DB it must be wired
 * separately.
 *
 * If a production migration fails, the build fails and the deploy is
 * not promoted. This is the loud-failure mode we want — far better
 * than silently shipping new code against an old schema.
 */
import { spawnSync } from "node:child_process"

const env = process.env.VERCEL_ENV ?? ""

function run(cmd, args, envOverrides = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...envOverrides },
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (env === "production") {
  const unpooled = process.env.DATABASE_URL_UNPOOLED
  if (!unpooled) {
    console.error(
      "[vercel-build] VERCEL_ENV=production but DATABASE_URL_UNPOOLED is not set. " +
        "Attach the Neon integration to this project (Vercel → Storage), or add the variable manually.",
    )
    process.exit(1)
  }
  console.log("[vercel-build] VERCEL_ENV=production — running migrations against the unpooled URL")
  run("pnpm", ["exec", "drizzle-kit", "migrate"], { DATABASE_URL: unpooled })
} else if (env === "preview") {
  console.log(
    "[vercel-build] VERCEL_ENV=preview — SKIPPING migrations (preview shares the prod DB by default; wire a separate preview DB if you want previews to migrate independently)",
  )
} else {
  console.log(`[vercel-build] VERCEL_ENV=${env || "<unset>"} — skipping migrations`)
}

run("pnpm", ["exec", "next", "build"])
