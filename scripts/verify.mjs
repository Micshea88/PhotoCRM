#!/usr/bin/env node
import { spawn } from "node:child_process"

const args = process.argv.slice(2)
const tierArg = args.find((a) => a.startsWith("--tier="))
const tier = tierArg ? Number(tierArg.split("=")[1]) : 2

const tiers = {
  1: [
    { name: "typecheck", cmd: "pnpm", args: ["typecheck"] },
    { name: "lint", cmd: "pnpm", args: ["lint"] },
    { name: "test:unit", cmd: "pnpm", args: ["test:unit"] },
  ],
  2: [
    { name: "typecheck", cmd: "pnpm", args: ["typecheck"] },
    { name: "lint", cmd: "pnpm", args: ["lint"] },
    { name: "test:unit", cmd: "pnpm", args: ["test:unit"] },
    { name: "test:integration", cmd: "pnpm", args: ["test:integration"] },
    { name: "build", cmd: "pnpm", args: ["build"] },
  ],
  3: [
    { name: "typecheck", cmd: "pnpm", args: ["typecheck"] },
    { name: "lint", cmd: "pnpm", args: ["lint"] },
    { name: "test:unit", cmd: "pnpm", args: ["test:unit"] },
    { name: "test:integration", cmd: "pnpm", args: ["test:integration"] },
    { name: "build", cmd: "pnpm", args: ["build"] },
    { name: "test:e2e", cmd: "pnpm", args: ["test:e2e"] },
  ],
}

const steps = tiers[tier]
if (!steps) {
  console.error(`Unknown tier: ${tier}. Use --tier=1, --tier=2, or --tier=3`)
  process.exit(2)
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
