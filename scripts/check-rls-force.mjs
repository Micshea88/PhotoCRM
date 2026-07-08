#!/usr/bin/env node
/**
 * Static guard: every org-bearing table in src/modules/<name>/ MUST have an
 * ALTER TABLE "x" FORCE ROW LEVEL SECURITY statement in the migration SQL.
 * Without FORCE, the BYPASSRLS owner role (e.g. neondb_owner in prod) silently
 * ignores RLS — the bug that caused K&K Photography to see all of Shanzy
 * Studio's contacts (confirmed live, hotfix 0041).
 *
 * Org-bearing table = a pgTable(...) declaration in ANY .ts file under
 * src/modules/<name>/ whose column definition block contains "organization_id"
 * OR "org_id" as a SQL column name. The check is intentionally conservative
 * (text match) so it catches the dominant patterns without a full TS AST parse.
 *
 * Coverage: ALL `.ts` files in each module directory are scanned, not just
 * schema.ts — so tables declared in sibling schema files are covered too:
 *   - file_share_links + file_share_link_events (files/share-link-schema.ts)
 *   - file_scan_diagnostics (files/scan-diagnostics-schema.ts, column `org_id`)
 * All three have FORCE (migration 0061) and now appear in this guard's output.
 *
 * EXEMPT tables (not checked):
 *   - Better-Auth managed: user, organization, member, session, account,
 *     verification, invitation — BA owns their schema; we don't add RLS.
 *   - Global content: faq_entries — intentionally unscoped, no org column,
 *     no RLS by design (confirmed in rls-tenant-tables.test.ts).
 *
 * Failure mode: exits 1 and lists every org table missing FORCE. A table
 * that only has ENABLE (not FORCE) will also fail — ENABLE alone does not
 * protect against the BYPASSRLS owner role.
 *
 * As of migration 0062 + the user_preferences FORCE migration, every
 * org-bearing table in the codebase has FORCE ROW LEVEL SECURITY. This
 * invariant was falsely claimed in migration 0041's header; now it is
 * actually true and enforced here (wired into verify.mjs tier-1).
 *
 * See also: docs/multi-tenant-remediation-plan.md §T1.5
 *
 * Exit codes:
 *   0 — all org tables have FORCE ROW LEVEL SECURITY
 *   1 — one or more org tables are missing FORCE
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const REPO = process.cwd()
const SCHEMA_GLOB_PATTERN = join(REPO, "src", "modules")
const MIGRATIONS_DIR = join(REPO, "src", "db", "migrations")

// Better-Auth managed tables — BA owns schema + lifecycle; no app RLS.
const BETTER_AUTH_EXEMPT = new Set([
  "user",
  "organization",
  "member",
  "session",
  "account",
  "verification",
  "invitation",
])

/**
 * Extract org-bearing table names from a schema file's contents.
 *
 * Strategy: find each pgTable("name", { ... }) call, extract the SQL table
 * name, then check if the block between this pgTable and the next one (or EOF)
 * contains `"organization_id"` OR `"org_id"` — the SQL column names used for
 * the org FK.
 *
 * This covers both patterns:
 *   organizationId: text("organization_id").notNull().references(...)
 *   orgId: text("org_id").references(...)                // file_scan_diagnostics
 */
function extractOrgTables(content, filePath) {
  const tables = []

  // Find all pgTable( calls and their positions.
  const pgTablePattern = /pgTable\s*\(\s*["']([^"']+)["']/g
  let match
  const positions = []

  while ((match = pgTablePattern.exec(content)) !== null) {
    positions.push({ name: match[1], index: match.index })
  }

  for (let i = 0; i < positions.length; i++) {
    const { name, index: start } = positions[i]
    // The "block" for this table runs until the next pgTable call or EOF.
    const end = i + 1 < positions.length ? positions[i + 1].index : content.length
    const block = content.slice(start, end)

    // Does this table have an organization_id or org_id column?
    const hasOrgColumn =
      block.includes('"organization_id"') ||
      block.includes("'organization_id'") ||
      block.includes('"org_id"') ||
      block.includes("'org_id'")
    if (hasOrgColumn && !BETTER_AUTH_EXEMPT.has(name)) {
      tables.push({ name, filePath })
    }
  }

  return tables
}

/**
 * Recursively collect every `.ts` file under a module directory. Schema files
 * live at the module top level today (schema.ts, share-link-schema.ts,
 * scan-diagnostics-schema.ts) but we recurse defensively so a nested schema
 * file can never silently escape the guard.
 */
function collectTsFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full))
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full)
    }
  }
  return out
}

// ── 1. Walk ALL .ts files under src/modules/*/ ───────────────────────────

const orgTables = []

let moduleDirs
try {
  moduleDirs = readdirSync(SCHEMA_GLOB_PATTERN, { withFileTypes: true })
} catch {
  console.error(`[check-rls-force] cannot read modules directory: ${SCHEMA_GLOB_PATTERN}`)
  process.exit(1)
}

for (const mod of moduleDirs) {
  if (!mod.isDirectory()) continue
  const tsFiles = collectTsFiles(join(SCHEMA_GLOB_PATTERN, mod.name))
  for (const filePath of tsFiles) {
    const content = readFileSync(filePath, "utf8")
    // Cheap early-out: only parse files that actually declare a table.
    if (!content.includes("pgTable")) continue
    orgTables.push(...extractOrgTables(content, filePath))
  }
}

if (orgTables.length === 0) {
  console.error("[check-rls-force] no org-bearing tables found — check the module path")
  process.exit(1)
}

// ── 2. Collect all FORCE ROW LEVEL SECURITY statements from migrations ────

const tablesWithForce = new Set()

let migrationFiles
try {
  migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
} catch {
  console.error(`[check-rls-force] cannot read migrations directory: ${MIGRATIONS_DIR}`)
  process.exit(1)
}

const forcePattern = /ALTER\s+TABLE\s+"([^"]+)"\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/g

for (const file of migrationFiles) {
  const content = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
  let match
  while ((match = forcePattern.exec(content)) !== null) {
    tablesWithForce.add(match[1])
  }
}

// ── 3. Report any org tables without FORCE ───────────────────────────────

const missing = orgTables.filter((t) => !tablesWithForce.has(t.name))

if (missing.length > 0) {
  console.error("\n[check-rls-force] The following org-bearing tables are missing FORCE ROW LEVEL SECURITY:\n")
  for (const t of missing) {
    console.error(`  table: "${t.name}"  (${t.filePath})`)
  }
  console.error(
    "\nFIX: after pnpm db:generate, hand-append the following to the generated .sql migration:\n" +
      missing.map((t) => `  ALTER TABLE "${t.name}" FORCE ROW LEVEL SECURITY;`).join("\n") +
      "\n\nSee AGENTS.md §10a and src/modules/items/schema.ts for the canonical pattern.\n" +
      "Without FORCE, the BYPASSRLS owner role (neondb_owner in prod) bypasses RLS.\n",
  )
  process.exit(1)
}

// Report the full list of checked tables for visibility.
const names = orgTables.map((t) => t.name).sort()
// eslint-disable-next-line no-console
console.log(`[check-rls-force] ${names.length} org tables — all have FORCE ROW LEVEL SECURITY ✓`)
// eslint-disable-next-line no-console
console.log(`  checked: ${names.join(", ")}`)
