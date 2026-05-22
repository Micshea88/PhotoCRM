"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { archiveContact } from "../actions"

/**
 * Archive a contact. NO typed-confirmation modal — archive is
 * easily reversible (Restore from /contacts/archived) so we don't
 * add friction. After success, redirect to /contacts (the archived
 * contact is no longer in the main list).
 */
export function ArchiveContactButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onArchive() {
    setBusy(true)
    const result = await archiveContact({ id })
    setBusy(false)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    router.push("/contacts")
    router.refresh()
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => {
        void onArchive()
      }}
    >
      {busy ? "Archiving…" : "Archive"}
    </Button>
  )
}
