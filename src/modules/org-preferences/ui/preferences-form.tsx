"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { SHARE_LINK_EXPIRATION_OPTIONS } from "@/modules/files/share-link-core"
import { setDefaultShareExpiration } from "@/modules/org-preferences/actions"

/**
 * Org Preferences form (Commit 3, Phase E). V1 surfaces a single control: the
 * default file share-link expiration used when the email composer creates a
 * "send as link" attachment. "Custom date…" is omitted — a recurring default
 * can't be a fixed calendar date.
 */
export function PreferencesForm({ defaultExpiration }: { defaultExpiration: string }) {
  const [expiration, setExpiration] = useState(defaultExpiration)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSave() {
    setMsg(null)
    setErr(null)
    startTransition(async () => {
      const res = await setDefaultShareExpiration({ expiration })
      if (res.serverError) setErr(res.serverError)
      else if (res.validationErrors) setErr("Invalid selection.")
      else setMsg("Saved.")
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="default-share-expiration">Default share-link expiration</Label>
        <select
          id="default-share-expiration"
          value={expiration}
          onChange={(e) => {
            setExpiration(e.target.value)
          }}
          className="block w-full rounded-md border px-3 py-2 text-sm"
        >
          {SHARE_LINK_EXPIRATION_OPTIONS.filter((o) => o !== "Custom date…").map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          New password-protected and large-file share links use this expiration by default. You can
          still change it per email when composing.
        </p>
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
      <Button type="button" onClick={onSave} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  )
}
