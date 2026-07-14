"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Bold, Italic, Paperclip, Sparkles, Strikethrough, Underline } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ActivityModalChrome,
  AssociationsSection,
  ContactPill,
  FollowUpTaskAffordance,
  type AssociationOption,
  type AssociationsDraft,
} from "@/components/ui/activity-modal-chrome"
import { createContactNote } from "@/modules/contacts/actions"

/**
 * Push 3 (C6c polish #4) — Note modal redesign (HubSpot pattern).
 *
 * Replaces the C6c modal-on-Modal-primitive shape. Uses the shared
 * ActivityModalChrome (collapse / title / grip / expand / close).
 *
 * Body sections, in order:
 *   1. For: [Contact pill]
 *   2. Body textarea — auto-grows
 *   3. Formatting toolbar (display-only V1 — buttons render but the
 *      contenteditable rich-text pipeline lands in a later polish
 *      push). Per the design-system "Everything intentional" rule we
 *      ship the toolbar visually complete so the surface doesn't
 *      look unfinished.
 *   4. AssociationsSection (read-only single-contact; multi-record
 *      lands in Push 3.5+).
 *   5. FollowUpTaskAffordance (disabled stub; Tasks module is P7).
 *   6. Create button.
 */
const MAX_BODY = 10_000

export function AddNoteModal({
  open,
  onClose,
  contactId,
  contactLabel,
  contactOptions = [],
  companyOptions = [],
}: {
  open: boolean
  onClose: () => void
  contactId: string
  /** Display name for the For pill. Falls back to "this contact"
   *  when the host doesn't have a name handy. */
  contactLabel?: string
  /** Options for the AssociationsPicker — V1 only the primary
   *  contact persists, but the multi-record UI ships now. */
  contactOptions?: AssociationOption[]
  companyOptions?: AssociationOption[]
}) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [associations, setAssociations] = useState<AssociationsDraft>({
    contactIds: [contactId],
    companyIds: [],
    eventIds: [],
  })
  const [, startTransition] = useTransition()
  const label = contactLabel ?? "this contact"

  function handleClose() {
    if (busy) return
    setBody("")
    setError(null)
    onClose()
  }

  async function submit() {
    if (busy) return
    const trimmed = body.trim()
    if (!trimmed) {
      setError("Note can't be empty.")
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

  return (
    <ActivityModalChrome
      open={open}
      onClose={handleClose}
      title="Note"
      onBeforeClose={() => {
        // Unsaved-changes confirm. If body is empty there's nothing
        // to lose; otherwise prompt.
        if (body.trim().length === 0) return true
        return window.confirm("Discard this note?")
      }}
      footer={
        <div className="text-2xs flex items-center justify-between gap-2">
          {error ? (
            <span className="text-[var(--color-destructive)]">{error}</span>
          ) : (
            <span className="text-[var(--color-muted-foreground)]">
              {String(MAX_BODY - body.length)} characters left
            </span>
          )}
          <Button
            type="button"
            onClick={() => {
              void submit()
            }}
            disabled={busy || body.trim().length === 0}
            data-testid="add-note-submit"
          >
            {busy ? "Saving…" : "Create"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          For: <ContactPill contactId={contactId} label={label} />
        </p>

        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            if (error) setError(null)
          }}
          placeholder="Start typing to leave a note…"
          rows={6}
          maxLength={MAX_BODY}
          disabled={busy}
          aria-label="Note body"
          data-testid="add-note-body"
          className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none disabled:opacity-50"
        />

        {/* Formatting toolbar — display-only V1 (rich-text pipeline
            lands in a later polish push). Per the "Everything
            intentional" rule (design-system §2) the surface ships
            visually complete so it doesn't feel half-built. */}
        <div
          className="flex items-center gap-1 border-t border-[var(--color-border)] pt-2 text-[var(--color-muted-foreground)]"
          aria-label="Formatting toolbar"
        >
          <ToolbarIcon icon={<Bold className="size-3.5" aria-hidden="true" />} label="Bold" />
          <ToolbarIcon icon={<Italic className="size-3.5" aria-hidden="true" />} label="Italic" />
          <ToolbarIcon
            icon={<Underline className="size-3.5" aria-hidden="true" />}
            label="Underline"
          />
          <ToolbarIcon
            icon={<Strikethrough className="size-3.5" aria-hidden="true" />}
            label="Strikethrough"
          />
          <span className="mx-1 h-4 border-l border-[var(--color-border)]" />
          <ToolbarIcon
            icon={<Paperclip className="size-3.5" aria-hidden="true" />}
            label="Attach file"
          />
          <ToolbarIcon
            icon={<Sparkles className="size-3.5" aria-hidden="true" />}
            label="AI assistance"
          />
        </div>

        <AssociationsSection
          contactId={contactId}
          contactLabel={label}
          draft={associations}
          onChange={setAssociations}
          contactOptions={contactOptions}
          companyOptions={companyOptions}
        />
        <FollowUpTaskAffordance />
      </div>
    </ActivityModalChrome>
  )
}

function ToolbarIcon({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      title={`${label} (ships in V1.5 rich-text polish)`}
      disabled
      aria-label={label}
      className="inline-flex size-7 cursor-not-allowed items-center justify-center rounded opacity-60"
    >
      {icon}
    </button>
  )
}
