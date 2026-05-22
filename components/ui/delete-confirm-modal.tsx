"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"

/**
 * Reusable type-to-confirm destructive-action modal. The CRM-wide
 * standard per the V1 Roadmap "Delete Confirmation Modal" row.
 *
 * Used everywhere a destructive action lives:
 *   - Contacts soft-delete (current consumer)
 *   - Future per-module Delete + Permanently-delete buttons
 *   - Trash → Permanently delete from /<entity>/deleted
 *
 * Props:
 *   open       — controlled visibility
 *   onClose    — close callback (Cancel button or Escape/backdrop)
 *   onConfirm  — called when user types the confirm phrase and clicks
 *                Delete. Receives no args — caller handles the actual
 *                action invocation (the modal is presentation-only).
 *   title      — defaults to "Are you sure you want to delete?"
 *   body       — per-context plain text describing what will happen.
 *                Contacts use "...moved to Deleted and automatically
 *                purged after 90 days." Permanent-delete actions
 *                should warn that the action is irreversible.
 *   confirmText — phrase the user must type (case-insensitive).
 *                 Defaults to "delete". Override for higher-stakes
 *                 actions (e.g., "delete forever" for hard delete).
 *   submitting — disables the Delete button while the action runs
 *                in the parent component. The modal does not own
 *                the loading state.
 */
export function DeleteConfirmModal({
  open,
  onClose,
  onConfirm,
  title = "Are you sure you want to delete?",
  body,
  confirmText = "delete",
  submitting = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  body: string
  confirmText?: string
  submitting?: boolean
}) {
  const [value, setValue] = useState("")

  function handleClose() {
    setValue("")
    onClose()
  }

  const matches = value.trim().toLowerCase() === confirmText.toLowerCase()
  const canSubmit = matches && !submitting

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">{body}</p>
        <div className="space-y-1">
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
            }}
            placeholder={confirmText.toUpperCase()}
            autoFocus
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Type {confirmText.toUpperCase()} to confirm
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={!canSubmit} onClick={onConfirm}>
            {submitting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
