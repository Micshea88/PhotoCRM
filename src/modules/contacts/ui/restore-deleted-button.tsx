"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { restoreContact } from "../actions"

/**
 * Push 2c.5 — restore a soft-deleted contact. Mirror of
 * RestoreArchivedButton. Soft-deleted contacts auto-purge after
 * 90 days; this button is the user-facing "undo" before that
 * window closes. After success, refreshes the /contacts/deleted
 * list so the restored row disappears.
 */
export function RestoreDeletedButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onRestore() {
    setBusy(true)
    const result = await restoreContact({ id })
    setBusy(false)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    router.refresh()
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => {
        void onRestore()
      }}
    >
      {busy ? "Restoring…" : "Restore"}
    </Button>
  )
}
