import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization } from "better-auth/plugins"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { sendEmail } from "@/lib/email"
import { OrgInviteEmail } from "@/emails/org-invite"
import { ResetPasswordEmail } from "@/emails/reset-password"
import { VerifyEmail } from "@/emails/verify-email"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification:
      env.NODE_ENV === "production" && env.AUTH_REQUIRE_EMAIL_VERIFICATION === "true",
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
    }),
  ],
})

export type Auth = typeof auth
