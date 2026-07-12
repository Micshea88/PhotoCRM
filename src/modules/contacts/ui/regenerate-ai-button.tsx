"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { regenerateContactAi } from "@/modules/contacts/ai/regenerate"

/**
 * Push 3 (C6c) — manual "Regenerate" button for the AI summary card.
 *
 * Calls regenerateContactAi (orgAction). The action handles its own
 * fallback chain (Haiku → rules → empty floor); this button just
 * fires it and refreshes the route on success so the new cache values
 * flow through to the page.
 *
 * V1 only wires manual regen. Auto-regen-on-first-view is a future
 * commit — Mike wants to play with manual control first per testing-
 * mode discipline.
 */
export function RegenerateAiButton({ contactId }: { contactId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await regenerateContactAi({ contactId })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          void onClick()
        }}
        disabled={busy || pending}
        data-testid="regenerate-ai-button"
      >
        <RefreshCw
          className={`mr-1 size-3 ${busy || pending ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        {busy || pending ? "Regenerating…" : "Regenerate"}
      </Button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  )
}
