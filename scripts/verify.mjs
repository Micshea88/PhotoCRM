#!/usr/bin/env node
import { spawn } from "node:child_process"
import net from "node:net"
import { existsSync, readFileSync } from "node:fs"

// Load .env.local for the preflight DB probe so users don't have to
// `set -a; source .env.local; set +a` first. Sub-processes (vitest, next)
// load their own envs.
function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    const val = trimmed.slice(eq + 1)
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvFile(".env.local")
loadEnvFile(".env")

const args = process.argv.slice(2)
const tierArg = args.find((a) => a.startsWith("--tier="))
const tier = tierArg ? Number(tierArg.split("=")[1]) : 2

const TIER1 = [
  { name: "typecheck", cmd: "pnpm", args: ["typecheck"] },
  { name: "lint", cmd: "pnpm", args: ["lint"] },
  { name: "check-actions", cmd: "node", args: ["scripts/check-actions.mjs"] },
  { name: "check-rls-force", cmd: "node", args: ["scripts/check-rls-force.mjs"] },
  // Snapshot-drift guard — journal/snapshot integrity + sandbox generate.
  // VERIFY PATH ONLY. NEVER add to the Vercel build command — a false
  // positive there would block prod deploys. See AGENTS.md hard-rule 10a.
  { name: "check-drizzle-drift", cmd: "node", args: ["scripts/check-drizzle-drift.mjs"] },
  { name: "test:unit", cmd: "pnpm", args: ["test:unit"] },
]
const TIER2 = [
  ...TIER1,
  { name: "test:integration", cmd: "pnpm", args: ["test:integration"], needsDb: true },
  { name: "build", cmd: "pnpm", args: ["build"] },
]
const TIER3 = [...TIER2, { name: "test:e2e", cmd: "pnpm", args: ["test:e2e"], needsDb: true }]

const tiers = { 1: TIER1, 2: TIER2, 3: TIER3 }
const steps = tiers[tier]
if (!steps) {
  console.error(`Unknown tier: ${tier}. Use --tier=1, --tier=2, or --tier=3`)
  process.exit(2)
}

/**
 * Friendly preflight: if the tier needs a DB, probe DATABASE_URL's host:port
 * and abort with a helpful message if Postgres isn't reachable. Without this,
 * users get a cryptic ECONNREFUSED stack trace from inside vitest.
 */
async function dbReachable() {
  const url = process.env.DATABASE_URL
  if (!url) return { ok: false, reason: "DATABASE_URL is not set" }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: `DATABASE_URL is not a valid URL: ${url}` }
  }
  const host = parsed.hostname
  const port = Number(parsed.port || "5432")
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let settled = false
    const finish = (ok, reason) => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve({ ok, reason })
    }
    sock.setTimeout(2000)
    sock.once("connect", () => finish(true))
    sock.once("error", (e) => finish(false, e.message))
    sock.once("timeout", () => finish(false, "timeout"))
    sock.connect(port, host)
  })
}

if (steps.some((s) => s.needsDb)) {
  const probe = await dbReachable()
  if (!probe.ok) {
    console.error(
      `\n✘ Postgres is not reachable (${probe.reason}).\n` +
        `   Start it with: docker compose up -d\n` +
        `   Then re-run: pnpm verify --tier=${tier}\n`,
    )
    process.exit(1)
  }
}

console.log(`\n=== verify --tier=${tier} (${steps.length} steps) ===\n`)

for (const step of steps) {
  console.log(`\n--- ${step.name} ---`)
  const code = await new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, { stdio: "inherit" })
    child.on("exit", (c) => resolve(c ?? 1))
  })
  if (code !== 0) {
    console.error(`\n✘ ${step.name} failed (exit ${code})`)
    process.exit(code)
  }
  console.log(`✓ ${step.name}`)
}

console.log(`\n=== verify --tier=${tier} passed ===\n`)
