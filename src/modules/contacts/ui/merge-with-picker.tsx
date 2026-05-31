"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { SearchableSelect } from "@/components/ui/searchable-select"

/**
 * Push 3 (C7) — manual "Merge with…" picker.
 *
 * Opens from the contact detail Actions dropdown. The user picks
 * another contact to merge INTO this one (HubSpot pattern: the
 * current contact is one side, the picker chooses the other). On
 * confirm, the route advances to /contacts/<id>/merge?with=<other>
 * where the full side-by-side rebuild lives.
 *
 * Persistence stays in the existing `mergeContacts` engine call from
 * Push 4 B2 — the C7 deliverables are the picker + the side-by-side
 * surface, not a new merge action.
 */
export function MergeWithPicker({
  open,
  onClose,
  thisContactId,
  options,
}: {
  open: boolean
  onClose: () => void
  thisContactId: string
  /** Every other contact in the org, except this one. The merge-page
   *  loader will reject the pick if the contact has been deleted in
   *  the meantime. */
  options: { id: string; label: string; description?: string | null }[]
}) {
  const router = useRouter()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reset() {
    setPickedId(null)
  }

  function handleClose() {
    if (busy) return
    reset()
    onClose()
  }

  function handleContinue() {
    if (!pickedId || busy) return
    setBusy(true)
    // Navigate to the merge route. setBusy stays true through the
    // navigation transition so the button doesn't fire twice.
    router.push(`/contacts/${thisContactId}/merge?with=${pickedId}`)
  }

  return (
    <Modal open={open} onClose={handleClose} title="Merge with…" className="max-w-md">
      <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">
        Pick the contact you want to merge into this one. The next screen shows both records side by
        side so you can choose which value wins for each field.
      </p>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-[var(--color-muted-foreground)]">
          Other contact
        </label>
        <SearchableSelect
          items={options.map((o) => ({
            value: o.id,
            label: o.label,
            description: o.description ?? undefined,
          }))}
          value={pickedId}
          onChange={(v) => {
            setPickedId(v)
          }}
          aria-label="Pick another contact"
          placeholder="Search contacts…"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleContinue}
          disabled={!pickedId || busy}
          data-testid="merge-with-continue"
        >
          {busy ? "Loading…" : "Continue"}
        </Button>
      </div>
    </Modal>
  )
}
