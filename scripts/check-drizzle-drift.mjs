#!/usr/bin/env node
/**
 * Snapshot-drift guard. Lives in the pre-commit verify path only —
 * NEVER wire this into the Vercel build, because a false-positive
 * mid-deploy would block prod.
 *
 * Mechanic
 * --------
 * 1. `drizzle-kit check` enforces journal/snapshot internal consistency
 *    (every committed migration has a matching snapshot, indices align).
 * 2. Stage a copy of the current migrations + snapshots into a temp dir
 *    INSIDE the repo (drizzle-kit 0.31 has a bug where absolute `out`
 *    paths get mangled), then run `drizzle-kit generate` pointed at the
 *    temp dir. If any new .sql appears, the TS schema has drifted from
 *    the latest snapshot — someone added/changed schema without running
 *    `pnpm db:generate`. FAIL the check.
 *
 * Background: the 0035→0038 episode shipped hand-written migrations
 * without re-running `db:generate`. The snapshots froze at 0033, and
 * the next legitimate generate proposed re-creating tables that were
 * already deployed. This guard catches that pattern before commit.
 *
 * Exit codes
 * ----------
 *   0   — no drift; TS schema matches latest snapshot
 *   1   — drift detected; generate would emit files
 *   2   — drizzle-kit check failed (journal/snapshot integrity broken)
 *   3   — unexpected failure (missing tooling, etc.)
 *
 * Offline-only — does not connect to a DB.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const REPO = process.cwd()
const MIG_DIR = join(REPO, "src", "db", "migrations")
const META_DIR = join(MIG_DIR, "meta")
const STAMP = Date.now()
const TMP_DIR = join(REPO, `.drizzle-drift-check-${STAMP}`)
const TMP_MIG = join(TMP_DIR, "migrations")
const TMP_META = join(TMP_MIG, "meta")
const TMP_CFG = join(REPO, `.drizzle-drift-check-${STAMP}.config.ts`)

function cleanup() {
  try {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {}
  try {
    if (existsSync(TMP_CFG)) rmSync(TMP_CFG, { force: true })
  } catch {}
}

function die(code, msg) {
  cleanup()
  // eslint-disable-next-line no-console
  console.error(msg)
  process.exit(code)
}

process.on("SIGINT", () => die(3, "[check-drizzle-drift] interrupted"))
process.on("SIGTERM", () => die(3, "[check-drizzle-drift] terminated"))

// ---- 1. drizzle-kit check (journal/snapshot integrity) ----
const check = spawnSync("pnpm", ["exec", "drizzle-kit", "check"], {
  cwd: REPO,
  encoding: "utf8",
})
if (check.status !== 0) {
  die(
    2,
    "[check-drizzle-drift] drizzle-kit check FAILED — journal/snapshot integrity broken:\n" +
      (check.stdout ?? "") +
      (check.stderr ?? ""),
  )
}

// ---- 2. drift detection via sandbox generate ----
mkdirSync(TMP_META, { recursive: true })
cpSync(MIG_DIR, TMP_MIG, { recursive: true })
const sqlBefore = new Set(readdirSync(TMP_MIG).filter((f) => f.endsWith(".sql")))

// Temp config — must live inside the repo so drizzle-kit can resolve
// node_modules + use relative paths (the 0.31 absolute-path bug).
const relTmp = `./.drizzle-drift-check-${STAMP}/migrations`
writeFileSync(
  TMP_CFG,
  `import { defineConfig } from "drizzle-kit"
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "${relTmp}",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://placeholder@localhost:5432/db" },
  strict: true,
})
`,
)

const gen = spawnSync(
  "pnpm",
  ["exec", "drizzle-kit", "generate", `--config=${TMP_CFG}`],
  { cwd: REPO, encoding: "utf8" },
)
if (gen.status !== 0) {
  die(
    3,
    "[check-drizzle-drift] drizzle-kit generate failed unexpectedly:\n" +
      (gen.stdout ?? "") +
      (gen.stderr ?? ""),
  )
}

const sqlAfter = readdirSync(TMP_MIG).filter((f) => f.endsWith(".sql"))
const newSql = sqlAfter.filter((f) => !sqlBefore.has(f))
cleanup()

if (newSql.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    "[check-drizzle-drift] ✗ DRIFT — TS schema differs from the latest snapshot.\n" +
      `drizzle-kit would emit: ${newSql.join(", ")}\n` +
      "Run `pnpm db:generate`, review the output, and commit BOTH the new .sql\n" +
      "AND the matching meta/NNNN_snapshot.json together.\n" +
      "Never hand-edit a snapshot; never hand-write a migration .sql from scratch.\n" +
      "See AGENTS.md hard-rule 10a.",
  )
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log("[check-drizzle-drift] ✓ no drift; snapshot matches TS schema")
