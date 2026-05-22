"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core"
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import { SaveViewModal } from "./save-view-modal"
import { VisibilityModal, type OrgMember } from "./visibility-modal"
import {
  createSavedView,
  deleteSavedView,
  duplicateSavedView,
  updateSavedView,
  updateUserViewPrefs,
} from "../actions"
import type { ColumnConfigItem, Filter, Sort, Visibility } from "../types"

export interface SavedViewTab {
  id: string
  name: string
  visibility: Visibility
  sharedWithUserIds: string[] | null
  ownerUserId: string | null
  isDefault: boolean
  columnConfig: ColumnConfigItem[]
  filters: unknown[] | null
  sort: unknown
}

interface TabStripProps {
  /** All views the user can see for this object type, in DB order (we re-order per prefs). */
  views: SavedViewTab[]
  /** Active view id from ?view=, falls back to the default view if not present. */
  activeViewId: string
  /** Per-user tab order (id list). Views not in this list render after the ordered ones. */
  orderedViewIds: string[]
  /** Current user id — for owner-only menu items. */
  currentUserId: string
  /** Object type — passed into actions / prefs upserts. */
  objectType: "contact" | "task" | "project" | "opportunity" | "company"
  /** Org members for the visibility modal picker. */
  members: OrgMember[]
  /**
   * "Is the active view's stored state different from the user's current
   * state?" — computed by the parent (the parent sees both the URL filters
   * + the column state in the table). Drives the dirty dot + Save button.
   */
  isDirty: boolean
  /**
   * Snapshot of the CURRENT (potentially dirty) state to persist on Save /
   * Save-as. Filters are URL-derived; columnConfig is from the table's
   * client column state; sort is URL-derived.
   */
  currentState: {
    filters: Filter[]
    columnConfig: ColumnConfigItem[]
    sort: Sort | null
  }
}

export function SavedViewsTabStrip({
  views,
  activeViewId,
  orderedViewIds,
  currentUserId,
  objectType,
  members,
  isDirty,
  currentState,
}: TabStripProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  // ──────────────────────────────────────────────────────────────────
  // Tab ordering — All contacts first, then user-ordered, then the rest.
  // ──────────────────────────────────────────────────────────────────
  const orderedTabs = useMemo(() => {
    const defaultView = views.find((v) => v.isDefault)
    const userOwnedOrShared = views.filter((v) => v.id !== defaultView?.id)
    const byId = new Map(userOwnedOrShared.map((v) => [v.id, v]))
    const ordered: SavedViewTab[] = []
    for (const id of orderedViewIds) {
      const v = byId.get(id)
      if (v) {
        ordered.push(v)
        byId.delete(id)
      }
    }
    // Remaining (newly-created views not in prefs yet) — append in name order.
    const rest = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
    return { defaultView, customViews: [...ordered, ...rest] }
  }, [views, orderedViewIds])

  // ──────────────────────────────────────────────────────────────────
  // Modal / menu state
  // ──────────────────────────────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState<SavedViewTab | null>(null)
  const [visibilityTarget, setVisibilityTarget] = useState<SavedViewTab | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavedViewTab | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // ──────────────────────────────────────────────────────────────────
  // Active view derivation
  // ──────────────────────────────────────────────────────────────────
  const activeView = views.find((v) => v.id === activeViewId) ?? orderedTabs.defaultView
  const activeIsDefault = activeView?.isDefault === true
  const activeIsOwned = activeView?.ownerUserId === currentUserId

  // ──────────────────────────────────────────────────────────────────
  // Tab navigation
  // ──────────────────────────────────────────────────────────────────
  function switchToView(viewId: string) {
    startTransition(() => {
      router.push(`${pathname}?view=${viewId}`)
    })
    // Fire-and-forget last-viewed pref update.
    void updateUserViewPrefs({ objectType, lastViewedViewId: viewId })
  }

  // ──────────────────────────────────────────────────────────────────
  // Drag-reorder (only for customViews — default tab is locked leftmost)
  // ──────────────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const currentIds = orderedTabs.customViews.map((v) => v.id)
    const oldIndex = currentIds.indexOf(String(active.id))
    const newIndex = currentIds.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(currentIds, oldIndex, newIndex)
    void updateUserViewPrefs({ objectType, orderedViewIds: next })
    router.refresh()
  }

  // ──────────────────────────────────────────────────────────────────
  // CRUD action wrappers
  // ──────────────────────────────────────────────────────────────────
  async function doSaveOverwrite() {
    if (!activeView || activeIsDefault || !activeIsOwned) return
    setBusy(true)
    const result = await updateSavedView({
      id: activeView.id,
      filters: currentState.filters,
      columnConfig: currentState.columnConfig,
      sort: currentState.sort,
    })
    setBusy(false)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    // Drop filter params so the URL matches the freshly-saved view.
    startTransition(() => {
      router.push(`${pathname}?view=${activeView.id}`)
    })
  }

  async function doSaveAs(name: string, visibility: Visibility, sharedWith: string[] | null) {
    if (!activeView) return
    setBusy(true)
    const result = await createSavedView({
      objectType,
      name,
      visibility,
      sharedWithUserIds: sharedWith,
      filters: currentState.filters,
      sort: currentState.sort,
      columnConfig: currentState.columnConfig,
    })
    setBusy(false)
    setSaveAsOpen(false)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    const newId = result.data?.id
    if (newId) {
      startTransition(() => {
        router.push(`${pathname}?view=${newId}`)
      })
    }
  }

  async function doRename(name: string) {
    if (!renameTarget) return
    setBusy(true)
    const result = await updateSavedView({ id: renameTarget.id, name })
    setBusy(false)
    setRenameTarget(null)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    router.refresh()
  }

  async function doDuplicate(view: SavedViewTab) {
    const newName = `${view.name} (copy)`
    const result = await duplicateSavedView({ id: view.id, newName })
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    const newId = result.data?.id
    if (newId) {
      startTransition(() => {
        router.push(`${pathname}?view=${newId}`)
      })
    }
  }

  async function doDeleteConfirm() {
    if (!deleteTarget) return
    setBusy(true)
    const result = await deleteSavedView({ id: deleteTarget.id })
    setBusy(false)
    setDeleteTarget(null)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    // Navigate to the default tab if we just nuked the active view.
    const def = orderedTabs.defaultView
    if (deleteTarget.id === activeViewId && def) {
      startTransition(() => {
        router.push(`${pathname}?view=${def.id}`)
      })
    } else {
      router.refresh()
    }
  }

  async function doVisibilityUpdate(visibility: Visibility, sharedWith: string[] | null) {
    if (!visibilityTarget) return
    setBusy(true)
    const result = await updateSavedView({
      id: visibilityTarget.id,
      visibility,
      sharedWithUserIds: sharedWith,
    })
    setBusy(false)
    setVisibilityTarget(null)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-2">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {/* All Contacts (system default) — always leftmost, no menu, no drag */}
          {orderedTabs.defaultView ? (
            <TabButton
              tab={orderedTabs.defaultView}
              active={orderedTabs.defaultView.id === activeViewId}
              dirty={isDirty && orderedTabs.defaultView.id === activeViewId}
              onClick={() => {
                const def = orderedTabs.defaultView
                if (def) switchToView(def.id)
              }}
            />
          ) : null}

          {/* User views — drag-reorderable */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={orderedTabs.customViews.map((v) => v.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex items-center gap-1">
                {orderedTabs.customViews.map((tab) => (
                  <SortableTab
                    key={tab.id}
                    tab={tab}
                    active={tab.id === activeViewId}
                    dirty={isDirty && tab.id === activeViewId}
                    canManage={tab.ownerUserId === currentUserId}
                    onClick={() => {
                      switchToView(tab.id)
                    }}
                    onRename={() => {
                      setRenameTarget(tab)
                    }}
                    onDuplicate={() => {
                      void doDuplicate(tab)
                    }}
                    onDelete={() => {
                      setDeleteTarget(tab)
                    }}
                    onVisibility={() => {
                      setVisibilityTarget(tab)
                    }}
                    onSaveAs={() => {
                      setSaveAsOpen(true)
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* "+" button → Save current view as new view */}
          <button
            type="button"
            onClick={() => {
              setSaveAsOpen(true)
            }}
            aria-label="Save current view as new view"
            className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-[var(--color-border)] text-base text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
          >
            +
          </button>
        </div>

        {/* Save / Save-as button on the right */}
        {isDirty && (
          <div className="flex shrink-0 items-center gap-2">
            {activeIsDefault || !activeIsOwned ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSaveAsOpen(true)
                }}
              >
                Save as new view
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSaveAsOpen(true)
                  }}
                >
                  Save as
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void doSaveOverwrite()
                  }}
                >
                  {busy ? "Saving…" : "Save"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Rename modal */}
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

      {/* Save-as modal: collects name THEN visibility (chained via local state) */}
      <SaveAsFlow
        open={saveAsOpen}
        onClose={() => {
          if (!busy) setSaveAsOpen(false)
        }}
        onSubmit={(name, visibility, sharedWith) => {
          void doSaveAs(name, visibility, sharedWith)
        }}
        members={members}
        currentUserId={currentUserId}
        submitting={busy}
      />

      {/* Visibility modal for the kebab menu */}
      {visibilityTarget && (
        <VisibilityModal
          open={!!visibilityTarget}
          onClose={() => {
            if (!busy) setVisibilityTarget(null)
          }}
          onSubmit={(visibility, sharedWith) => {
            void doVisibilityUpdate(visibility, sharedWith)
          }}
          members={members}
          currentUserId={currentUserId}
          initialVisibility={visibilityTarget.visibility}
          initialSharedWithUserIds={visibilityTarget.sharedWithUserIds}
          submitting={busy}
        />
      )}

      {/* Delete confirm */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        onClose={() => {
          if (!busy) setDeleteTarget(null)
        }}
        onConfirm={() => {
          void doDeleteConfirm()
        }}
        body={`This view will be permanently removed from your saved views.`}
        submitting={busy}
      />
    </div>
  )
}

// ─── Tab button + sortable wrapper ────────────────────────────────────

function TabButton({
  tab,
  active,
  dirty,
  onClick,
  endSlot,
  dragHandle,
}: {
  tab: SavedViewTab
  active: boolean
  dirty: boolean
  onClick: () => void
  endSlot?: React.ReactNode
  dragHandle?: React.ReactNode
}) {
  return (
    <div
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition ${
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 font-medium"
          : "border-transparent hover:bg-[var(--color-accent)]"
      }`}
    >
      {dragHandle}
      <button type="button" onClick={onClick} className="cursor-pointer">
        {tab.name}
        {dirty && <span className="ml-1 text-[var(--color-primary)]">•</span>}
      </button>
      {endSlot}
    </div>
  )
}

function SortableTab({
  tab,
  active,
  dirty,
  canManage,
  onClick,
  onRename,
  onDuplicate,
  onDelete,
  onVisibility,
  onSaveAs,
}: {
  tab: SavedViewTab
  active: boolean
  dirty: boolean
  canManage: boolean
  onClick: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  onVisibility: () => void
  onSaveAs: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} className="inline-flex">
      <TabButton
        tab={tab}
        active={active}
        dirty={dirty}
        onClick={onClick}
        dragHandle={
          <span
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="cursor-grab text-xs text-[var(--color-muted-foreground)]"
          >
            ⋮⋮
          </span>
        }
        endSlot={
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${tab.name}`}
              className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-xs hover:bg-[var(--color-accent)]"
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              ⋮
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!canManage} onSelect={onRename}>
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
              <DropdownMenuItem disabled={!canManage} onSelect={onDelete}>
                Delete
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canManage} onSelect={onVisibility}>
                Visibility…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onSaveAs}>Save as new view…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    </div>
  )
}

// ─── Save-as flow (name → visibility, single submit) ──────────────────

function SaveAsFlow({
  open,
  onClose,
  onSubmit,
  members,
  currentUserId,
  submitting,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (name: string, visibility: Visibility, sharedWith: string[] | null) => void
  members: OrgMember[]
  currentUserId: string
  submitting: boolean
}) {
  const [step, setStep] = useState<"name" | "visibility">("name")
  const [pendingName, setPendingName] = useState("")

  function close() {
    onClose()
    setStep("name")
    setPendingName("")
  }

  if (step === "name") {
    return (
      <SaveViewModal
        open={open}
        onClose={close}
        onSubmit={(name) => {
          setPendingName(name)
          setStep("visibility")
        }}
        title="Save current view as…"
        submitting={false}
        cta="Next: visibility"
      />
    )
  }
  return (
    <VisibilityModal
      open={open}
      onClose={close}
      onSubmit={(visibility, sharedWith) => {
        onSubmit(pendingName, visibility, sharedWith)
        setStep("name")
        setPendingName("")
      }}
      members={members}
      currentUserId={currentUserId}
      initialVisibility="private"
      initialSharedWithUserIds={null}
      submitting={submitting}
    />
  )
}
