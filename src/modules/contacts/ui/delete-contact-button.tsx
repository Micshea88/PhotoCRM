"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { deleteContact } from "../actions"

export function DeleteContactButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onDelete() {
    if (!confirm("Delete this contact? You can restore it from Trash within 90 days.")) {
      return
    }
    setBusy(true)
    const result = await deleteContact({ id })
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
      variant="destructive"
      size="sm"
      disabled={busy}
      onClick={() => {
        void onDelete()
      }}
    >
      {busy ? "Deleting…" : "Delete"}
    </Button>
  )
}
