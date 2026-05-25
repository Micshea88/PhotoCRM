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
import { setActiveOrgAndPersist } from "@/modules/auth/ui/persist-active-org"
import { resolveSignInActiveOrg } from "@/modules/auth/actions"

const schema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
})

type Values = z.infer<typeof schema>

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
    const result = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    })
    if (result.error) {
      setSubmitting(false)
      setError(result.error.message ?? "Sign-in failed")
      return
    }
    // Push 2c.6.11 — multi-org-aware active-org resolution. Replaces
    // the pre-2c.6.11 arbitrary `orgs[0]` pick. Priority:
    //   1. user.last_active_organization_id, if still a valid
    //      membership → restore
    //   2. exactly ONE membership → auto-pick
    //   3. multiple memberships, no valid last-active → null
    //      (the switcher in the topbar handles selection on first
    //      page load)
    //   4. zero memberships → null (onboarding flow takes over)
    const session = await authClient.getSession()
    const hasActive = !!session.data?.session.activeOrganizationId
    if (!hasActive) {
      const resolution = await resolveSignInActiveOrg({})
      const chosen = resolution.data?.organizationId
      if (chosen) {
        await setActiveOrgAndPersist(chosen)
      }
    }
    setSubmitting(false)
    router.push(redirectTo)
    router.refresh()
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
        {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
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
