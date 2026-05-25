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
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { isValidCallbackUrl } from "@/modules/auth/callback-url"

const schema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.email("Enter a valid email"),
  password: z.string().min(12, "Password must be at least 12 characters"),
})

type Values = z.infer<typeof schema>

export function SignUpForm() {
  const router = useRouter()
  const params = useSearchParams()
  // Push 2c.6.8 — when arriving via /accept-invite/[token] → /sign-in
  // → "Create an account" the invited email is propagated as a URL
  // param so the account-creation form pre-fills + locks the email.
  // Defense-in-depth with acceptOrgInvitation's server-side check.
  const lockedEmail = params.get("email")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verificationSent, setVerificationSent] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: lockedEmail ? { email: lockedEmail } : undefined,
  })

  async function onSubmit(values: Values) {
    setSubmitting(true)
    setError(null)
    // Push 2c.6.11 — when this signup is part of an invitation flow
    // (the user arrived via /accept-invite/[token] → /sign-up?redirect=...),
    // forward that redirect as `callbackURL` to BA's signUp.email so
    // BA bakes it into the verification email link. After clicking
    // verify, the user lands back at /accept-invite/[token] instead
    // of being shunted to /dashboard → /onboarding/create-organization.
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
      setError(result.error.message ?? "Sign-up failed")
      return
    }
    // If a session/token came back, the user is signed in — proceed
    // to the redirect param (e.g. back to /accept-invite/[token] for
    // invite-flow signups) or fall through to onboarding.
    // Otherwise email verification is required; surface the inbox prompt.
    const session = await authClient.getSession()
    setSubmitting(false)
    if (session.data?.session) {
      const redirectTo = params.get("redirect") ?? "/onboarding/create-organization"
      router.push(redirectTo)
      router.refresh()
      return
    }
    setVerificationSent(true)
  }

  if (verificationSent) {
    return (
      <Alert>
        <AlertDescription>
          Check your email for a verification link. Once you click it, you can sign in.
        </AlertDescription>
      </Alert>
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
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password")}
        />
        {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
      </div>
      {error && (
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
