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

const schema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
})

type Values = z.infer<typeof schema>

// Anti-enumeration: the same message for any credential failure, so the
// form never reveals whether an email is registered.
const INVALID_CREDENTIALS = "Invalid email or password"
const GENERIC_ERROR = "Something went wrong, please try again."

export function SignInForm() {
  const router = useRouter()
  const params = useSearchParams()
  const redirectTo = params.get("redirect") ?? "/dashboard"
  // Push 2c.6.8 — when the user arrived from /accept-invite/[token]
  // the page propagates the invited email through `?email=`. Pre-fill
  // and lock the email field so the user signs in with the correct
  // address. Server-side enforcement (acceptOrgInvitation + BA's
  // built-in check) is still load-bearing; this is the UX nudge.
  const lockedEmail = params.get("email")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    try {
      const result = await authClient.signIn.email({
        email: values.email,
        password: values.password,
      })
      if (result.error) {
        // Anti-enumeration: never reveal whether the email exists. A 5xx
        // is an infrastructure failure, not a credential mismatch, so it
        // gets the generic message instead.
        setError(result.error.status >= 500 ? GENERIC_ERROR : INVALID_CREDENTIALS)
        return
      }
      // Restore an active organization from the user's memberships if none is
      // set. Better Auth doesn't persist activeOrganizationId across
      // sign-out/sign-in. V1 enforces one-email-one-org at invite time, so
      // this list has at most one entry in practice. Best-effort: a transient
      // failure here must NOT strand the user on a dead form — they're already
      // signed in, and the active org resolves on the next page load.
      try {
        const orgs = await authClient.organization.list()
        const session = await authClient.getSession()
        const hasActive = !!session.data?.session.activeOrganizationId
        if (!hasActive && orgs.data && orgs.data.length > 0) {
          const first = orgs.data[0]
          if (first) {
            await authClient.organization.setActive({ organizationId: first.id })
          }
        }
      } catch {
        // Non-fatal — proceed to the redirect; org context resolves on load.
      }
      router.push(redirectTo)
      router.refresh()
    } catch {
      // Network error, or the auth client threw instead of returning
      // { error }. Never leave the button stuck on "Signing in…".
      setError(GENERIC_ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
        {errors.email && (
          <p className="text-xs text-[var(--color-destructive)]">{errors.email.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput id="password" autoComplete="current-password" {...register("password")} />
        {errors.password && (
          <p className="text-xs text-[var(--color-destructive)]">{errors.password.message}</p>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
      {lockedEmail && (
        <p className="text-center text-sm text-[var(--color-muted-foreground)]">
          New here?{" "}
          <Link
            href={`/sign-up?${(() => {
              const r = params.get("redirect")
              const qp = new URLSearchParams({ email: lockedEmail })
              if (r) qp.set("redirect", r)
              return qp.toString()
            })()}`}
            className="font-medium underline"
          >
            Create an account with {lockedEmail}
          </Link>
        </p>
      )}
    </form>
  )
}
