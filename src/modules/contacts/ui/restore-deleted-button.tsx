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
 *
 * Push 4 (B2) — when the contact was a merge LOSER (the
 * mergedIntoWinnerId prop is set, indicating some active contact's
 * mergedRecordIds jsonb contains this id), a single-click confirm
 * dialog warns the user: the restore creates a SEPARATE record;
 * the merge into the winner is preserved. Spec language.
 */
export function RestoreDeletedButton({
  id,
  mergedIntoWinnerId,
}: {
  id: string
  /** Push 4 (B2) — non-null when this deleted record was a merge
   * loser. The id is the surviving winner contact whose
   * mergedRecordIds includes this id. */
  mergedIntoWinnerId?: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onRestore() {
    if (mergedIntoWinnerId) {
      const ok = window.confirm(
        "This contact was merged into another record. Restoring will create a separate record; the merge of data into the other record will be preserved. Continue?",
      )
      if (!ok) return
    }
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
