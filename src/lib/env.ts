import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

/**
 * Refuses obviously-low-entropy or known-dev secret values when actually
 * running in Vercel production.
 *
 * Why: nothing prevents a config copy/paste from putting a dev placeholder
 * (e.g. `dev_secret_at_least_thirty_two_chars_long_for_local_only`) into a
 * Vercel project env var. If that happens, sessions can be forged by anyone
 * who reads this repo. Refuse to boot if it does.
 *
 * Gated on VERCEL_ENV === "production" (not just NODE_ENV) so a local
 * `pnpm build` against `.env.local` doesn't trip — `next build` forces
 * NODE_ENV=production internally, but a local laptop build is not the
 * threat model.
 */
function productionGradeSecret(name: string) {
  return z
    .string()
    .min(16)
    .superRefine((val, ctx) => {
      if (process.env.VERCEL_ENV !== "production") return
      const lower = val.toLowerCase()
      const banned = ["dev", "local", "test", "demo", "example", "changeme", "change-me", "dummy"]
      if (banned.some((b) => lower.includes(b))) {
        ctx.addIssue({
          code: "custom",
          message: `${name} contains a known-dev marker (one of: ${banned.join(", ")}). Generate a fresh secret with: openssl rand -hex 32`,
        })
      }
      // Shannon entropy: dev placeholders tend to score below ~3.0 bits/char.
      const counts = new Map<string, number>()
      for (const ch of val) counts.set(ch, (counts.get(ch) ?? 0) + 1)
      let entropy = 0
      for (const c of counts.values()) {
        const p = c / val.length
        entropy -= p * Math.log2(p)
      }
      if (entropy < 3.0) {
        ctx.addIssue({
          code: "custom",
          message: `${name} appears to be low-entropy (${entropy.toFixed(2)} bits/char). Generate a fresh secret with: openssl rand -hex 32`,
        })
      }
    })
}

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: productionGradeSecret("BETTER_AUTH_SECRET").pipe(z.string().min(32)),
    BETTER_AUTH_URL: z.url(),
    RESEND_API_KEY: z.string().min(1),
    RESEND_FROM_EMAIL: z.email(),
    // Push 2c.6.7 — optional display name composed into the From:
    // header at send time, e.g. RESEND_FROM_NAME="K&K Photo CRM"
    // produces `K&K Photo CRM <invitations@mail.kandkphotography.com>`.
    // Kept separate from RESEND_FROM_EMAIL so the email field stays
    // strictly z.email()-validatable (RFC 5322 mailbox format with a
    // display name is NOT a plain email and would fail the schema).
    RESEND_FROM_NAME: z.string().min(1).optional(),
    BLOB_READ_WRITE_TOKEN: z.string().min(1),
    CRON_SECRET: productionGradeSecret("CRON_SECRET"),
    QUEUE_SECRET: productionGradeSecret("QUEUE_SECRET"),
    SENTRY_DSN: z.url().optional().or(z.literal("")),
    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_ORG: z.string().optional(),
    SENTRY_PROJECT: z.string().optional(),
    // AI Workflow Builder (module 16b). Optional everywhere: when key
    // is missing the module GRACEFULLY DISABLES with a clear
    // "AI Workflow Builder not configured" error — no crash, no
    // build failure. The model var has a sane default.
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_WORKFLOW_BUILDER_MODEL: z.string().min(1).default("claude-sonnet-4-6"),
    // Rate-limit ENV reads. Operator-cost backstop, NOT a user paywall.
    // Defaults are generous (invisible to honest use; hard ceiling only
    // against runaway / abuse / bug). See ai-workflow-builder/README.md.
    AI_WORKFLOW_BUILDER_HOURLY_USER: z.coerce.number().int().min(1).default(100),
    AI_WORKFLOW_BUILDER_HOURLY_ORG: z.coerce.number().int().min(1).default(500),
    AI_WORKFLOW_BUILDER_DAILY_ORG: z.coerce.number().int().min(1).default(2000),
    // AI Assistant (module 17). Same operator-cost-backstop posture —
    // NOT a user paywall. Higher defaults than the workflow builder
    // because conversation volume is higher than drafting volume.
    AI_ASSISTANT_HOURLY_USER: z.coerce.number().int().min(1).default(300),
    AI_ASSISTANT_HOURLY_ORG: z.coerce.number().int().min(1).default(1500),
    AI_ASSISTANT_DAILY_ORG: z.coerce.number().int().min(1).default(6000),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    // Browser Sentry needs its own DSN var because Next.js does NOT inline
    // server-only env vars into the client bundle. Set this to the same value
    // as SENTRY_DSN in Vercel to enable client-side error reporting.
    NEXT_PUBLIC_SENTRY_DSN: z.url().optional().or(z.literal("")),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    RESEND_FROM_NAME: process.env.RESEND_FROM_NAME,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    CRON_SECRET: process.env.CRON_SECRET,
    QUEUE_SECRET: process.env.QUEUE_SECRET,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_WORKFLOW_BUILDER_MODEL: process.env.AI_WORKFLOW_BUILDER_MODEL,
    AI_WORKFLOW_BUILDER_HOURLY_USER: process.env.AI_WORKFLOW_BUILDER_HOURLY_USER,
    AI_WORKFLOW_BUILDER_HOURLY_ORG: process.env.AI_WORKFLOW_BUILDER_HOURLY_ORG,
    AI_WORKFLOW_BUILDER_DAILY_ORG: process.env.AI_WORKFLOW_BUILDER_DAILY_ORG,
    AI_ASSISTANT_HOURLY_USER: process.env.AI_ASSISTANT_HOURLY_USER,
    AI_ASSISTANT_HOURLY_ORG: process.env.AI_ASSISTANT_HOURLY_ORG,
    AI_ASSISTANT_DAILY_ORG: process.env.AI_ASSISTANT_DAILY_ORG,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION || process.env.npm_lifecycle_event === "lint",
})
