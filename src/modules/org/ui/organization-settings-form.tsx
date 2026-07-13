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
  name: z.string().min(2).max(80),
})

type Values = z.infer<typeof schema>

export function OrganizationSettingsForm({
  orgId,
  defaultName,
}: {
  orgId: string
  defaultName: string
}) {
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: defaultName },
  })

  async function onSubmit(values: Values) {
    setSaving(true)
    setErr(null)
    setMsg(null)
    const result = await authClient.organization.update({
      organizationId: orgId,
      data: { name: values.name },
    })
    setSaving(false)
    if (result.error) {
      setErr(result.error.message ?? "Update failed")
      return
    }
    setMsg("Saved.")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} />
        {errors.name && (
          <p className="text-xs text-[var(--color-destructive)]">{errors.name.message}</p>
        )}
      </div>
      {err && (
        <Alert variant="destructive">
          <AlertDescription>{err}</AlertDescription>
        </Alert>
      )}
      {msg && (
        <Alert>
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </form>
  )
}
