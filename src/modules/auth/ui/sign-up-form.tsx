"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { isValidCallbackUrl } from "@/modules/auth/callback-url"

const schema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.email("Enter a valid email"),
    password: z.string().min(12, "Password must be at least 12 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match",
      })
    }
  })

type Values = z.infer<typeof schema>

/**
 * Push 2c.6.11 — heuristics for showing the "Account already exists,
 * sign in instead" remediation. BA exposes the error code through
 * `result.error.code` (we verified against
 * node_modules/better-auth/dist/plugins/admin/error-codes.mjs:6
 * which uses `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`). Belt-and-
 * suspenders: also check the message string for "already exists" in
 * case a future BA version renames the code.
 */
function isAccountExistsError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false
  if (err.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return true
  if (typeof err.message === "string" && /already\s+exists/i.test(err.message)) return true
  return false
}

export function SignUpForm() {
  const router = useRouter()
  const params = useSearchParams()
  const lockedEmail = params.get("email")
  // Push 2c.6.11 — invite-flow detection rule. `?redirect=` value
  // must start with `/accept-invite/`. `?email=` alone does NOT
  // trigger (the "account exists" remediation link below adds
  // ?email= outside invite context). Used to suppress the "Wrong
  // email?" affordance in the verification-sent state.
  const inviteFlow = (() => {
    const r = params.get("redirect")
    return typeof r === "string" && r.startsWith("/accept-invite/")
  })()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountExistsEmail, setAccountExistsEmail] = useState<string | null>(null)
  const [verificationSent, setVerificationSent] = useState(false)
  const [verificationSentEmail, setVerificationSentEmail] = useState<string>("")
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: lockedEmail ? { email: lockedEmail } : undefined,
  })

  async function onSubmit(values: Values) {
    setSubmitting(true)
    setError(null)
    setAccountExistsEmail(null)
    const rawRedirect = params.get("redirect")
    const callbackURL = isValidCallbackUrl(rawRedirect) ? rawRedirect : undefined
    const result = await authClient.signUp.email({
      email: values.email,
      password: values.password,
      name: values.name,
      ...(callbackURL ? { callbackURL } : {}),
    })
    if (result.error) {
      setSubmitting(false)
      if (isAccountExistsError(result.error)) {
        setAccountExistsEmail(values.email)
        return
      }
      setError(result.error.message ?? "Sign-up failed")
      return
    }
    const session = await authClient.getSession()
    setSubmitting(false)
    if (session.data?.session) {
      const redirectTo = isValidCallbackUrl(rawRedirect)
        ? rawRedirect
        : "/onboarding/create-organization"
      router.push(redirectTo)
      router.refresh()
      return
    }
    setVerificationSentEmail(values.email)
    setVerificationSent(true)
  }

  async function resendVerification() {
    if (!verificationSentEmail) return
    setResending(true)
    setResendMsg(null)
    const rawRedirect = params.get("redirect")
    const callbackURL = isValidCallbackUrl(rawRedirect) ? rawRedirect : undefined
    const result = await authClient.sendVerificationEmail({
      email: verificationSentEmail,
      ...(callbackURL ? { callbackURL } : {}),
    })
    setResending(false)
    if (result.error) {
      // BA's rate limiter for /send-verification-email is window=300,
      // max=3 (src/lib/auth.ts:69). If exceeded, BA returns 429.
      const msg = result.error.message ?? "Could not resend"
      setResendMsg({
        kind: "error",
        text: /rate|too many|limit/i.test(msg)
          ? "You've requested a verification email recently. Try again in a few minutes."
          : msg,
      })
      return
    }
    setResendMsg({ kind: "ok", text: "Verification email sent. Check your inbox." })
  }

  function wrongEmail() {
    setVerificationSent(false)
    setVerificationSentEmail("")
    setResendMsg(null)
    reset()
  }

  if (verificationSent) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            <p className="font-medium">Check your inbox at {verificationSentEmail}.</p>
            <p className="mt-2 text-sm">
              Click the verification link in the email to finish setting up your account.
            </p>
          </AlertDescription>
        </Alert>
        {resendMsg && (
          <Alert variant={resendMsg.kind === "error" ? "destructive" : "default"}>
            <AlertDescription>{resendMsg.text}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => void resendVerification()}
            disabled={resending}
          >
            {resending ? "Resending…" : "Resend email"}
          </Button>
          {/*
           * Wrong-email affordance is suppressed in the invite flow
           * (the email is locked there anyway; offering "wrong
           * email?" would be misleading — they can't change it).
           */}
          {!inviteFlow && (
            <Button type="button" variant="ghost" onClick={wrongEmail}>
              Wrong email?
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" autoComplete="name" {...register("name")} />
        {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          readOnly={!!lockedEmail}
          {...register("email")}
        />
        {lockedEmail && (
          <p className="text-xs text-[var(--color-muted-foreground)]">
            This invitation was sent to {lockedEmail}. To use a different email, ask the inviter to
            send a new invitation.
          </p>
        )}
        {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput id="password" autoComplete="new-password" {...register("password")} />
        {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p className="text-xs text-red-600">{errors.confirmPassword.message}</p>
        )}
      </div>
      {accountExistsEmail && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>An account with this email already exists.</p>
            <p className="mt-2">
              <Link
                href={`/sign-in?${(() => {
                  const r = params.get("redirect")
                  const qp = new URLSearchParams({ email: accountExistsEmail })
                  if (r) qp.set("redirect", r)
                  return qp.toString()
                })()}`}
                className="font-medium underline"
              >
                Sign in instead
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      )}
      {error && !accountExistsEmail && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating account…" : "Create account"}
      </Button>
      {lockedEmail && (
        <p className="text-center text-sm text-[var(--color-muted-foreground)]">
          Already have an account?{" "}
          <Link
            href={`/sign-in?${(() => {
              const r = params.get("redirect")
              const qp = new URLSearchParams({ email: lockedEmail })
              if (r) qp.set("redirect", r)
              return qp.toString()
            })()}`}
            className="font-medium underline"
          >
            Sign in with {lockedEmail}
          </Link>
        </p>
      )}
    </form>
  )
}
