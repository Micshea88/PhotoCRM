"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"

const profileSchema = z.object({
  name: z.string().min(1).max(100),
})

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12, "Password must be at least 12 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

type ProfileValues = z.infer<typeof profileSchema>
type PasswordValues = z.infer<typeof passwordSchema>

export function AccountSettingsForm({
  defaultName,
  defaultEmail,
}: {
  defaultName: string
  defaultEmail: string
}) {
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState<string | null>(null)
  const [profileErr, setProfileErr] = useState<string | null>(null)
  const profile = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: defaultName },
  })

  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [pwErr, setPwErr] = useState<string | null>(null)
  const pw = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) })

  async function onProfileSubmit(values: ProfileValues) {
    setProfileSaving(true)
    setProfileErr(null)
    setProfileMsg(null)
    const result = await authClient.updateUser({ name: values.name })
    setProfileSaving(false)
    if (result.error) {
      setProfileErr(result.error.message ?? "Update failed")
      return
    }
    setProfileMsg("Saved.")
  }

  async function onPasswordSubmit(values: PasswordValues) {
    setPwSaving(true)
    setPwErr(null)
    setPwMsg(null)
    const result = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    })
    setPwSaving(false)
    if (result.error) {
      setPwErr(result.error.message ?? "Change failed")
      return
    }
    setPwMsg("Password updated. Other sessions signed out.")
    pw.reset()
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Profile</h2>
        <form onSubmit={profile.handleSubmit(onProfileSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={defaultEmail} disabled />
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Contact support to change your email.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...profile.register("name")} />
            {profile.formState.errors.name && (
              <p className="text-xs text-red-600">{profile.formState.errors.name.message}</p>
            )}
          </div>
          {profileErr && (
            <Alert variant="destructive">
              <AlertDescription>{profileErr}</AlertDescription>
            </Alert>
          )}
          {profileMsg && (
            <Alert>
              <AlertDescription>{profileMsg}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={profileSaving}>
            {profileSaving ? "Saving…" : "Save"}
          </Button>
        </form>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Password</h2>
        <form onSubmit={pw.handleSubmit(onPasswordSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <PasswordInput
              id="currentPassword"
              autoComplete="current-password"
              {...pw.register("currentPassword")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              {...pw.register("newPassword")}
            />
            {pw.formState.errors.newPassword && (
              <p className="text-xs text-red-600">{pw.formState.errors.newPassword.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              {...pw.register("confirmPassword")}
            />
            {pw.formState.errors.confirmPassword && (
              <p className="text-xs text-red-600">{pw.formState.errors.confirmPassword.message}</p>
            )}
          </div>
          {pwErr && (
            <Alert variant="destructive">
              <AlertDescription>{pwErr}</AlertDescription>
            </Alert>
          )}
          {pwMsg && (
            <Alert>
              <AlertDescription>{pwMsg}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pwSaving}>
            {pwSaving ? "Updating…" : "Update password"}
          </Button>
        </form>
      </section>
    </div>
  )
}
