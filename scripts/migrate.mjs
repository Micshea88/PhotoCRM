#!/usr/bin/env node
/**
 * Production migration runner.
 *
 * Replaces `drizzle-kit migrate` because the drizzle-kit CLI swallows
 * the underlying Postgres error and surfaces only a spinner that exits
 * non-zero with no message — which is impossible to debug from the
 * Vercel build log. This script uses drizzle-orm's migrator API
 * directly so the actual Postgres error is printed (code, detail,
 * hint, position, stack).
 *
 * Reads DATABASE_URL from process.env (set by scripts/vercel-build.mjs
 * to the unpooled Neon connection on production deploys).
 */
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL is not set")
  process.exit(1)
}

// Don't print the password.
const safeUrl = databaseUrl.replace(/:[^:@/]+@/, ":****@")
console.log(`[migrate] connecting to ${safeUrl}`)

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
const db = drizzle(pool)

try {
  console.log("[migrate] running drizzle migrator against src/db/migrations …")
  await migrate(db, { migrationsFolder: "src/db/migrations" })
  console.log("[migrate] ✓ migrations applied successfully")
} catch (err) {
  console.error("[migrate] ✗ migration FAILED")
  if (err && typeof err === "object") {
    const e = err
    if (e.message) console.error("  message :", e.message)
    if (e.code) console.error("  code    :", e.code)
    if (e.severity) console.error("  severity:", e.severity)
    if (e.detail) console.error("  detail  :", e.detail)
    if (e.hint) console.error("  hint    :", e.hint)
    if (e.schema) console.error("  schema  :", e.schema)
    if (e.table) console.error("  table   :", e.table)
    if (e.column) console.error("  column  :", e.column)
    if (e.constraint) console.error("  constr  :", e.constraint)
    if (e.position) console.error("  position:", e.position)
    if (e.where) console.error("  where   :", e.where)
    if (e.file) console.error("  file    :", e.file)
    if (e.line) console.error("  line    :", e.line)
    if (e.routine) console.error("  routine :", e.routine)
    if (e.stack) console.error("  stack   :", e.stack)
  } else {
    console.error(err)
  }
  process.exit(1)
} finally {
  await pool.end()
}
