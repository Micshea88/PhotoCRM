"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Drawer } from "@/components/ui/drawer"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SaveViewModal } from "./save-view-modal"
import { VisibilityModal, type OrgMember } from "./visibility-modal"
import {
  deleteSavedView,
  duplicateSavedView,
  pinView,
  setDefaultView,
  unpinView,
  updateSavedView,
} from "../actions"
import type { SavedViewTab } from "./saved-views-tab-strip"
import type { Visibility } from "../types"

type SortKey = "name-asc" | "name-desc" | "created-asc" | "created-desc"

/**
 * Push 2c — full "Manage views" surface. Lives behind the "+ Add view"
 * dropdown. Shows EVERY view the user can see (pinned or unpinned) with
 * search + sort, plus per-row actions covering the full lifecycle:
 * Pin/Unpin, Rename, Clone, Delete, Share (visibility), Set as default.
 *
 * System-default rows (owner_user_id IS NULL) get the destructive
 * actions (Rename / Delete / Share) disabled — RLS would reject them
 * anyway, but disabling them here is the clearer UX.
 *
 * The drawer width is intentionally wider than the More filters / Edit
 * columns drawers (720px vs 400px) — this surface is denser (a table).
 */
export function ManageViewsDrawer({
  open,
  onClose,
  views,
  pinnedViewIds,
  defaultViewId,
  currentUserId,
  objectType,
  members,
  createdAtById,
}: {
  open: boolean
  onClose: () => void
  views: SavedViewTab[]
  pinnedViewIds: string[]
  defaultViewId: string | null
  currentUserId: string
  objectType: "contact" | "task" | "project" | "opportunity" | "company"
  members: OrgMember[]
  /** id → createdAt ISO string. Drives Created sort + display. */
  createdAtById: Record<string, string>
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("name-asc")

  // Modal state for per-row actions
  const [renameTarget, setRenameTarget] = useState<SavedViewTab | null>(null)
  const [cloneTarget, setCloneTarget] = useState<SavedViewTab | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavedViewTab | null>(null)
  const [visibilityTarget, setVisibilityTarget] = useState<SavedViewTab | null>(null)

  const pinnedSet = useMemo(() => new Set(pinnedViewIds), [pinnedViewIds])

  const rows = useMemo(() => {
    const filtered = query.trim()
      ? views.filter((v) => v.name.toLowerCase().includes(query.trim().toLowerCase()))
      : [...views]
    filtered.sort((a, b) => {
      switch (sortKey) {
        case "name-asc":
          return a.name.localeCompare(b.name)
        case "name-desc":
          return b.name.localeCompare(a.name)
        case "created-asc":
          return (createdAtById[a.id] ?? "").localeCompare(createdAtById[b.id] ?? "")
        case "created-desc":
          return (createdAtById[b.id] ?? "").localeCompare(createdAtById[a.id] ?? "")
      }
    })
    return filtered
  }, [views, query, sortKey, createdAtById])

  async function withBusy<T>(fn: () => Promise<T>): Promise<T> {
    setBusy(true)
    try {
      return await fn()
    } finally {
      setBusy(false)
    }
  }

  async function doPin(view: SavedViewTab) {
    const result = await withBusy(() => pinView({ objectType, viewId: view.id }))
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    startTransition(() => {
      router.refresh()
    })
  }
  async function doUnpin(view: SavedViewTab) {
    const result = await withBusy(() => unpinView({ objectType, viewId: view.id }))
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    startTransition(() => {
      router.refresh()
    })
  }
  async function doSetDefault(view: SavedViewTab) {
    const result = await withBusy(() =>
      setDefaultView({
        objectType,
        viewId: view.id === defaultViewId ? null : view.id,
      }),
    )
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    startTransition(() => {
      router.refresh()
    })
  }
  async function doRename(name: string) {
    if (!renameTarget) return
    const result = await withBusy(() => updateSavedView({ id: renameTarget.id, name }))
    setRenameTarget(null)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    startTransition(() => {
      router.refresh()
    })
  }
  async function doClone(newName: string) {
    if (!cloneTarget) return
    const result = await withBusy(() => duplicateSavedView({ id: cloneTarget.id, newName }))
    setCloneTarget(null)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    startTransition(() => {
      router.refresh()
    })
  }
  async function doDeleteConfirm() {
    if (!deleteTarget) return
    const result = await withBusy(() => deleteSavedView({ id: deleteTarget.id }))
    setDeleteTarget(null)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    startTransition(() => {
      router.refresh()
    })
  }
  async function doVisibility(visibility: Visibility, sharedWith: string[] | null) {
    if (!visibilityTarget) return
    const result = await withBusy(() =>
      updateSavedView({
        id: visibilityTarget.id,
        visibility,
        sharedWithUserIds: sharedWith,
      }),
    )
    setVisibilityTarget(null)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <Drawer open={open} onClose={onClose} title="Manage views" widthClass="w-[720px]">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search by name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
            }}
            className="flex-1"
          />
          <select
            aria-label="Sort views"
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.target.value as SortKey)
            }}
            className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
          >
            <option value="name-asc">Name (A–Z)</option>
            <option value="name-desc">Name (Z–A)</option>
            <option value="created-desc">Created (newest)</option>
            <option value="created-asc">Created (oldest)</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Visibility</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-[var(--color-muted-foreground)]"
                  >
                    No views match.
                  </td>
                </tr>
              ) : null}
              {rows.map((v) => {
                const isPinned = pinnedSet.has(v.id)
                const isDefault = defaultViewId === v.id
                const isSystemDefault = v.isDefault && v.ownerUserId === null
                const isOwner = v.ownerUserId === currentUserId
                const canMutate = isOwner && !isSystemDefault
                return (
                  <tr
                    key={v.id}
                    className="border-t border-[var(--color-border)] hover:bg-[var(--color-accent)]/20"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{v.name}</span>
                        {isSystemDefault && (
                          <span className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                            System
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                      {visibilityLabel(v.visibility)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {isPinned && (
                          <span className="rounded bg-[var(--color-primary)]/15 px-1.5 py-0.5 text-[var(--color-primary)]">
                            Pinned
                          </span>
                        )}
                        {isDefault && (
                          <span className="rounded bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[var(--color-warning)]">
                            Default
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label={`Actions for ${v.name}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-[var(--color-accent)]"
                          disabled={busy}
                        >
                          ⋮
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              void (isPinned ? doUnpin(v) : doPin(v))
                            }}
                          >
                            {isPinned ? "Unpin from tabs" : "Pin to tabs"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              void doSetDefault(v)
                            }}
                          >
                            {isDefault ? "Clear default" : "Set as my default"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!canMutate}
                            onSelect={() => {
                              setRenameTarget(v)
                            }}
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setCloneTarget(v)
                            }}
                          >
                            Clone
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!canMutate}
                            onSelect={() => {
                              setVisibilityTarget(v)
                            }}
                          >
                            Share…
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!canMutate}
                            onSelect={() => {
                              setDeleteTarget(v)
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
      </div>

      <SaveViewModal
        open={!!renameTarget}
        onClose={() => {
          if (!busy) setRenameTarget(null)
        }}
        onSubmit={(name) => {
          void doRename(name)
        }}
        title="Rename view"
        defaultName={renameTarget?.name ?? ""}
        submitting={busy}
        cta="Rename"
      />

      <SaveViewModal
        open={!!cloneTarget}
        onClose={() => {
          if (!busy) setCloneTarget(null)
        }}
        onSubmit={(name) => {
          void doClone(name)
        }}
        title="Clone view"
        defaultName={cloneTarget ? `${cloneTarget.name} (copy)` : ""}
        submitting={busy}
        cta="Clone"
      />

      {visibilityTarget && (
        <VisibilityModal
          open={!!visibilityTarget}
          onClose={() => {
            if (!busy) setVisibilityTarget(null)
          }}
          onSubmit={(visibility, sharedWith) => {
            void doVisibility(visibility, sharedWith)
          }}
          members={members}
          currentUserId={currentUserId}
          initialVisibility={visibilityTarget.visibility}
          initialSharedWithUserIds={visibilityTarget.sharedWithUserIds}
          submitting={busy}
        />
      )}

      <DeleteConfirmModal
        open={!!deleteTarget}
        onClose={() => {
          if (!busy) setDeleteTarget(null)
        }}
        onConfirm={() => {
          void doDeleteConfirm()
        }}
        body="This view will be permanently removed from your saved views."
        submitting={busy}
      />
    </Drawer>
  )
}

function visibilityLabel(v: Visibility): string {
  if (v === "private") return "Only me"
  if (v === "shared_users") return "Specific users"
  return "Everyone in org"
}
