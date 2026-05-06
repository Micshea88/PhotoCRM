"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

export function PendingInvitations({
  invitations,
}: {
  invitations: { id: string; email: string; role: string }[]
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function cancel(id: string) {
    setBusyId(id)
    await authClient.organization.cancelInvitation({ invitationId: id })
    setBusyId(null)
    router.refresh()
  }

  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {invitations.map((inv) => (
        <li key={inv.id} className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium">{inv.email}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">{inv.role}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busyId === inv.id}
            onClick={() => void cancel(inv.id)}
          >
            {busyId === inv.id ? "Cancelling…" : "Cancel"}
          </Button>
        </li>
      ))}
    </ul>
  )
}
