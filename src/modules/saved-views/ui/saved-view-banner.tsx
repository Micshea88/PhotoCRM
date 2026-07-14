"use client"

import { Button } from "@/components/ui/button"
import { StickySaveBar } from "@/components/ui/sticky-save-bar"

/**
 * Saved-view dirty state. When the active view is dirty (filter or column
 * changes vs. the stored view) this renders the shared bottom-sticky
 * <StickySaveBar> — NOT a panel card (the old panel card clipped its own
 * buttons inside the narrow saved-views rail). The bar spans the content area
 * and never truncates its actions.
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
    <StickySaveBar
      status="You have unsaved changes"
      actions={
        <>
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
        </>
      }
    />
  )
}
