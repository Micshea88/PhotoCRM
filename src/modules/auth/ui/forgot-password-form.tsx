"use client"

import { useState } from "react"
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
})

type Values = z.infer<typeof schema>

// Anti-enumeration: shown for both success and "no such account" so the
// form never reveals whether an email is registered.
const RESET_CONFIRMATION = "If an account with that email exists, we've sent a reset link."
const GENERIC_ERROR = "Something went wrong, please try again."

export function ForgotPasswordForm() {
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  async function onSubmit(values: Values) {
    setSubmitting(true)
    setError(null)
    try {
      const result = await authClient.requestPasswordReset({
        email: values.email,
        redirectTo: "/reset-password",
      })
      // Surface ONLY real send/infrastructure failures (5xx). Anything
      // else — success, or a non-existent email (Better Auth returns
      // success for enumeration safety) — lands on the standard
      // confirmation so we never reveal whether the account exists.
      if (result.error && result.error.status >= 500) {
        setError(GENERIC_ERROR)
        return
      }
      setSubmitted(true)
    } catch {
      // Network error / client threw. Never leave the button stuck on
      // "Sending…"; show a retryable error.
      setError(GENERIC_ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <Alert>
        <AlertDescription>{RESET_CONFIRMATION}</AlertDescription>
      </Alert>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  )
}
