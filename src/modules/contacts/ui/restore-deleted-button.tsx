"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import { restoreContact } from "../actions"

/**
 * Push 2c.5 — restore a soft-deleted contact. Soft-deleted contacts
 * auto-purge after 90 days; this button is the user-facing "undo"
 * before that window closes. After success, refreshes the
 * /contacts/deleted list so the restored row disappears.
 *
 * Push 4 (B2) — when the contact was a merge LOSER (the
 * mergedIntoWinnerId prop is set, indicating some active contact's
 * mergedRecordIds jsonb contains this id), a confirm modal warns
 * the user: the restore creates a SEPARATE record; the merge into
 * the winner is preserved.
 *
 * Backlog Item 1b — replaced the bare `window.confirm` with the
 * shared `ConfirmModal` so the restore confirm matches the rest of
 * the app's modal pattern (one primitive, both this and the
 * activity-feed entry-delete consume it).
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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doRestore() {
    setBusy(true)
    setError(null)
    const result = await restoreContact({ id })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    setConfirmOpen(false)
    router.refresh()
  }

  function onClick() {
    if (mergedIntoWinnerId) {
      setConfirmOpen(true)
      return
    }
    void doRestore()
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onClick}
        data-testid="restore-deleted-button"
      >
        {busy ? "Restoring…" : "Restore"}
      </Button>
      <ConfirmModal
        open={confirmOpen}
        onClose={() => {
          if (!busy) setConfirmOpen(false)
        }}
        onConfirm={() => {
          void doRestore()
        }}
        title="Restore merged contact?"
        body="This contact was merged into another record. Restoring will create a separate record; the merge of data into the other record will be preserved. Continue?"
        confirmLabel="Restore"
        submitting={busy}
      />
      {error && (
        <p className="text-xs text-red-600" data-testid="restore-error">
          {error}
        </p>
      )}
    </>
  )
}
