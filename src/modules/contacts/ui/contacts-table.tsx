"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
import { archiveContact, deleteContact } from "../actions"
import { fontFromElement, getMeasurementContext, measureColumnAutoFit } from "./column-auto-fit"
import { resolveContactColumns, type ColumnConfigItem, type ContactRow } from "./columns"

const DELETE_BODY =
  "This contact will be moved to Deleted and automatically purged after 90 days. You can restore it before then on the Deleted page."

interface ContactsTableProps {
  rows: ContactRow[]
  columnConfig: ColumnConfigItem[]
  onColumnConfigChange: (next: ColumnConfigItem[]) => void
  /** Push 2c — controlled selection state for bulk actions. */
  selectedIds: Set<string>
  onSelectedIdsChange: (next: Set<string>) => void
}

export type { ContactRow }

/**
 * Client table for /contacts with the Push 2b machinery:
 *
 *   - Column visibility, order, and width derived from `columnConfig`.
 *   - Direct table-header drag (via @dnd-kit) to reorder visible
 *     columns. Reorder writes a new `columnConfig` back through
 *     `onColumnConfigChange`.
 *   - Right-edge drag on a column header to resize that column.
 *     Mouse events bypass dnd-kit (different region) and update width
 *     in the parent's column config.
 *   - "Edit columns" affordance pinned to the trailing menu column
 *     (far right of the header row).
 *   - Vertical dividers between every column header + body cell.
 *
 * Row click → navigate to /contacts/[id]. Trailing ⋮ menu uses
 * stopPropagation so it never triggers row navigation. Edit / Archive
 * / Delete behaviors unchanged from Push 2a.
 */
export function ContactsTable({
  rows,
  columnConfig,
  onColumnConfigChange,
  selectedIds,
  onSelectedIdsChange,
}: ContactsTableProps) {
  // Header checkbox tri-state: all visible selected / partial / none.
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  const someOnPageSelected = rows.some((r) => selectedIds.has(r.id))

  function toggleRow(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedIdsChange(next)
  }

  function toggleAll() {
    if (allOnPageSelected) {
      // Clear all currently-visible rows but preserve any selections that
      // weren't in the current page (sticky across pagination).
      const next = new Set(selectedIds)
      for (const r of rows) next.delete(r.id)
      onSelectedIdsChange(next)
    } else {
      const next = new Set(selectedIds)
      for (const r of rows) next.add(r.id)
      onSelectedIdsChange(next)
    }
  }

  const router = useRouter()
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const resolved = resolveContactColumns(columnConfig)
  const visibleIds = resolved.visible.map((c) => c.id)

  function onArchive(id: string) {
    void (async () => {
      const result = await archiveContact({ id })
      if (result.serverError) {
        alert(result.serverError)
        return
      }
      router.refresh()
    })()
  }

  async function onDeleteConfirm() {
    if (!deleteTargetId) return
    setBusyDelete(true)
    const result = await deleteContact({ id: deleteTargetId })
    setBusyDelete(false)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    setDeleteTargetId(null)
    router.refresh()
  }

  // ── DnD: reorder visible columns by dragging the header ─────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function onHeaderDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = visibleIds
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const reorderedVisible = arrayMove(ids, oldIndex, newIndex)
    // Reproject the full column_config: visible ones in the new order,
    // hidden ones at the end in their existing relative order. The
    // "order" indexes get re-numbered sequentially.
    const visibleSet = new Set(reorderedVisible)
    const next: ColumnConfigItem[] = [
      ...reorderedVisible.map((id) => {
        const existing = resolved.all.find((c) => c.id === id)
        return {
          id,
          visible: true,
          order: 0, // re-numbered below
          width: existing?.width ?? null,
        }
      }),
      ...resolved.all
        .filter((c) => !visibleSet.has(c.id))
        .map((c) => ({ id: c.id, visible: c.visible, order: 0, width: c.width })),
    ].map((c, i) => ({ ...c, order: i }))
    onColumnConfigChange(next)
  }

  // ── Width drag ─────────────────────────────────────────────────────
  function startResize(columnId: string, startX: number, startWidth: number) {
    function onMove(e: MouseEvent) {
      const delta = e.clientX - startX
      const next = Math.max(60, startWidth + delta)
      onColumnConfigChange(
        resolved.all.map((c) =>
          c.id === columnId ? { id: c.id, visible: c.visible, order: c.order, width: next } : c,
        ),
      )
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  // ── Auto-fit on dblclick (Push 2c.1) ────────────────────────────────
  // Measure the widest content via canvas measureText so CSS truncation
  // doesn't fool the width. Clamped to [60, 400] inside the helper.
  function autoFitColumn(columnId: string, hostEl: Element) {
    const ctx = getMeasurementContext()
    if (!ctx) return
    const def = resolved.all.find((c) => c.id === columnId)?.def
    if (!def) return
    const cellValues = rows.map((r) => def.render(r))
    const next = measureColumnAutoFit({
      ctx,
      font: fontFromElement(hostEl),
      headerLabel: def.label,
      cellValues,
    })
    onColumnConfigChange(
      resolved.all.map((c) =>
        c.id === columnId ? { id: c.id, visible: c.visible, order: c.order, width: next } : c,
      ),
    )
  }

  return (
    <>
      <div className="overflow-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
            <tr>
              <th className="w-10 border-r border-b border-[var(--color-border)] px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected
                  }}
                  onChange={toggleAll}
                />
              </th>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onHeaderDragEnd}
              >
                <SortableContext items={visibleIds} strategy={horizontalListSortingStrategy}>
                  {resolved.visible.map((col) => {
                    const cfg = resolved.all.find((c) => c.id === col.id)
                    return (
                      <SortableHeaderCell
                        key={col.id}
                        id={col.id}
                        label={col.label}
                        width={cfg?.width ?? col.defaultWidth}
                        onResizeStart={(startX, startWidth) => {
                          startResize(col.id, startX, startWidth)
                        }}
                        onAutoFit={(hostEl) => {
                          autoFitColumn(col.id, hostEl)
                        }}
                      />
                    )
                  })}
                </SortableContext>
              </DndContext>
              <th className="w-10 border-b border-[var(--color-border)] px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`cursor-pointer hover:bg-[var(--color-accent)]/30 ${
                  selectedIds.has(row.id) ? "bg-[var(--color-primary)]/5" : ""
                }`}
                onClick={() => {
                  router.push(`/contacts/${row.id}`)
                }}
              >
                <td
                  className="w-10 border-t border-r border-[var(--color-border)] px-2 py-2"
                  onClick={(e) => {
                    e.stopPropagation()
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.firstName} ${row.lastName}`}
                    checked={selectedIds.has(row.id)}
                    onChange={() => {
                      toggleRow(row.id)
                    }}
                  />
                </td>
                {resolved.visible.map((col) => {
                  const cfg = resolved.all.find((c) => c.id === col.id)
                  const width = cfg?.width ?? col.defaultWidth
                  return (
                    <td
                      key={col.id}
                      className="border-t border-r border-[var(--color-border)] px-4 py-2"
                      style={{ width: width ? `${String(width)}px` : undefined }}
                    >
                      {col.render(row)}
                    </td>
                  )
                })}
                <td
                  className="w-12 border-t border-[var(--color-border)] px-2 py-2 text-right"
                  onClick={(e) => {
                    e.stopPropagation()
                  }}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Actions for ${row.firstName} ${row.lastName}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-[var(--color-accent)]"
                    >
                      ⋮
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          router.push(`/contacts/${row.id}/edit`)
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          onArchive(row.id)
                        }}
                      >
                        Archive
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          setDeleteTargetId(row.id)
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DeleteConfirmModal
        open={!!deleteTargetId}
        onClose={() => {
          if (!busyDelete) setDeleteTargetId(null)
        }}
        onConfirm={() => {
          void onDeleteConfirm()
        }}
        body={DELETE_BODY}
        submitting={busyDelete}
      />
    </>
  )
}

function SortableHeaderCell({
  id,
  label,
  width,
  onResizeStart,
  onAutoFit,
}: {
  id: string
  label: string
  width: number | null
  onResizeStart: (startX: number, startWidth: number) => void
  /** Push 2c.1 — receives the header <th> so autofit can read its font. */
  onAutoFit: (hostEl: Element) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    width: width ? `${String(width)}px` : undefined,
  }
  // The drag listeners attach to the header BODY, not the resize handle —
  // so the right-edge cursor:col-resize region remains independently
  // mouse-down-grabbable for width.
  return (
    <th
      ref={setNodeRef}
      style={style}
      className="relative border-r border-b border-[var(--color-border)] px-4 py-2"
    >
      <span {...attributes} {...listeners} className="cursor-grab select-none">
        {label}
      </span>
      <span
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize · Double-click to auto-fit"
        onMouseDown={(e) => {
          // Push 2c.1 — guard against the dblclick path. detail === 2
          // means this is the second click of a double-click — don't
          // start a drag; the dblclick handler runs separately.
          if (e.detail >= 2) return
          // Capture starting width from the DOM rect — header may have
          // been laid out by flex with no fixed width yet.
          const th = e.currentTarget.parentElement
          const startWidth = th ? th.getBoundingClientRect().width : (width ?? 120)
          onResizeStart(e.clientX, startWidth)
        }}
        onDoubleClick={(e) => {
          const th = e.currentTarget.parentElement
          if (th) onAutoFit(th)
        }}
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-primary)]/40"
      />
    </th>
  )
}

// ContactRow is re-exported above so the page can import it from this file
// (kept for back-compat with existing page imports).
