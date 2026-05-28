"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { createContactNote } from "@/modules/contacts/actions"

/**
 * Push 3 (C6c) — Add Note modal.
 *
 * Plain textarea per autonomous default C — no markdown rendering in
 * V1. Submit calls the existing createContactNote action (shipped
 * earlier). On success, closes + refreshes the route so the new note
 * appears in the activity feed.
 *
 * Body cap: 10,000 chars (matches the createContactNoteInput Zod
 * schema). The form surfaces the count once the user gets close.
 */
const MAX_BODY = 10_000
const WARN_THRESHOLD = MAX_BODY - 500

export function AddNoteModal({
  open,
  onClose,
  contactId,
}: {
  open: boolean
  onClose: () => void
  contactId: string
}) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function submit() {
    if (busy) return
    const trimmed = body.trim()
    if (!trimmed) {
      setError("Note can't be empty.")
      return
    }
    if (trimmed.length > MAX_BODY) {
      setError(`Note is too long (max ${String(MAX_BODY)} chars).`)
      return
    }
    setBusy(true)
    setError(null)
    const result = await createContactNote({ contactId, body: trimmed })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    setBody("")
    onClose()
    startTransition(() => {
      router.refresh()
    })
  }

  function handleClose() {
    if (busy) return
    setBody("")
    setError(null)
    onClose()
  }

  const remaining = MAX_BODY - body.length

  return (
    <Modal open={open} onClose={handleClose} title="Add note">
      <div className="space-y-3">
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
          }}
          placeholder="Type a note. Plain text; markdown formatting comes in a later push."
          rows={8}
          maxLength={MAX_BODY}
          disabled={busy}
          aria-label="Note body"
          data-testid="add-note-body"
          className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between text-[11px]">
          <span
            className={
              body.length >= WARN_THRESHOLD
                ? "text-amber-600 dark:text-amber-400"
                : "text-[var(--color-muted-foreground)]"
            }
          >
            {String(remaining)} characters left
          </span>
          {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
        </div>
        <div className="flex flex-row-reverse gap-2">
          <Button
            type="button"
            onClick={() => {
              void submit()
            }}
            disabled={busy || body.trim().length === 0}
            data-testid="add-note-submit"
          >
            {busy ? "Saving…" : "Add note"}
          </Button>
          <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
