"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
  role: z.enum(["admin", "member"]),
})

type Values = z.infer<typeof schema>

export function InviteMemberForm() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { role: "member" },
  })

  async function onSubmit(values: Values) {
    setSubmitting(true)
    setError(null)
    setSuccess(false)
    const result = await authClient.organization.inviteMember({
      email: values.email,
      role: values.role,
    })
    setSubmitting(false)
    if (result.error) {
      setError(result.error.message ?? "Could not send invitation")
      return
    }
    setSuccess(true)
    reset({ role: values.role })
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register("email")} />
          {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            className="h-9 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
            {...register("role")}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>Invitation sent.</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  )
}
