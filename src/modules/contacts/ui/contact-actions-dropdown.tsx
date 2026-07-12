"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import { Modal } from "@/components/ui/modal"
import { Popover } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { archiveContact, deleteContact } from "../actions"
import { MergeWithPicker } from "./merge-with-picker"

/**
 * Push 3 (C6c polish #2) — locked Actions dropdown.
 *
 * Replaces the C6c standalone [Edit / Archive / Delete] button trio
 * with one [Actions ▼] dropdown. The 8-item order is locked in
 * docs/pathway-design-system.md → "Actions dropdown".
 *
 *   1. Edit full contact record → /contacts/[id]/edit (kept for users
 *      who prefer the form over inline editing)
 *   2. View all properties → placeholder modal
 *   3. Merge → contact-picker → existing merge engine (C7 redesigns
 *      the merge UI itself; this entry point is permanent)
 *   4. Clone → placeholder modal
 *   5. --- divider ---
 *   6. Archive (skipped when already archived)
 *   7. Delete (destructive styling, confirm modal)
 *   8. Export contact data → placeholder modal
 *
 * Placeholder modals follow the design-system "Everything intentional"
 * principle — short title + ship-target body, never a barren box.
 */
const PLACEHOLDERS = {
  viewAllProperties: {
    title: "View all properties",
    body: "Full property view with add-to-card affordances ships in an upcoming push. Until then, edit the full form via 'Edit full contact record' above.",
  },
  clone: {
    title: "Clone contact",
    body: "Cloning a contact (carry over fields + start a fresh record) ships in an upcoming push.",
  },
  export: {
    title: "Export contact data",
    body: "Single-contact export (PDF / CSV / vCard) ships in an upcoming push. Use the contacts list bulk-export when it arrives.",
  },
} as const

export function ContactActionsDropdown({
  contactId,
  archived,
  mergeOptions = [],
}: {
  contactId: string
  archived: boolean
  /** P3 C7 — every other contact in the org, except this one. Powers
   *  the "Merge with…" picker. Empty array → no other contacts, so
   *  Merge stays selectable but the picker shows an empty list. */
  mergeOptions?: { id: string; label: string; description?: string | null }[]
}) {
  const router = useRouter()
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [placeholder, setPlaceholder] = useState<keyof typeof PLACEHOLDERS | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)

  async function onArchive() {
    setArchiveBusy(true)
    const result = await archiveContact({ id: contactId })
    setArchiveBusy(false)
    if (result.serverError) {
      window.alert(result.serverError)
      return
    }
    router.push("/contacts")
    router.refresh()
  }

  async function onDelete() {
    setDeleteBusy(true)
    setDeleteError(null)
    const result = await deleteContact({ id: contactId })
    setDeleteBusy(false)
    if (result.serverError) {
      setDeleteError(result.serverError)
      return
    }
    setDeleteOpen(false)
    router.push("/contacts")
    router.refresh()
  }

  return (
    <>
      <Popover
        align="start"
        trigger={({ open, toggle }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggle}
            aria-expanded={open}
            data-testid="contact-actions-trigger"
          >
            Actions
            <ChevronDown className="ml-1 size-3" aria-hidden="true" />
          </Button>
        )}
      >
        <ul className="min-w-[240px] space-y-0.5 text-sm" role="menu">
          <Item href={`/contacts/${contactId}/edit`}>Edit full contact record</Item>
          <Item
            onClick={() => {
              setPlaceholder("viewAllProperties")
            }}
          >
            View all properties
          </Item>
          <Item
            onClick={() => {
              setMergeOpen(true)
            }}
            data-testid="actions-merge-with"
          >
            Merge with…
          </Item>
          <Item
            onClick={() => {
              setPlaceholder("clone")
            }}
          >
            Clone
          </Item>
          <li className="my-1 border-t border-[var(--color-border)]" aria-hidden="true" />
          {!archived && (
            <Item
              onClick={() => {
                void onArchive()
              }}
              disabled={archiveBusy}
            >
              {archiveBusy ? "Archiving…" : "Archive"}
            </Item>
          )}
          <Item
            onClick={() => {
              setDeleteOpen(true)
            }}
            destructive
          >
            Delete
          </Item>
          <Item
            onClick={() => {
              setPlaceholder("export")
            }}
          >
            Export contact data
          </Item>
        </ul>
      </Popover>

      <DeleteConfirmModal
        open={deleteOpen}
        onClose={() => {
          if (!deleteBusy) setDeleteOpen(false)
        }}
        onConfirm={() => {
          void onDelete()
        }}
        body="This contact will be moved to Deleted and automatically purged after 90 days. You can restore it before then on the Deleted page."
        submitting={deleteBusy}
      />
      {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}

      {placeholder && (
        <Modal
          open={true}
          onClose={() => {
            setPlaceholder(null)
          }}
          title={PLACEHOLDERS[placeholder].title}
        >
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {PLACEHOLDERS[placeholder].body}
          </p>
        </Modal>
      )}

      <MergeWithPicker
        open={mergeOpen}
        onClose={() => {
          setMergeOpen(false)
        }}
        thisContactId={contactId}
        options={mergeOptions}
      />
    </>
  )
}

function Item({
  children,
  href,
  onClick,
  disabled,
  destructive,
  "data-testid": testId,
}: {
  children: React.ReactNode
  href?: string
  onClick?: () => void
  disabled?: boolean
  destructive?: boolean
  "data-testid"?: string
}) {
  const cls = cn(
    "block w-full rounded px-2 py-1.5 text-left",
    destructive ? "text-red-700 hover:bg-red-500/10" : "hover:bg-[var(--color-accent)]/40",
    disabled && "cursor-not-allowed opacity-50",
  )
  if (href && !disabled) {
    return (
      <li>
        <Link href={href} role="menuitem" className={cls}>
          {children}
        </Link>
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        disabled={disabled}
        className={cls}
        data-testid={testId}
      >
        {children}
      </button>
    </li>
  )
}
