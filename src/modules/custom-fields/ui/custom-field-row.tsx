"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import type { CustomFieldDefinition } from "../schema"
import { archiveFieldDefinition, unarchiveFieldDefinition, deleteFieldDefinition } from "../actions"

/**
 * One draggable row in the custom-fields list. Owns its own dnd-kit
 * sortable wiring (drag handle on the grip icon) and a per-row kebab
 * menu with Edit / Archive (or Unarchive) / Delete.
 *
 * Parent passes `onEdit` to open the editor modal in edit mode. Archive,
 * unarchive, and delete call server actions directly and refresh on
 * success.
 */
export function CustomFieldRow({
  definition,
  usage,
  onEdit,
  draggable,
}: {
  definition: CustomFieldDefinition
  usage: number
  onEdit: (def: CustomFieldDefinition) => void
  draggable: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: definition.id,
    disabled: !draggable,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const isArchived = definition.archivedAt !== null

  async function handleArchive() {
    setBusy(true)
    setError(null)
    const result = isArchived
      ? await unarchiveFieldDefinition({ id: definition.id })
      : await archiveFieldDefinition({ id: definition.id })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    router.refresh()
  }

  async function handleDelete() {
    setBusy(true)
    setError(null)
    const result = await deleteFieldDefinition({ id: definition.id })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    setConfirmDelete(false)
    router.refresh()
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm last:border-b-0",
          isDragging && "opacity-50",
          isArchived && "opacity-70",
        )}
      >
        <button
          type="button"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
          className={cn(
            "text-[var(--color-muted-foreground)]",
            draggable
              ? "cursor-grab hover:text-[var(--color-foreground)]"
              : "cursor-not-allowed opacity-40",
          )}
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {definition.name}
            {definition.required && <span className="ml-2 text-[var(--color-destructive)]">*</span>}
            {isArchived && (
              <span className="ml-2 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs font-normal text-[var(--color-muted-foreground)]">
                Archived
              </span>
            )}
          </p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {fieldTypeLabel(definition.fieldType)}
            {" · "}Position {definition.order + 1}
            {" · "}Used by {usage} record{usage === 1 ? "" : "s"}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={`Actions for ${definition.name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                onEdit(definition)
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void handleArchive()
              }}
            >
              {isArchived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setConfirmDelete(true)
              }}
              className="text-[var(--color-destructive)] focus:text-[var(--color-destructive)]"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && <p className="px-3 py-1 text-xs text-[var(--color-destructive)]">{error}</p>}
      <DeleteConfirmModal
        open={confirmDelete}
        onClose={() => {
          if (!busy) setConfirmDelete(false)
        }}
        onConfirm={() => {
          void handleDelete()
        }}
        title="Delete this custom field?"
        body={`This will remove "${definition.name}" from the list and from any new records. Existing records keep their stored values for this field until the deletion is permanently purged.`}
        submitting={busy}
      />
    </>
  )
}

function fieldTypeLabel(t: string): string {
  return t
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
}
