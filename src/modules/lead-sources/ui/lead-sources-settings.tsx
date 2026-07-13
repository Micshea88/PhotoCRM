"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import { LEAD_SOURCE_DEFAULTS } from "@/modules/lead-sources/types"
import { deleteLeadSourceValue, hideLeadSource, showLeadSource } from "../actions"

interface CustomRow {
  sourceName: string
  count: number
  hidden: boolean
}

/**
 * /settings/lead-sources interactive surface.
 *
 *   - "Standard sources" — the 8 seeded defaults. Toggle hides/reveals
 *     each one for this org. Hidden sources stop appearing in the
 *     contact form, the edit form, and the filter chip.
 *
 *   - "Custom sources" — values currently in use on real contacts
 *     that aren't in the seeded list. Two affordances per row:
 *       - Hide / Show: SOFT — existing contacts keep the value, only
 *         the dropdown filters it out
 *       - Delete: DESTRUCTIVE — clears `lead_source = NULL` on every
 *         contact in the org carrying this value AND removes any hide
 *         override. Typed-confirm modal gates this; once executed,
 *         the value is no longer represented anywhere.
 */
export function LeadSourcesSettings({
  initialHidden,
  initialCustom,
}: {
  initialHidden: string[]
  initialCustom: CustomRow[]
}) {
  const router = useRouter()
  const [hidden, setHidden] = useState<Set<string>>(
    new Set(initialHidden.map((s) => s.toLowerCase())),
  )
  const [busyName, setBusyName] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CustomRow | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggleSource(sourceName: string, currentlyHidden: boolean) {
    setBusyName(sourceName)
    setError(null)
    const result = currentlyHidden
      ? await showLeadSource({ sourceName })
      : await hideLeadSource({ sourceName })
    setBusyName(null)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    setHidden((prev) => {
      const next = new Set(prev)
      if (currentlyHidden) next.delete(sourceName.toLowerCase())
      else next.add(sourceName.toLowerCase())
      return next
    })
    router.refresh()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setBusyDelete(true)
    setError(null)
    const result = await deleteLeadSourceValue({ sourceName: deleteTarget.sourceName })
    setBusyDelete(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    setDeleteTarget(null)
    router.refresh()
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Standard sources</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          The seeded list shown in the Lead source dropdown for everyone in your studio. Hidden
          sources disappear from the dropdown without affecting existing contacts.
        </p>
        <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {LEAD_SOURCE_DEFAULTS.map((name) => {
            const isHidden = hidden.has(name.toLowerCase())
            return (
              <div key={name} className="flex items-center justify-between gap-4 p-3 text-sm">
                <div>
                  <span className="font-medium">{name}</span>
                  {isHidden && (
                    <span className="ml-2 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">
                      Hidden
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyName === name}
                  onClick={() => {
                    void toggleSource(name, isHidden)
                  }}
                >
                  {busyName === name ? "…" : isHidden ? "Show" : "Hide"}
                </Button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Custom sources</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Values your team has typed into a contact&apos;s Lead source field. Hide to remove from
          the dropdown without touching existing contacts. Delete to permanently clear the value
          from every contact using it.
        </p>
        {initialCustom.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
            No custom sources yet. They appear here when someone enters a value not on the standard
            list.
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {initialCustom.map((row) => {
              const isHidden = hidden.has(row.sourceName.toLowerCase())
              return (
                <div
                  key={row.sourceName}
                  className="flex items-center justify-between gap-4 p-3 text-sm"
                >
                  <div>
                    <span className="font-medium">{row.sourceName}</span>
                    <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">
                      Used by {row.count} contact{row.count === 1 ? "" : "s"}
                    </span>
                    {isHidden && (
                      <span className="ml-2 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">
                        Hidden
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyName === row.sourceName}
                      onClick={() => {
                        void toggleSource(row.sourceName, isHidden)
                      }}
                    >
                      {busyName === row.sourceName ? "…" : isHidden ? "Show" : "Hide"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setDeleteTarget(row)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <DeleteConfirmModal
        open={!!deleteTarget}
        onClose={() => {
          if (!busyDelete) setDeleteTarget(null)
        }}
        onConfirm={() => {
          void confirmDelete()
        }}
        title="Delete this lead source?"
        body={
          deleteTarget
            ? `This will permanently remove "${deleteTarget.sourceName}" from ${String(
                deleteTarget.count,
              )} contact${deleteTarget.count === 1 ? "" : "s"}. Affected contacts will have their Lead source field cleared. This cannot be undone.`
            : ""
        }
        submitting={busyDelete}
      />
    </div>
  )
}
