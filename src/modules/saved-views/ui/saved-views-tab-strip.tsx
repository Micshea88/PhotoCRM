"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import { AddViewDropdown } from "./add-view-dropdown"
import { ManageViewsDrawer } from "./manage-views-drawer"
import { SaveViewModal } from "./save-view-modal"
import { SavedViewBanner } from "./saved-view-banner"
import { VisibilityModal, type OrgMember } from "./visibility-modal"
import {
  createSavedView,
  deleteSavedView,
  duplicateSavedView,
  pinView,
  setDefaultView,
  unpinView,
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
  /** All views the user can see for this object type. */
  views: SavedViewTab[]
  /** Active view id from ?view=, falls back to the default view if not present. */
  activeViewId: string
  /** Per-user pinned-tab order. Renders verbatim in the strip. */
  pinnedViewIds: string[]
  /** User's "set as my default" view id, or null to fall back to the system All Contacts. */
  defaultViewId: string | null
  /** True if a prefs row exists for (org, user, object_type). Drives auto-pin. */
  hasPrefsRow: boolean
  /** Current user id — for owner-only menu items. */
  currentUserId: string
  /** Object type — passed into actions / prefs upserts. */
  objectType: "contact" | "task" | "project" | "opportunity" | "company"
  /** Org members for the visibility modal picker. */
  members: OrgMember[]
  /** id → createdAt ISO. Passed through to ManageViewsDrawer for Created sort. */
  createdAtById: Record<string, string>
  /** "Is the active view's stored state different from the user's current state?" */
  isDirty: boolean
  /** Snapshot of CURRENT (potentially dirty) state to persist on Save / Save-as. */
  currentState: {
    filters: Filter[]
    columnConfig: ColumnConfigItem[]
    sort: Sort | null
  }
  /** Called when the user clicks Discard on the banner — host resets column state + URL params. */
  onDiscard: () => void
}

export function SavedViewsTabStrip({
  views,
  activeViewId,
  pinnedViewIds,
  defaultViewId,
  hasPrefsRow,
  currentUserId,
  objectType,
  members,
  createdAtById,
  isDirty,
  currentState,
  onDiscard,
}: TabStripProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  // ──────────────────────────────────────────────────────────────────
  // Auto-pin on first visit — if no prefs row yet AND the system default
  // exists (All Contacts), persist a pinned_view_ids row with just that
  // id. Fires once per user per object_type, then `hasPrefsRow` flips
  // true and this never runs again.
  // ──────────────────────────────────────────────────────────────────
  const autoPinFiredRef = useRef(false)
  useEffect(() => {
    if (hasPrefsRow) return
    if (autoPinFiredRef.current) return
    const systemDefault = views.find((v) => v.isDefault && v.ownerUserId === null)
    if (!systemDefault) return
    if (pinnedViewIds.includes(systemDefault.id)) return
    autoPinFiredRef.current = true
    void updateUserViewPrefs({
      objectType,
      pinnedViewIds: [systemDefault.id, ...pinnedViewIds],
    })
  }, [hasPrefsRow, views, pinnedViewIds, objectType])

  // ──────────────────────────────────────────────────────────────────
  // Pinned tabs derivation. Drop orphaned ids (deleted views). If the
  // active view is not pinned, render it at the end as a transient tab
  // so the user always sees which view is active.
  // ──────────────────────────────────────────────────────────────────
  const { pinnedTabs, transientTab } = useMemo(() => {
    const byId = new Map(views.map((v) => [v.id, v]))
    const pinned: SavedViewTab[] = []
    for (const id of pinnedViewIds) {
      const v = byId.get(id)
      if (v) pinned.push(v)
    }
    const active = byId.get(activeViewId)
    const isPinned = active && pinnedViewIds.includes(active.id)
    return {
      pinnedTabs: pinned,
      transientTab: active && !isPinned ? active : null,
    }
  }, [views, pinnedViewIds, activeViewId])

  // ──────────────────────────────────────────────────────────────────
  // Modal / drawer state
  // ──────────────────────────────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState<SavedViewTab | null>(null)
  const [visibilityTarget, setVisibilityTarget] = useState<SavedViewTab | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavedViewTab | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // ──────────────────────────────────────────────────────────────────
  // Active view derivation
  // ──────────────────────────────────────────────────────────────────
  const activeView = views.find((v) => v.id === activeViewId) ?? null
  const activeIsSystemDefault = activeView?.isDefault === true && activeView.ownerUserId === null
  const activeIsOwned = activeView?.ownerUserId === currentUserId

  // ──────────────────────────────────────────────────────────────────
  // Tab navigation
  // ──────────────────────────────────────────────────────────────────
  function switchToView(viewId: string) {
    startTransition(() => {
      router.push(`${pathname}?view=${viewId}`)
    })
    void updateUserViewPrefs({ objectType, lastViewedViewId: viewId })
  }

  // ──────────────────────────────────────────────────────────────────
  // Drag-reorder — pinnedViewIds is the source of truth for the strip
  // ──────────────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const currentIds = pinnedTabs.map((v) => v.id)
    const oldIndex = currentIds.indexOf(String(active.id))
    const newIndex = currentIds.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(currentIds, oldIndex, newIndex)
    void updateUserViewPrefs({ objectType, pinnedViewIds: next })
    router.refresh()
  }

  // ──────────────────────────────────────────────────────────────────
  // CRUD action wrappers
  // ──────────────────────────────────────────────────────────────────
  async function doSaveOverwrite() {
    if (!activeView || activeIsSystemDefault || !activeIsOwned) return
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
      // Auto-pin the freshly-saved view so the user has a tab for it.
      void pinView({ objectType, viewId: newId })
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

  async function doDuplicateActive() {
    if (!activeView) return
    const newName = `${activeView.name} (copy)`
    const result = await duplicateSavedView({ id: activeView.id, newName })
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    const newId = result.data?.id
    if (newId) {
      void pinView({ objectType, viewId: newId })
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
    if (deleteTarget.id === activeViewId) {
      const systemDefault = views.find((v) => v.isDefault && v.ownerUserId === null)
      const fallback = systemDefault?.id ?? pinnedTabs.find((t) => t.id !== deleteTarget.id)?.id
      if (fallback) {
        startTransition(() => {
          router.push(`${pathname}?view=${fallback}`)
        })
        return
      }
    }
    router.refresh()
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

  async function doSetDefaultActive() {
    if (!activeView) return
    const isCurrentlyDefault = defaultViewId === activeView.id
    const result = await setDefaultView({
      objectType,
      viewId: isCurrentlyDefault ? null : activeView.id,
    })
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    router.refresh()
  }

  async function doUnpinActive() {
    if (!activeView) return
    const result = await unpinView({ objectType, viewId: activeView.id })
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    router.refresh()
  }

  // ──────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] pb-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={pinnedTabs.map((v) => v.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex flex-1 items-center gap-1 overflow-x-auto">
              {pinnedTabs.map((tab) => {
                const active = tab.id === activeViewId
                return (
                  <SortableTab
                    key={tab.id}
                    tab={tab}
                    active={active}
                    isDefault={defaultViewId === tab.id}
                    isSystemDefault={tab.isDefault && tab.ownerUserId === null}
                    canMutate={tab.ownerUserId === currentUserId && !tab.isDefault}
                    isPinned={true}
                    onClick={() => {
                      switchToView(tab.id)
                    }}
                    onRename={() => {
                      setRenameTarget(tab)
                    }}
                    onDuplicate={() => {
                      void doDuplicateActive()
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
                    onUnpin={() => {
                      void doUnpinActive()
                    }}
                    onSetDefault={() => {
                      void doSetDefaultActive()
                    }}
                  />
                )
              })}
              {transientTab && (
                <TabButton
                  tab={transientTab}
                  active={true}
                  isDefault={defaultViewId === transientTab.id}
                  isSystemDefault={transientTab.isDefault && transientTab.ownerUserId === null}
                  isPinned={false}
                  canMutate={transientTab.ownerUserId === currentUserId && !transientTab.isDefault}
                  onClick={() => {
                    /* already active */
                  }}
                  onRename={() => {
                    setRenameTarget(transientTab)
                  }}
                  onDuplicate={() => {
                    void doDuplicateActive()
                  }}
                  onDelete={() => {
                    setDeleteTarget(transientTab)
                  }}
                  onVisibility={() => {
                    setVisibilityTarget(transientTab)
                  }}
                  onSaveAs={() => {
                    setSaveAsOpen(true)
                  }}
                  onPin={() => {
                    void (async () => {
                      const result = await pinView({ objectType, viewId: transientTab.id })
                      if (result.serverError) {
                        alert(result.serverError)
                        return
                      }
                      router.refresh()
                    })()
                  }}
                  onSetDefault={() => {
                    void doSetDefaultActive()
                  }}
                />
              )}
              <AddViewDropdown
                onCreateNew={() => {
                  setSaveAsOpen(true)
                }}
                onManage={() => {
                  setManageOpen(true)
                }}
              />
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {isDirty && activeView && (
        <SavedViewBanner
          canOverwrite={activeIsOwned && !activeIsSystemDefault}
          busy={busy}
          onSave={() => {
            void doSaveOverwrite()
          }}
          onSaveAs={() => {
            setSaveAsOpen(true)
          }}
          onDiscard={onDiscard}
        />
      )}

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

      {/* Save-as flow (name → visibility) */}
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

      {/* Visibility modal (per-tab kebab) */}
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
        body="This view will be permanently removed from your saved views."
        submitting={busy}
      />

      {/* Manage views drawer */}
      <ManageViewsDrawer
        open={manageOpen}
        onClose={() => {
          if (!busy) setManageOpen(false)
        }}
        views={views}
        pinnedViewIds={pinnedViewIds}
        defaultViewId={defaultViewId}
        currentUserId={currentUserId}
        objectType={objectType}
        members={members}
        createdAtById={createdAtById}
      />
    </div>
  )
}

// ─── Tab button + sortable wrapper ────────────────────────────────────

interface TabButtonProps {
  tab: SavedViewTab
  active: boolean
  isDefault: boolean
  isSystemDefault: boolean
  canMutate: boolean
  isPinned: boolean
  onClick: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  onVisibility: () => void
  onSaveAs: () => void
  onPin?: () => void
  onUnpin?: () => void
  onSetDefault: () => void
  dragHandle?: React.ReactNode
}

function TabButton({
  tab,
  active,
  isDefault,
  isSystemDefault,
  canMutate,
  isPinned,
  onClick,
  onRename,
  onDuplicate,
  onDelete,
  onVisibility,
  onSaveAs,
  onPin,
  onUnpin,
  onSetDefault,
  dragHandle,
}: TabButtonProps) {
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
        {isDefault && (
          <span
            aria-label="Your default view"
            title="Your default view"
            className="ml-1 text-amber-500"
          >
            ★
          </span>
        )}
      </button>
      {active && (
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
            <DropdownMenuItem onSelect={onSetDefault}>
              {isDefault ? "Clear default" : "Set as my default"}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMutate} onSelect={onRename}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>Clone</DropdownMenuItem>
            <DropdownMenuItem disabled={!canMutate} onSelect={onVisibility}>
              Share…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSaveAs}>Save as new view…</DropdownMenuItem>
            {isPinned && onUnpin && (
              <DropdownMenuItem onSelect={onUnpin}>Unpin from tabs</DropdownMenuItem>
            )}
            {!isPinned && onPin && (
              <DropdownMenuItem onSelect={onPin}>Pin to tabs</DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!canMutate || isSystemDefault} onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function SortableTab(props: TabButtonProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.tab.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} className="inline-flex">
      <TabButton
        {...props}
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
