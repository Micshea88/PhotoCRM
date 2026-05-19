import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { sendEmail } from "@/lib/email"
import { seedNewOrganization } from "@/lib/seed-new-org"
import { OrgInviteEmail } from "@/emails/org-invite"
import { ResetPasswordEmail } from "@/emails/reset-password"
import { VerifyEmail } from "@/emails/verify-email"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    // Required in real production. The PLAYWRIGHT_E2E escape hatch is set
    // only by `playwright.config.ts` so the e2e suite (which runs the prod
    // build via `pnpm build && pnpm start`) can complete sign-up without
    // an email round-trip. Vercel never sets PLAYWRIGHT_E2E, so this can't
    // be triggered in real deployments.
    requireEmailVerification: env.NODE_ENV === "production" && process.env.PLAYWRIGHT_E2E !== "1",
    minPasswordLength: 12,
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
      // Cross-module seed for new orgs. Better Auth has already inserted
      // the organization and member rows by the time this fires, so we
      // can rely on the ids and the user being a real member. Errors are
      // captured in seedNewOrganization (logged + Sentry); the hook
      // never throws so a partial-seed doesn't fail the signup.
      organizationHooks: {
        afterCreateOrganization: async ({ organization: org, user: usr }) => {
          await seedNewOrganization(org.id, usr.id)
        },
      },
    }),
  ],
})

export type Auth = typeof auth
