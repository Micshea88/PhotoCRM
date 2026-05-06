"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function DangerZone({ orgId, orgName }: { orgId: string; orgName: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onDelete() {
    if (confirm !== orgName) {
      setError(`Type "${orgName}" exactly to confirm deletion.`)
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await authClient.organization.delete({ organizationId: orgId })
    setSubmitting(false)
    if (result.error) {
      setError(result.error.message ?? "Could not delete organization")
      return
    }
    router.push("/onboarding/create-organization")
    router.refresh()
  }

  return (
    <div className="space-y-4 rounded-lg border border-[var(--color-destructive)] p-4">
      <div>
        <p className="text-sm font-medium">Delete this organization</p>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          This is permanent. All organization data is removed.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">
          Type <span className="font-mono">{orgName}</span> to confirm
        </Label>
        <Input
          id="confirm"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
          }}
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        variant="destructive"
        disabled={submitting || confirm !== orgName}
        onClick={() => {
          void onDelete()
        }}
      >
        {submitting ? "Deleting…" : "Delete organization"}
      </Button>
    </div>
  )
}
