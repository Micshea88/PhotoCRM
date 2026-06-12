"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

const schema = z
  .object({
    password: z.string().min(12, "Password must be at least 12 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  })

type Values = z.infer<typeof schema>

export function ResetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Reset link is invalid or expired.</AlertDescription>
      </Alert>
    )
  }

  async function onSubmit(values: Values) {
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await authClient.resetPassword({
        newPassword: values.password,
        token,
      })
      if (result.error) {
        // An invalid/expired/used token is the common, actionable case;
        // anything 5xx is an infra failure. Either way the user needs a
        // clear next step, not a dead spinner.
        setError(
          result.error.status >= 500
            ? "Something went wrong, please try again."
            : "This reset link is invalid or has expired. Request a new one.",
        )
        return
      }
      router.push("/sign-in")
    } catch {
      // Network error / client threw — never strand on "Resetting…".
      setError("Something went wrong, please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <PasswordInput id="password" autoComplete="new-password" {...register("password")} />
        {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <PasswordInput id="confirm" autoComplete="new-password" {...register("confirm")} />
        {errors.confirm && <p className="text-xs text-red-600">{errors.confirm.message}</p>}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Resetting…" : "Set new password"}
      </Button>
    </form>
  )
}
