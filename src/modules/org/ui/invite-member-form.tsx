"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { inviteMemberWithExtendedRole } from "@/modules/rbac/actions"
import {
  INVITABLE_EXTENDED_ROLES,
  invitableExtendedRoleSchema,
  type InvitableExtendedRole,
} from "@/modules/rbac/types"

/**
 * Push 2c.6.4 — invite form exposes the 4 invitable internal roles
 * (Admin / Manager / User / Accountant). Owner is excluded (org
 * creators are auto-promoted; no invite path). Client is excluded
 * (Push 2c.5.1 + V1_ROADMAP V2: clients are external users invited
 * via a future client-portal flow keyed on the contact record).
 *
 * The action handles persistence: it sends a Better Auth invitation
 * with the BA-mapped role (extendedToBetterAuth) AND inserts a row
 * in `invitation_extended_role` so the inviter's actual pick survives
 * the round-trip. `seedNewMember` reads that row on accept.
 *
 * Default role: "user" (the standard team-member tier). LOC1: the
 * USER-FACING label is "Team" / "Team member" because "User" collides
 * with the noun, but the internal role id stays "user".
 */

const schema = z.object({
  email: z.email("Enter a valid email"),
  extendedRole: invitableExtendedRoleSchema,
})

type Values = z.infer<typeof schema>

const ROLE_LABELS: Record<InvitableExtendedRole, string> = {
  admin: "Admin",
  manager: "Manager",
  user: "Team member",
  accountant: "Accountant",
}

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
    defaultValues: { extendedRole: "user" },
  })

  async function onSubmit(values: Values) {
    setSubmitting(true)
    setError(null)
    setSuccess(false)
    const result = await inviteMemberWithExtendedRole({
      email: values.email,
      extendedRole: values.extendedRole,
    })
    setSubmitting(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    if (result.validationErrors) {
      setError("Please check the form values and try again.")
      return
    }
    setSuccess(true)
    reset({ extendedRole: values.extendedRole })
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="space-y-3">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register("email")} />
          {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
        </div>
        <div className="space-y-3">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            className="h-9 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
            {...register("extendedRole")}
          >
            {INVITABLE_EXTENDED_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
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
