"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { unarchiveContact } from "../actions"

/**
 * Restore an archived contact. Mirror of ArchiveContactButton —
 * easily reversible, no typed-confirm modal. After success, refresh
 * the /contacts/archived list so the restored row disappears.
 */
export function RestoreArchivedButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onRestore() {
    setBusy(true)
    const result = await unarchiveContact({ id })
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
