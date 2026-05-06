"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

const schema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
})

type Values = z.infer<typeof schema>

export function SignInForm() {
  const router = useRouter()
  const params = useSearchParams()
  const redirectTo = params.get("redirect") ?? "/dashboard"
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })

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
    // Restore an active organization from the user's memberships if none is set.
    // Better Auth doesn't persist activeOrganizationId across sign-out/sign-in.
    const orgs = await authClient.organization.list()
    const session = await authClient.getSession()
    const hasActive = !!session.data?.session.activeOrganizationId
    if (!hasActive && orgs.data && orgs.data.length > 0) {
      const first = orgs.data[0]
      if (first) {
        await authClient.organization.setActive({ organizationId: first.id })
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
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
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
    </form>
  )
}
