"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function AcceptInviteRunner({ invitationId }: { invitationId: string }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setSubmitting(true)
    setError(null)
    const result = await authClient.organization.acceptInvitation({ invitationId })
    if (result.error) {
      setSubmitting(false)
      setError(result.error.message ?? "Could not accept invitation")
      return
    }
    const orgId = result.data.invitation.organizationId
    await authClient.organization.setActive({ organizationId: orgId })
    setSubmitting(false)
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button onClick={() => void accept()} disabled={submitting} className="w-full">
        {submitting ? "Accepting…" : "Accept invitation"}
      </Button>
    </div>
  )
}
