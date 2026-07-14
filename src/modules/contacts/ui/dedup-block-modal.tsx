"use client"

import Link from "next/link"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { dedupFieldLabel, type DedupMatchField } from "../dedup-types"

/**
 * Push 3 (C4) — duplicate block modal.
 *
 * Shown when createContact / updateContact returns a `dedupConflict`
 * result. Per memory #22 there is NO override path — the user can
 * either navigate to the existing contact (to update it instead) or
 * cancel and edit the form.
 *
 * The matched contact's display name + email/phone hint comes from
 * the host (which has the contact list in scope from the form props).
 * Keeps this component pure: no data fetch, no server action call.
 */
export function DedupBlockModal({
  open,
  onClose,
  matchedContactId,
  matchedContactLabel,
  matchedContactSubtext,
  matchedField,
  currentContactId,
}: {
  open: boolean
  onClose: () => void
  matchedContactId: string
  /** Display label for the existing contact ("First Last" or email). */
  matchedContactLabel: string
  /** Optional secondary line — typically the matched email/phone for context. */
  matchedContactSubtext?: string
  matchedField: DedupMatchField
  /** P3 (C7) — when the dedup-block fires from an UPDATE on an
   *  existing contact, the form passes this contact's id. Surfaces
   *  the "Merge with existing" link that routes to the C7 merge
   *  surface (`/contacts/<currentId>/merge?with=<matchedId>`). When
   *  null (CREATE flow), the link is hidden — there's no contact
   *  yet to merge with the matched one. */
  currentContactId?: string | null
}) {
  return (
    <Modal open={open} onClose={onClose} title="Duplicate contact detected">
      <div className="space-y-4">
        <div className="flex gap-3 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-sm">
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="font-medium text-[var(--color-warning)]">
              An existing contact already has this {dedupFieldLabel(matchedField)}.
            </p>
            <p className="text-xs text-[var(--color-warning)]">
              To avoid creating duplicate records, edit the existing contact instead of creating a
              new one. If this is genuinely a different person, change the duplicate field and try
              again.
            </p>
          </div>
        </div>

        <div className="rounded-md border border-[var(--color-border)] p-3 text-sm">
          <p className="font-medium">{matchedContactLabel}</p>
          {matchedContactSubtext && (
            <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
              {matchedContactSubtext}
            </p>
          )}
        </div>

        <div className="flex flex-row-reverse gap-2">
          <Button asChild>
            <Link href={`/contacts/${matchedContactId}`} data-testid="dedup-modal-go-existing">
              Go to existing contact
            </Link>
          </Button>
          {currentContactId && (
            <Button asChild variant="outline">
              <Link
                href={`/contacts/${currentContactId}/merge?with=${matchedContactId}`}
                data-testid="dedup-modal-merge-with-existing"
              >
                Merge with existing
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={onClose} data-testid="dedup-modal-cancel">
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
