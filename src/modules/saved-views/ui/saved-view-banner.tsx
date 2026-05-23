"use client"

import { Button } from "@/components/ui/button"

/**
 * Push 2c — replaces the dirty-dot indicator on tabs. When the active
 * view is dirty (filter or column changes vs. the stored view), this
 * banner renders above the table with a clear "You have unsaved changes"
 * message and the three actions the user can take.
 *
 * Variants:
 *   - Owner of a regular view → [Save] [Save as new view] [Discard]
 *   - System default (All Contacts) or non-owned view → [Save as new view] [Discard]
 *     (Save would target an immutable / un-owned row, which RLS rejects
 *     and the saved-views action layer pre-checks.)
 */
export function SavedViewBanner({
  canOverwrite,
  busy,
  onSave,
  onSaveAs,
  onDiscard,
}: {
  /** True when the active view is owned by the current user AND not a system default. */
  canOverwrite: boolean
  busy: boolean
  onSave: () => void
  onSaveAs: () => void
  onDiscard: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5 px-3 py-2 text-sm">
      <span className="text-[var(--color-foreground)]">You have unsaved changes</span>
      <div className="flex shrink-0 items-center gap-2">
        {canOverwrite && (
          <Button
            size="sm"
            disabled={busy}
            onClick={onSave}
            aria-label="Save changes to the active view"
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onSaveAs}
          disabled={busy}
          aria-label="Save current changes as a new view"
        >
          Save as new view
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDiscard}
          disabled={busy}
          aria-label="Discard unsaved changes and revert to the saved view"
        >
          Discard
        </Button>
      </div>
    </div>
  )
}
