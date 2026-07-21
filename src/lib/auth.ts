import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization, haveIBeenPwned } from "better-auth/plugins"
import { createAuthMiddleware, APIError } from "better-auth/api"
import { db } from "@/lib/db"
import { passwordCompositionError } from "@/modules/auth/password-policy"
import { env } from "@/lib/env"
import { sendEmail } from "@/lib/email"
import { seedNewOrganization } from "@/lib/seed-new-org"
import { seedNewMember } from "@/lib/seed-new-member"
import type { BetterAuthRole } from "@/modules/rbac/types"
import { OrgInviteEmail } from "@/emails/org-invite"
import { ResetPasswordEmail } from "@/emails/reset-password"
import { VerifyEmail } from "@/emails/verify-email"
import { resolveAuthOrigins } from "@/lib/auth-origins"

// Preview-aware baseURL + trustedOrigins (see resolveAuthOrigins). VERCEL_ENV
// /VERCEL_URL are Vercel-injected; absent locally and in production builds,
// both of which therefore use the canonical BETTER_AUTH_URL unchanged.
const { baseURL: authBaseURL, trustedOrigins: authTrustedOrigins } = resolveAuthOrigins({
  betterAuthUrl: env.BETTER_AUTH_URL,
  vercelEnv: process.env.VERCEL_ENV,
  vercelUrl: process.env.VERCEL_URL,
  vercelBranchUrl: process.env.VERCEL_BRANCH_URL,
})

// Google social sign-in — an OPTIONAL alternate to email+password. Registered
// only when BOTH creds are present, so a deploy without them simply falls back
// to email/password (the button is hidden client-side by the same signal).
const googleClientId = env.GOOGLE_CLIENT_ID
const googleClientSecret = env.GOOGLE_CLIENT_SECRET
const socialProviders =
  googleClientId && googleClientSecret
    ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
    : undefined

// The password-setting endpoints — server-side composition (below) and the HIBP
// plugin both guard these so the rules can't be skipped by bypassing the form.
const PASSWORD_ENDPOINTS = new Set(["/sign-up/email", "/change-password", "/reset-password"])

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  baseURL: authBaseURL,
  trustedOrigins: authTrustedOrigins,
  secret: env.BETTER_AUTH_SECRET,
  // Server-side password composition (policy #11) — enforced at the API, not just
  // the form, so min-8+composition can't be bypassed. Same paths the HIBP plugin
  // guards. Min-length itself is enforced by emailAndPassword.minPasswordLength.
  hooks: {
    // eslint-disable-next-line @typescript-eslint/require-await -- middleware type expects an async handler; the composition check is synchronous
    before: createAuthMiddleware(async (ctx) => {
      if (!PASSWORD_ENDPOINTS.has(ctx.path)) return
      const body = ctx.body as { password?: unknown; newPassword?: unknown } | undefined
      const pw =
        typeof body?.password === "string"
          ? body.password
          : typeof body?.newPassword === "string"
            ? body.newPassword
            : null
      if (pw === null) return
      const message = passwordCompositionError(pw)
      if (message) throw new APIError("BAD_REQUEST", { message })
    }),
  },
  ...(socialProviders ? { socialProviders } : {}),
  // Auto-link a Google sign-in to an EXISTING email/password account only when
  // the provider's email is verified. Google always returns verified emails, so
  // `trustedProviders: ["google"]` is the "link on verified email" guard — it
  // prevents hijacking an existing account via an unverified social identity.
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  emailAndPassword: {
    enabled: true,
    // Required in real production. The PLAYWRIGHT_E2E escape hatch is set
    // only by `playwright.config.ts` so the e2e suite (which runs the prod
    // build via `pnpm build && pnpm start`) can complete sign-up without
    // an email round-trip. Vercel never sets PLAYWRIGHT_E2E, so this can't
    // be triggered in real deployments.
    requireEmailVerification: env.NODE_ENV === "production" && process.env.PLAYWRIGHT_E2E !== "1",
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your Pathway password",
        react: ResetPasswordEmail({ url, userName: user.name }),
      })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your Pathway email",
        react: VerifyEmail({ url, userName: user.name }),
      })
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  // Better Auth's built-in rate limiter. Enabled by default in production with
  // window=10s/max=100. Sensitive paths get stricter custom rules so credential
  // stuffing and password-reset spam are bounded. Storage is in-memory by
  // default — if you scale beyond one Vercel region, switch `storage` to a
  // shared store (Upstash) so limits apply across instances.
  rateLimit: {
    enabled: env.NODE_ENV === "production",
    window: 10,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forget-password": { window: 300, max: 3 },
      "/reset-password": { window: 300, max: 5 },
      "/verify-email": { window: 60, max: 10 },
      "/send-verification-email": { window: 300, max: 3 },
      "/organization/invite-member": { window: 60, max: 10 },
      "/organization/accept-invitation": { window: 60, max: 10 },
    },
  },
  plugins: [
    organization({
      cancelPendingInvitationsOnReInvite: true,
      sendInvitationEmail: async (data) => {
        const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/accept-invite/${data.id}`
        await sendEmail({
          to: data.email,
          subject: `You've been invited to ${data.organization.name}`,
          react: OrgInviteEmail({
            url: inviteUrl,
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name,
          }),
        })
      },
      // Cross-module seeds for org lifecycle events. Better Auth commits
      // the relevant `organization`/`member` rows before these fire, so
      // ids and membership are reliable. Both seeds capture failures
      // (log + Sentry); the hooks never throw so a partial-seed doesn't
      // wedge sign-up or invitation acceptance.
      organizationHooks: {
        afterCreateOrganization: async ({ organization: org, user: usr }) => {
          await seedNewOrganization(org.id, usr.id)
        },
        afterAcceptInvitation: async ({
          organization: org,
          user: usr,
          member: mem,
          invitation: inv,
        }) => {
          // Push 2c.6.4 — pass invitation.id so seedNewMember can look
          // up the invitation_extended_role metadata row and use the
          // inviter's intended extended role instead of the BA-mapped
          // default.
          await seedNewMember(org.id, usr.id, mem.role as BetterAuthRole, inv.id)
        },
      },
    }),
    // HIBP breach screening — the load-bearing password control (policy #11).
    // Rejects passwords found in known breach corpuses via k-anonymity (no API
    // key). Guards sign-up + change-password + reset-password by default.
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        "This password has appeared in a data breach. Please choose a different one.",
    }),
  ],
})

export type Auth = typeof auth
