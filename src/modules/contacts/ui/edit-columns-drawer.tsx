"use client"

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
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { Drawer } from "@/components/ui/drawer"
import {
  CONTACT_COLUMN_REGISTRY,
  DEFAULT_CONTACT_COLUMNS,
  resolveContactColumns,
  type ColumnConfigItem,
} from "./columns"

interface EditColumnsDrawerProps {
  open: boolean
  onClose: () => void
  columns: ColumnConfigItem[]
  onChange: (next: ColumnConfigItem[]) => void
}

/**
 * Right-side drawer to manage the contact-list columns. Checkboxes
 * toggle visibility; drag handles reorder. "Reset to defaults" returns
 * to the seeded default column set (per the registry).
 *
 * The component receives `columns` (the current column config from
 * the page shell) and emits `onChange` for the parent to persist into
 * its dirty-state machinery. The drawer is presentation-only; it does
 * not call the saved-view actions itself.
 */
export function EditColumnsDrawer({ open, onClose, columns, onChange }: EditColumnsDrawerProps) {
  const resolved = resolveContactColumns(columns)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = resolved.all.map((c) => c.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(resolved.all, oldIndex, newIndex)
    const next: ColumnConfigItem[] = reordered.map((c, i) => ({
      id: c.id,
      visible: c.visible,
      order: i,
      width: c.width,
    }))
    onChange(next)
  }

  function toggle(id: string) {
    const next = resolved.all.map((c) => ({
      id: c.id,
      visible: c.id === id ? !c.visible : c.visible,
      order: c.order,
      width: c.width,
    }))
    onChange(next)
  }

  function resetToDefaults() {
    const next: ColumnConfigItem[] = DEFAULT_CONTACT_COLUMNS.map((id, i) => ({
      id,
      visible: true,
      order: i,
      width: null,
    }))
    onChange(next)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit columns"
      footer={
        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" size="sm" onClick={resetToDefaults}>
            Reset to defaults
          </Button>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={resolved.all.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="divide-y divide-[var(--color-border)]">
            {resolved.all.map((c) => (
              <SortableColumnRow
                key={c.id}
                id={c.id}
                label={CONTACT_COLUMN_REGISTRY[c.id]?.label ?? c.id}
                visible={c.visible}
                onToggle={() => {
                  toggle(c.id)
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </Drawer>
  )
}

function SortableColumnRow({
  id,
  label,
  visible,
  onToggle,
}: {
  id: string
  label: string
  visible: boolean
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  }
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 py-2">
      <span
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab text-sm text-[var(--color-muted-foreground)]"
      >
        ⋮⋮
      </span>
      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={visible} onChange={onToggle} />
        {label}
      </label>
    </li>
  )
}
