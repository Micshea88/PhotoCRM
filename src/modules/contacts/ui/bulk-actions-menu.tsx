"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"
import {
  bulkAddTag,
  bulkChangeOwner,
  bulkChangeStatus,
  bulkDeleteContacts,
  bulkRemoveTag,
} from "../actions"
import { LIFECYCLE_STATUSES, type LifecycleStatus } from "../types"

/**
 * Push 2c — top-right table toolbar with two faces:
 *
 *   - 0 selected: { Edit columns, Import contacts }
 *   - 1+ selected: { Delete N, Change owner, Change status, Add tag, Remove tag }
 *
 * Each bulk action opens a small inline modal collecting the
 * action-specific argument(s), then dispatches the server action and
 * clears the selection via `onAfterAction`. Errors surface via the
 * shared alert() — same convention as the saved-views tab strip.
 */
export function BulkActionsMenu({
  selectedIds,
  ownerOptions,
  tagOptions,
  onOpenEditColumns,
  onAfterAction,
}: {
  selectedIds: string[]
  ownerOptions: { id: string; name: string | null; email: string }[]
  tagOptions: string[]
  onOpenEditColumns: () => void
  /** Called after a successful bulk action — host clears selection + refreshes. */
  onAfterAction: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [addTagOpen, setAddTagOpen] = useState(false)
  const [removeTagOpen, setRemoveTagOpen] = useState(false)

  const count = selectedIds.length
  const hasSelection = count > 0

  async function runAndFinish(fn: () => Promise<{ serverError?: string }>) {
    setBusy(true)
    const result = await fn()
    setBusy(false)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    onAfterAction()
    router.refresh()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Actions"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm hover:bg-[var(--color-accent)]"
          disabled={busy}
        >
          <span>{hasSelection ? `Actions (${String(count)})` : "Actions"}</span>
          <span aria-hidden="true">▾</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!hasSelection && (
            <>
              <DropdownMenuItem onSelect={onOpenEditColumns}>Edit columns</DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/contacts/import">Import contacts</Link>
              </DropdownMenuItem>
            </>
          )}
          {hasSelection && (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  setDeleteOpen(true)
                }}
              >
                Delete {String(count)}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setOwnerOpen(true)
                }}
              >
                Change owner
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setStatusOpen(true)
                }}
              >
                Change status
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setAddTagOpen(true)
                }}
              >
                Add tag
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setRemoveTagOpen(true)
                }}
              >
                Remove tag
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteConfirmModal
        open={deleteOpen}
        onClose={() => {
          if (!busy) setDeleteOpen(false)
        }}
        onConfirm={() => {
          void runAndFinish(async () => {
            const r = await bulkDeleteContacts({ ids: selectedIds })
            setDeleteOpen(false)
            return r
          })
        }}
        body={`${String(count)} contact${count === 1 ? " will be" : "s will be"} moved to Deleted and automatically purged after 90 days. You can restore them before then on the Deleted page.`}
        submitting={busy}
      />

      <ChangeOwnerModal
        open={ownerOpen}
        onClose={() => {
          if (!busy) setOwnerOpen(false)
        }}
        owners={ownerOptions}
        busy={busy}
        onSubmit={(ownerUserId) => {
          void runAndFinish(async () => {
            const r = await bulkChangeOwner({ ids: selectedIds, ownerUserId })
            setOwnerOpen(false)
            return r
          })
        }}
      />

      <ChangeStatusModal
        open={statusOpen}
        onClose={() => {
          if (!busy) setStatusOpen(false)
        }}
        busy={busy}
        onSubmit={(lifecycleStatus) => {
          void runAndFinish(async () => {
            const r = await bulkChangeStatus({ ids: selectedIds, lifecycleStatus })
            setStatusOpen(false)
            return r
          })
        }}
      />

      <TagModal
        open={addTagOpen}
        onClose={() => {
          if (!busy) setAddTagOpen(false)
        }}
        title="Add tag"
        cta="Add tag"
        tagOptions={tagOptions}
        busy={busy}
        onSubmit={(tag) => {
          void runAndFinish(async () => {
            const r = await bulkAddTag({ ids: selectedIds, tag })
            setAddTagOpen(false)
            return r
          })
        }}
      />

      <TagModal
        open={removeTagOpen}
        onClose={() => {
          if (!busy) setRemoveTagOpen(false)
        }}
        title="Remove tag"
        cta="Remove tag"
        tagOptions={tagOptions}
        busy={busy}
        onSubmit={(tag) => {
          void runAndFinish(async () => {
            const r = await bulkRemoveTag({ ids: selectedIds, tag })
            setRemoveTagOpen(false)
            return r
          })
        }}
      />
    </>
  )
}

function ChangeOwnerModal({
  open,
  onClose,
  owners,
  busy,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  owners: { id: string; name: string | null; email: string }[]
  busy: boolean
  onSubmit: (ownerUserId: string | null) => void
}) {
  const [value, setValue] = useState<string>("")
  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title="Change owner">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Reassign ownership of the selected contacts. Select &ldquo;Unassigned&rdquo; to clear the
          current owner.
        </p>
        <select
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
          }}
          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
        >
          <option value="">— Select owner —</option>
          <option value="__unassigned__">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name ?? o.email}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!value || busy}
            onClick={() => {
              onSubmit(value === "__unassigned__" ? null : value)
            }}
          >
            {busy ? "Updating…" : "Update owner"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ChangeStatusModal({
  open,
  onClose,
  busy,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  busy: boolean
  onSubmit: (status: LifecycleStatus) => void
}) {
  const [value, setValue] = useState<LifecycleStatus | "">("")
  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title="Change lifecycle status">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Set the lifecycle status for the selected contacts.
        </p>
        <select
          value={value}
          onChange={(e) => {
            setValue(e.target.value as LifecycleStatus | "")
          }}
          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
        >
          <option value="">— Select status —</option>
          {LIFECYCLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!value || busy}
            onClick={() => {
              if (value) onSubmit(value)
            }}
          >
            {busy ? "Updating…" : "Update status"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function TagModal({
  open,
  onClose,
  title,
  cta,
  tagOptions,
  busy,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  cta: string
  tagOptions: string[]
  busy: boolean
  onSubmit: (tag: string) => void
}) {
  const [tag, setTag] = useState("")
  if (!open) return null
  const trimmed = tag.trim()
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!trimmed || busy) return
          onSubmit(trimmed)
        }}
      >
        <div className="space-y-1">
          <Input
            value={tag}
            onChange={(e) => {
              setTag(e.target.value)
            }}
            placeholder="Tag name"
            autoFocus
            maxLength={80}
            list="bulk-tag-options"
          />
          <datalist id="bulk-tag-options">
            {tagOptions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmed || busy}>
            {busy ? "Working…" : cta}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
