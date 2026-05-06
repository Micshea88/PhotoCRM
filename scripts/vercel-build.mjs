#!/usr/bin/env node
/**
 * Vercel build entrypoint.
 *
 * Runs `drizzle-kit migrate` ONLY when the deploy is for the production
 * environment, then runs `next build`. Preview deploys skip migrations so
 * a feature-branch push can never accidentally migrate the production DB
 * (which is the default behavior when Vercel inherits the prod Postgres
 * integration into preview environments).
 *
 * Vercel sets VERCEL_ENV to "production" | "preview" | "development".
 * Local builds (no VERCEL_ENV) skip migrations and assume the developer
 * runs `pnpm db:migrate` manually.
 */
import { spawnSync } from "node:child_process"

const env = process.env.VERCEL_ENV ?? ""

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (env === "production") {
  console.log("[vercel-build] VERCEL_ENV=production — running migrations")
  run("pnpm", ["exec", "drizzle-kit", "migrate"])
} else if (env === "preview") {
  console.log(
    "[vercel-build] VERCEL_ENV=preview — SKIPPING migrations (configure a separate preview DB if you want previews to migrate independently)",
  )
} else {
  console.log(`[vercel-build] VERCEL_ENV=${env || "<unset>"} — skipping migrations`)
}

run("pnpm", ["exec", "next", "build"])
