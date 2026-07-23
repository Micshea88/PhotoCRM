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
    // Google OAuth (optional social sign-in — an ALTERNATE to email+password,
    // never a replacement). Both must be set to enable the "Continue with
    // Google" button; absent = the button is hidden and email/password is the
    // only path. Register an OAuth client in Google Cloud Console with redirect
    // URI `<app-url>/api/auth/callback/google`.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    // Pathway-staff account-recovery allowlist (Piece C). Comma-separated emails
    // that may access the cross-tenant recovery console. Set-once, no in-app way
    // to escalate. Blank = nobody (the console 404s for everyone).
    PATHWAY_SUPERADMIN_EMAILS: z.string().optional(),
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
    // Telephony — RingCentral OAuth token encryption at rest. 32 bytes,
    // hex-encoded (64 chars). Generate with `openssl rand -hex 32`.
    // REQUIRED — src/lib/crypto.ts cannot operate without it. The regex
    // is the strong invariant; productionGradeSecret() does not apply to
    // a binary key. Losing or changing this value renders every existing
    // ciphertext permanently undecryptable (see src/lib/crypto.ts header
    // for the recovery path).
    TELEPHONY_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, "TELEPHONY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)"),
    // RingCentral OAuth credentials. Optional in step 1 (table-only) so a
    // fresh dev clone without RC access still boots; step 2 (OAuth flow)
    // will read them at request time and error if missing. Not gated by
    // productionGradeSecret() — these are third-party-issued credentials,
    // not ones we generate; RC controls their entropy.
    RINGCENTRAL_CLIENT_ID: z.string().min(1).optional(),
    RINGCENTRAL_CLIENT_SECRET: z.string().min(1).optional(),
    // Sandbox: https://platform.devtest.ringcentral.com
    // Production: https://platform.ringcentral.com
    RINGCENTRAL_SERVER_URL: z.url().optional(),
    // Developer-set "Verification Token" RC includes as a header on every
    // webhook event (RC webhooks are not HMAC-signed — this token is the
    // per-event auth). Optional so non-RC deploys still boot; the webhook
    // route (Build 3) rejects events when it's unset/mismatched.
    //
    // Max length: RC enforces an UNDOCUMENTED ceiling on
    // deliveryMode.verificationToken — a 48-char value is rejected at
    // subscription-create with CMN-101 "value is invalid" (confirmed against
    // prod 2026-06-15; RC's own docs example is "hello-world", 11 chars). The
    // schema has no published max, so we cap at 40 to fail fast at boot with a
    // clear message instead of surfacing as a runtime RC 400 on the bootstrap
    // button.
    RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN: z
      .string()
      .min(1)
      .max(40, {
        message:
          "RC rejects verification tokens above ~40 chars — generate with openssl rand -hex 16 for a safe 32-char value",
      })
      .optional(),
    // Resend inbound webhook signing secret (Svix). Optional so non-configured
    // deploys still boot; the inbound route rejects events when unset/invalid.
    RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
    // Cloudmersive Virus Scan API key (Basic plan). Optional so non-configured
    // deploys still boot; uploads stay `pending` (un-attachable) when unset.
    CLOUDMERSIVE_API_KEY: z.string().min(1).optional(),
    // HMAC secret(s) for share-link "passcode verified" download cookies. Its
    // own security domain (not BETTER_AUTH_SECRET). Optional — falls back to
    // BETTER_AUTH_SECRET during rollout. Comma-separated for rotation: sign with
    // the first, verify against any (see share-link-crypto.ts). Rotating it only
    // forces recipients to re-enter the passcode; the link/passcode are unaffected.
    SHARE_LINK_HMAC_SECRET: z.string().min(1).optional(),
    // Nylas v3 email connector (Commit 4). Per-photographer Gmail/Outlook/IMAP
    // connection is brokered by Nylas hosted auth; the grant_id is stored
    // encrypted in email_connections.
    //
    // NYLAS_ENCRYPTION_KEY — REQUIRED, its own security domain (NOT the
    // telephony key). 32 bytes hex-encoded (64 chars); generate with
    // `openssl rand -hex 32`. Encrypts the stored Nylas grant_id + webhook
    // secret at rest via src/lib/crypto.ts. Losing/changing it renders every
    // stored grant permanently undecryptable — photographers simply reconnect.
    NYLAS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, "NYLAS_ENCRYPTION_KEY must be 64 hex chars (32 bytes)"),
    // Nylas application credentials. Optional so a fresh clone without Nylas
    // access still boots; the connect flow reads them at request time and
    // errors clearly if missing. Nylas issues these — not productionGradeSecret.
    NYLAS_API_KEY: z.string().min(1).optional(),
    NYLAS_CLIENT_ID: z.string().min(1).optional(),
    // Regional API base, e.g. https://api.us.nylas.com or https://api.eu.nylas.com
    NYLAS_API_URI: z.url().optional(),
    // Nylas webhook signing secret (shown once when the subscription is created
    // in the Nylas dashboard). Optional so non-configured deploys still boot;
    // the inbound route rejects deliveries when unset/invalid.
    NYLAS_WEBHOOK_SECRET: z.string().min(1).optional(),
    // Upstash Redis (REST) for the multi-region outbound rate-limit store (TODO
    // H9). BOTH optional: unset → the outbound gateway uses its in-memory store
    // (correct for a single Vercel region). Set BOTH to hold limits across
    // regions/instances. Created in the Upstash dashboard.
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
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
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    PATHWAY_SUPERADMIN_EMAILS: process.env.PATHWAY_SUPERADMIN_EMAILS,
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
    TELEPHONY_ENCRYPTION_KEY: process.env.TELEPHONY_ENCRYPTION_KEY,
    RINGCENTRAL_CLIENT_ID: process.env.RINGCENTRAL_CLIENT_ID,
    RINGCENTRAL_CLIENT_SECRET: process.env.RINGCENTRAL_CLIENT_SECRET,
    RINGCENTRAL_SERVER_URL: process.env.RINGCENTRAL_SERVER_URL,
    RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN: process.env.RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    CLOUDMERSIVE_API_KEY: process.env.CLOUDMERSIVE_API_KEY,
    SHARE_LINK_HMAC_SECRET: process.env.SHARE_LINK_HMAC_SECRET,
    NYLAS_ENCRYPTION_KEY: process.env.NYLAS_ENCRYPTION_KEY,
    NYLAS_API_KEY: process.env.NYLAS_API_KEY,
    NYLAS_CLIENT_ID: process.env.NYLAS_CLIENT_ID,
    NYLAS_API_URI: process.env.NYLAS_API_URI,
    NYLAS_WEBHOOK_SECRET: process.env.NYLAS_WEBHOOK_SECRET,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION || process.env.npm_lifecycle_event === "lint",
})
