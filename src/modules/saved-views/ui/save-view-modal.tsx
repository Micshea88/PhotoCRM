"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"

/**
 * Two-purpose modal: "Save current view as new view" + "Rename existing
 * view." Same shape (single name input), different submit semantics —
 * the host decides which action to call. Defaults the input value to
 * the prior name when used for Rename, blank for Save-as.
 *
 * The component early-returns null when `open` is false. That means a
 * fresh `useState(defaultName)` initializer runs every time the modal
 * is opened, which keeps the value in sync with `defaultName` without
 * needing a useEffect-driven reset.
 */
export function SaveViewModal(props: {
  open: boolean
  onClose: () => void
  onSubmit: (name: string) => void
  title: string
  defaultName?: string
  submitting?: boolean
  cta?: string
}) {
  if (!props.open) return null
  return <SaveViewModalBody {...props} />
}

function SaveViewModalBody({
  open,
  onClose,
  onSubmit,
  title,
  defaultName = "",
  submitting = false,
  cta = "Save view",
}: {
  open: boolean
  onClose: () => void
  onSubmit: (name: string) => void
  title: string
  defaultName?: string
  submitting?: boolean
  cta?: string
}) {
  const [name, setName] = useState(defaultName)
  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= 120 && !submitting

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!canSubmit) return
          onSubmit(trimmed)
        }}
      >
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="save-view-name">
            View name
          </label>
          <Input
            id="save-view-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
            }}
            placeholder="e.g. Vendor Matrix, This Quarter's Leads"
            autoFocus
            maxLength={120}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            120 characters max. Must be unique among your saved views for this list.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? "Saving…" : cta}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
