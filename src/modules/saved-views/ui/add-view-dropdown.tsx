"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Push 2c — replaces the single "+" button at the end of the tab strip.
 * The button opens a dropdown with two options:
 *
 *   - "Create new view"  → host opens the Save-as flow (name + visibility).
 *   - "Manage views"     → host opens the right-side ManageViewsDrawer.
 *
 * Both actions are owned by the parent (TabStrip) since they both
 * require state the dropdown doesn't have. This component is just the
 * trigger + menu shell.
 */
export function AddViewDropdown({
  onCreateNew,
  onManage,
}: {
  onCreateNew: () => void
  onManage: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Add view"
        className="ml-1 inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-[var(--color-border)] px-2.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
      >
        <span aria-hidden="true">+</span>
        <span>Add view</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onCreateNew}>Create new view</DropdownMenuItem>
        <DropdownMenuItem onSelect={onManage}>Manage views</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
