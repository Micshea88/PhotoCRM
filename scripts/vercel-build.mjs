#!/usr/bin/env node
/**
 * Vercel build entrypoint.
 *
 * Migrations are NOT run during Vercel deploys. The developer runs
 * `pnpm db:migrate` manually from their computer against the production
 * database before pushing schema changes. This keeps Vercel's build
 * environment from needing direct write access to production data and
 * removes a class of opaque "spinner ate the error" deploy failures.
 *
 * The build step just runs `next build`.
 */
import { spawnSync } from "node:child_process"

const env = process.env.VERCEL_ENV ?? ""
console.log(`[vercel-build] VERCEL_ENV=${env || "<unset>"} — skipping migrations (run pnpm db:migrate locally before deploying schema changes)`)

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run("pnpm", ["exec", "next", "build"])
