"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { deleteItem } from "../actions"

export function DeleteItemButton({ id, redirectTo }: { id: string; redirectTo?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onDelete() {
    setBusy(true)
    const result = await deleteItem({ id })
    setBusy(false)
    if (result.serverError) {
       
      alert(result.serverError)
      return
    }
    if (redirectTo) {
      router.push(redirectTo)
    }
    router.refresh()
  }

  return (
    <Button
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
