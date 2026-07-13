"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import type { CustomFieldDefinition } from "../schema"
import { reorderFieldDefinitions } from "../actions"
import { CustomFieldRow } from "./custom-field-row"
import { CustomFieldEditor } from "./custom-field-editor"

/**
 * Drag-to-reorder list for a single record type. Splits into Active +
 * Archived sections; only Active rows are draggable (archived rows
 * retain their order but reordering them is meaningless since they're
 * not surfaced in host forms).
 *
 * Optimistic reorder pattern: we hold an optional `optimisticOrder`
 * patch over the prop. When the user drags, we set the patch
 * immediately. When the server returns success, we clear the patch
 * and router.refresh — the next prop comes in fresh from the server
 * and the displayed order reflects the persisted state. On failure
 * we clear the patch + show the error so the prop wins.
 *
 * Doing the prop-mirror via a `setState` in `useEffect` would trip the
 * react-hooks/set-state-in-effect lint rule, and it would force an
 * extra render every prop change for no gain. The optimistic-patch
 * pattern is the lint-clean equivalent.
 */
export function CustomFieldsList({
  recordType,
  recordTypeLabel,
  initialDefinitions,
  usageById,
}: {
  recordType: string
  recordTypeLabel: string
  initialDefinitions: CustomFieldDefinition[]
  usageById: Record<string, number>
}) {
  const router = useRouter()
  const [optimisticOrder, setOptimisticOrder] = useState<CustomFieldDefinition[] | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorTarget, setEditorTarget] = useState<CustomFieldDefinition | null>(null)
  const [error, setError] = useState<string | null>(null)

  const definitions = optimisticOrder ?? initialDefinitions
  const active = definitions.filter((d) => d.archivedAt === null)
  const archived = definitions.filter((d) => d.archivedAt !== null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function openCreate() {
    setEditorTarget(null)
    setEditorOpen(true)
  }

  function openEdit(def: CustomFieldDefinition) {
    setEditorTarget(def)
    setEditorOpen(true)
  }

  async function handleDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const overId = e.over.id
    const oldIndex = active.findIndex((d) => d.id === e.active.id)
    const newIndex = active.findIndex((d) => d.id === overId)
    if (oldIndex === -1 || newIndex === -1) return

    const reorderedActive = arrayMove(active, oldIndex, newIndex)
    setOptimisticOrder([...reorderedActive, ...archived])
    setError(null)

    const result = await reorderFieldDefinitions({
      recordType,
      orderedIds: reorderedActive.map((d) => d.id),
    })
    if (result.serverError) {
      setError(result.serverError)
      setOptimisticOrder(null)
      return
    }
    setOptimisticOrder(null)
    router.refresh()
  }

  const activeCount = String(active.length)
  const archivedCount = String(archived.length)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {activeCount} active field{active.length === 1 ? "" : "s"}
            {archived.length > 0 && ` · ${archivedCount} archived`}
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus className="mr-1 size-4" />
          Add field
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      )}

      {active.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No custom fields yet for {recordTypeLabel}. Click{" "}
          <span className="font-medium">Add field</span> to create one.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={active.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <div className="rounded-lg border border-[var(--color-border)]">
              {active.map((def) => (
                <CustomFieldRow
                  key={def.id}
                  definition={def}
                  usage={usageById[def.id] ?? 0}
                  onEdit={openEdit}
                  draggable
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {archived.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--color-muted-foreground)]">Archived</h3>
          <div className="rounded-lg border border-[var(--color-border)]">
            {archived.map((def) => (
              <CustomFieldRow
                key={def.id}
                definition={def}
                usage={usageById[def.id] ?? 0}
                onEdit={openEdit}
                draggable={false}
              />
            ))}
          </div>
        </div>
      )}

      <CustomFieldEditor
        open={editorOpen}
        recordType={recordType}
        recordTypeLabel={recordTypeLabel}
        initial={editorTarget}
        onClose={() => {
          setEditorOpen(false)
          setEditorTarget(null)
        }}
        onSaved={() => {
          setEditorOpen(false)
          setEditorTarget(null)
          router.refresh()
        }}
      />
    </div>
  )
}
