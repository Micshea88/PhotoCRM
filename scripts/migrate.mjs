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
  // Walk the error chain: drizzle wraps the pg error in a generic
  // "Failed query: ..." Error and the real Postgres details (code,
  // severity, detail, etc.) live on `err.cause` per Node's standard
  // error-chaining convention. Print each link in the chain so the
  // underlying pg error is always visible.
  let chain = err
  let depth = 0
  while (chain && depth < 5) {
    const prefix = depth === 0 ? "  " : "  ".repeat(depth + 1) + "→ "
    if (chain && typeof chain === "object") {
      const e = chain
      if (e.message) console.error(`${prefix}message :`, e.message.slice(0, 500))
      if (e.code) console.error(`${prefix}code    :`, e.code)
      if (e.severity) console.error(`${prefix}severity:`, e.severity)
      if (e.detail) console.error(`${prefix}detail  :`, e.detail)
      if (e.hint) console.error(`${prefix}hint    :`, e.hint)
      if (e.schema) console.error(`${prefix}schema  :`, e.schema)
      if (e.table) console.error(`${prefix}table   :`, e.table)
      if (e.column) console.error(`${prefix}column  :`, e.column)
      if (e.constraint) console.error(`${prefix}constr  :`, e.constraint)
      if (e.position) console.error(`${prefix}position:`, e.position)
      if (e.where) console.error(`${prefix}where   :`, e.where)
      if (e.file) console.error(`${prefix}file    :`, e.file)
      if (e.line) console.error(`${prefix}line    :`, e.line)
      if (e.routine) console.error(`${prefix}routine :`, e.routine)
    } else {
      console.error(`${prefix}value   :`, chain)
    }
    chain = chain?.cause
    depth += 1
  }
  if (err?.stack) console.error("  stack   :", err.stack)
  process.exit(1)
} finally {
  await pool.end()
}
