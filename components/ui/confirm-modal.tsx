"use client"

import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"

/**
 * Lightweight yes/no confirm modal — the in-app replacement for
 * `window.confirm`. Shared primitive: both the activity-feed
 * entry-delete and the RestoreDeletedButton trash-restore consume
 * the same component so the UX is consistent.
 *
 * For type-to-confirm destructive actions (soft-delete, permanent
 * delete) use `DeleteConfirmModal` — that primitive enforces typing
 * a confirm phrase. This one is for the "are you sure?" cases where
 * type-to-confirm is overkill.
 *
 * Props:
 *   open / onClose       — controlled visibility (host owns).
 *   onConfirm            — host fires its action.
 *   title / body         — copy.
 *   confirmLabel         — defaults "Confirm".
 *   destructive          — applies the destructive button variant.
 *   submitting           — disables the confirm button while busy.
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  destructive = false,
  submitting = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  body: string
  confirmLabel?: string
  destructive?: boolean
  submitting?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">{body}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={submitting}
            data-testid="confirm-modal-confirm"
          >
            {submitting ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
