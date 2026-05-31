"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"
import {
  bulkAddTag,
  bulkChangeContactType,
  bulkChangeOwner,
  bulkChangeStatus,
  bulkDeleteContacts,
  bulkRemoveTag,
} from "../actions"
import { CONTACT_TYPES, LIFECYCLE_STATUSES, type ContactType, type LifecycleStatus } from "../types"
import { BulkEditDrawer } from "./bulk-edit-drawer"

/**
 * Push 2c.2 — selection banner.
 *
 * Replaces the row-above-table "Actions" dropdown's 1+-selected state
 * with a HubSpot-style contextual banner. Appears only when at least
 * one contact row is selected; bulk-action buttons render inline on
 * the right.
 *
 * Visual: matches the SavedViewBanner pattern from Push 2c (light
 * primary-tinted background, primary-tinted border, rounded). Sits
 * above the table, below the saved-view banner.
 *
 * Accessibility:
 *   - The "N selected" count is wrapped in aria-live="polite" so screen
 *     readers announce selection changes without grabbing focus.
 *   - Esc key globally clears the selection while this banner is open.
 */
export function SelectionBanner({
  selectedIds,
  ownerOptions,
  tagOptions,
  companyOptions = [],
  leadSourceOptions = [],
  hiddenLeadSources = [],
  onClear,
}: {
  selectedIds: string[]
  ownerOptions: { id: string; name: string | null; email: string }[]
  tagOptions: string[]
  /** Push 2c.4 part 2 — option lists for the Bulk edit drawer. Default
   *  to empty arrays so older callers (or tests) don't need to pass them. */
  companyOptions?: { id: string; name: string }[]
  leadSourceOptions?: string[]
  /** Push 3 (C3) — org-level hidden lead sources, threaded to the Bulk
   *  Edit drawer's LeadSourceCombobox so admin-hidden sources don't
   *  appear as bulk-change targets. */
  hiddenLeadSources?: string[]
  /** Called after a successful bulk action OR when the user clicks Clear / hits Esc. */
  onClear: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [typeOpen, setTypeOpen] = useState(false)
  const [addTagOpen, setAddTagOpen] = useState(false)
  const [removeTagOpen, setRemoveTagOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)

  const count = selectedIds.length

  // Esc clears the selection. Window-level so it works regardless of
  // focus (table cells don't typically receive keyboard focus on click).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      // Don't steal Esc when a modal is open — let the modal close first.
      if (
        deleteOpen ||
        ownerOpen ||
        statusOpen ||
        typeOpen ||
        addTagOpen ||
        removeTagOpen ||
        bulkEditOpen
      )
        return
      if (count === 0) return
      onClear()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [
    count,
    onClear,
    deleteOpen,
    ownerOpen,
    statusOpen,
    typeOpen,
    addTagOpen,
    removeTagOpen,
    bulkEditOpen,
  ])

  if (count === 0) return null

  async function runAndFinish(fn: () => Promise<{ serverError?: string }>) {
    setBusy(true)
    const result = await fn()
    setBusy(false)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    onClear()
    router.refresh()
  }

  return (
    <>
      <div
        role="region"
        aria-label="Bulk actions for selected contacts"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5 px-3 py-2 text-sm"
      >
        <div className="flex items-center gap-3">
          <span aria-live="polite" className="font-medium">
            {String(count)} selected
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-[var(--color-muted-foreground)] underline-offset-2 hover:text-[var(--color-foreground)] hover:underline"
            disabled={busy}
          >
            Clear
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setOwnerOpen(true)
            }}
          >
            Change owner
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setStatusOpen(true)
            }}
          >
            Change status
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setTypeOpen(true)
            }}
          >
            Change type
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setAddTagOpen(true)
            }}
          >
            Add tag
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setRemoveTagOpen(true)
            }}
          >
            Remove tag
          </Button>
          {/* Push 2c.4 part 2 — Bulk edit drawer: master list of every
              editable field. Sits between the shortcut bulk actions
              and Delete so it reads as "more options" rather than a
              destructive op. */}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBulkEditOpen(true)
            }}
          >
            Bulk edit
          </Button>
          {/* P3 (C7) — bulk merge: only enabled when exactly 2
              contacts are selected (V1 = pairwise). Routes to the
              merge surface; the destination URL uses the first
              selected id as the "this" contact and the second as
              the "?with=" contact. */}
          {count === 2 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const [first, second] = selectedIds
                if (first && second) {
                  window.location.href = `/contacts/${first}/merge?with=${second}`
                }
              }}
              data-testid="bulk-merge"
            >
              Merge
            </Button>
          )}
          <Button
            size="sm"
            // Destructive style — red bg via inline class since the
            // current Button variant set doesn't ship a "destructive".
            className="bg-red-600 text-white hover:bg-red-700"
            disabled={busy}
            onClick={() => {
              setDeleteOpen(true)
            }}
          >
            Delete
          </Button>
        </div>
      </div>

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

      {/* Push 2c.4 — Change type modal */}
      <ChangeTypeModal
        open={typeOpen}
        onClose={() => {
          if (!busy) setTypeOpen(false)
        }}
        busy={busy}
        onSubmit={(contactType) => {
          void runAndFinish(async () => {
            const r = await bulkChangeContactType({ ids: selectedIds, contactType })
            setTypeOpen(false)
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

      <BulkEditDrawer
        open={bulkEditOpen}
        onClose={() => {
          if (!busy) setBulkEditOpen(false)
        }}
        selectedIds={selectedIds}
        companyOptions={companyOptions}
        ownerOptions={ownerOptions}
        leadSourceOptions={leadSourceOptions}
        hiddenLeadSources={hiddenLeadSources}
        tagOptions={tagOptions}
        onAfterApply={onClear}
      />
    </>
  )
}

// ─── Modals ────────────────────────────────────────────────────────────
// Identical shape to the modals that lived in the old bulk-actions-menu;
// kept inline here so SelectionBanner is self-contained.

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

// Push 2c.4 — Change type. Mirrors ChangeStatusModal's UX so the
// two modals feel identical to users.
function ChangeTypeModal({
  open,
  onClose,
  busy,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  busy: boolean
  onSubmit: (contactType: ContactType) => void
}) {
  const [value, setValue] = useState<ContactType | "">("")
  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title="Change contact type">
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Set the contact type for the selected contacts.
        </p>
        <select
          value={value}
          onChange={(e) => {
            setValue(e.target.value as ContactType | "")
          }}
          className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
        >
          <option value="">— Select type —</option>
          {CONTACT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
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
            {busy ? "Updating…" : "Update type"}
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
