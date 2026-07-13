"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import { deleteContact } from "../actions"

const BODY =
  "This contact will be moved to Deleted and automatically purged after 90 days. You can restore it before then on the Deleted page."

export function DeleteContactButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onDelete() {
    setBusy(true)
    setError(null)
    const result = await deleteContact({ id })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    setOpen(false)
    router.push("/contacts")
    router.refresh()
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => {
          setOpen(true)
        }}
      >
        Delete
      </Button>
      <DeleteConfirmModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false)
        }}
        onConfirm={() => {
          void onDelete()
        }}
        body={BODY}
        submitting={busy}
      />
      {error && <div className="text-xs text-[var(--color-destructive)]">{error}</div>}
    </>
  )
}
