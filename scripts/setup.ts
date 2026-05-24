#!/usr/bin/env tsx
/**
 * Interactive setup. Walks the developer through filling .env.local.
 * Reads .env.example, prompts only for variables that aren't already set,
 * and generates secrets for the slots that need them.
 *
 * Sage runs this on first checkout. Production env values live in Vercel,
 * never on a developer's machine.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { input, password, confirm } from "@inquirer/prompts"

const ENV_EXAMPLE = ".env.example"
const ENV_LOCAL = ".env.local"

interface Var {
  name: string
  description: string
  defaultValue?: string
  generate?: () => string
  hidden?: boolean
}

const VARS: Var[] = [
  {
    name: "DATABASE_URL",
    description: "Postgres connection string. For local dev use docker-compose.",
    defaultValue: "postgres://postgres:postgres@localhost:5432/pathway_dev",
  },
  {
    name: "BETTER_AUTH_SECRET",
    description: "32+ char random secret for Better Auth.",
    generate: () => randomBytes(32).toString("hex"),
    hidden: true,
  },
  {
    name: "BETTER_AUTH_URL",
    description: "Origin of the app (used for callback URLs).",
    defaultValue: "http://localhost:3000",
  },
  {
    name: "RESEND_API_KEY",
    description: "Resend API key (re_...). Use 're_dev_dummy_key' for local-only flows.",
    defaultValue: "re_dev_dummy_key",
    hidden: true,
  },
  {
    name: "RESEND_FROM_EMAIL",
    description: "From-address for outbound email.",
    defaultValue: "noreply@example.com",
  },
  {
    name: "RESEND_FROM_NAME",
    description:
      "Optional display name composed into the From: header (e.g. 'K&K Photo CRM'). Leave blank to send from the bare email.",
    defaultValue: "",
  },
  {
    name: "BLOB_READ_WRITE_TOKEN",
    description: "Vercel Blob token. Use any non-empty string for local-only flows.",
    defaultValue: "vercel_blob_dev_token_dummy",
    hidden: true,
  },
  {
    name: "CRON_SECRET",
    description: "Bearer token for Vercel Cron (16+ chars).",
    generate: () => randomBytes(24).toString("hex"),
    hidden: true,
  },
  {
    name: "QUEUE_SECRET",
    description: "Shared secret for queue producer/consumer (16+ chars).",
    generate: () => randomBytes(24).toString("hex"),
    hidden: true,
  },
  {
    name: "SENTRY_DSN",
    description: "Sentry DSN (server). Leave blank to disable.",
    defaultValue: "",
  },
  {
    name: "NEXT_PUBLIC_SENTRY_DSN",
    description: "Sentry DSN (browser). Same value as SENTRY_DSN. Required for client errors.",
    defaultValue: "",
  },
  {
    name: "SENTRY_AUTH_TOKEN",
    description: "Sentry auth token (build-time only, for source-map upload).",
    defaultValue: "",
    hidden: true,
  },
  {
    name: "SENTRY_ORG",
    description: "Sentry org slug (find it in your Sentry project URL).",
    defaultValue: "",
  },
  {
    name: "SENTRY_PROJECT",
    description: "Sentry project slug.",
    defaultValue: "",
  },
  {
    name: "ANTHROPIC_API_KEY",
    description:
      "Anthropic API key (sk-ant-...). Leave blank to disable the AI Workflow Builder (graceful disable; no crash).",
    defaultValue: "",
    hidden: true,
  },
  {
    name: "AI_WORKFLOW_BUILDER_MODEL",
    description: "Anthropic model id for the AI Workflow Builder.",
    defaultValue: "claude-sonnet-4-6",
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    description: "Public URL of the app.",
    defaultValue: "http://localhost:3000",
  },
]

function readExisting(): Record<string, string> {
  if (!existsSync(ENV_LOCAL)) return {}
  const text = readFileSync(ENV_LOCAL, "utf8")
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return out
}

function writeEnv(values: Record<string, string>) {
  const lines: string[] = []
  if (existsSync(ENV_EXAMPLE)) {
    const example = readFileSync(ENV_EXAMPLE, "utf8")
    for (const line of example.split("\n")) {
      if (!line.trim() || line.startsWith("#")) {
        lines.push(line)
        continue
      }
      const eq = line.indexOf("=")
      if (eq === -1) {
        lines.push(line)
        continue
      }
      const key = line.slice(0, eq)
      const v = values[key]
      lines.push(`${key}=${v ?? ""}`)
    }
  } else {
    for (const [k, v] of Object.entries(values)) {
      lines.push(`${k}=${v}`)
    }
  }
  writeFileSync(ENV_LOCAL, lines.join("\n"))
}

async function main() {
  console.log("Pathway Foundation setup")
  console.log("------------------------")
  console.log("This walks you through filling .env.local. It will not overwrite values")
  console.log("you've already set unless you confirm.\n")

  const existing = readExisting()
  const values: Record<string, string> = { ...existing }

  const overwriteAll =
    Object.keys(existing).length > 0
      ? await confirm({
          message: ".env.local already exists. Re-prompt for each value?",
          default: false,
        })
      : true

  for (const v of VARS) {
    const has = !!existing[v.name] && !overwriteAll
    if (has) continue

    if (v.generate && !existing[v.name]) {
      const useGenerated = await confirm({
        message: `Generate a random ${v.name}?`,
        default: true,
      })
      if (useGenerated) {
        values[v.name] = v.generate()
        continue
      }
    }

    const promptOpts = {
      message: `${v.name} — ${v.description}`,
      default: existing[v.name] ?? v.defaultValue,
    }
    values[v.name] = v.hidden
      ? await password({ ...promptOpts, mask: "*" })
      : await input(promptOpts)
  }

  writeEnv(values)
  console.log(`\n✓ Wrote ${ENV_LOCAL}`)
  console.log("\nNext:")
  console.log("  docker compose up -d   # start local Postgres")
  console.log("  pnpm db:migrate        # apply migrations")
  console.log("  pnpm dev               # start the app")
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
