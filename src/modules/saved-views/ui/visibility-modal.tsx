"use client"

import { useState } from "react"
import { Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Modal } from "@/components/ui/modal"
import type { Visibility } from "../types"

export interface OrgMember {
  id: string
  name: string | null
  email: string
}

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (visibility: Visibility, sharedWithUserIds: string[] | null) => void
  members: OrgMember[]
  currentUserId: string
  initialVisibility: Visibility
  initialSharedWithUserIds: string[] | null
  submitting?: boolean
}

/**
 * Three-tier visibility modal. Radio buttons for the level + a
 * multi-select org-member picker that shows only when "Specific users"
 * is selected. Submit is enabled when the configuration is coherent
 * (shared_users requires ≥1 selected user; private/org need no extras).
 *
 * Early-return null when closed keeps the body's `useState` fresh on
 * each open (no useEffect-driven reset needed).
 */
export function VisibilityModal(props: Props) {
  if (!props.open) return null
  return <VisibilityModalBody {...props} />
}

function VisibilityModalBody({
  open,
  onClose,
  onSubmit,
  members,
  currentUserId,
  initialVisibility,
  initialSharedWithUserIds,
  submitting = false,
}: Props) {
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility)
  const [selected, setSelected] = useState<string[]>(initialSharedWithUserIds ?? [])

  const eligibleMembers = members.filter((m) => m.id !== currentUserId)
  const canSubmit =
    !submitting && (visibility === "private" || visibility === "org" || selected.length > 0)

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <Modal open={open} onClose={onClose} title="Visibility" className="max-w-lg">
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibility"
              checked={visibility === "private"}
              onChange={() => {
                setVisibility("private")
              }}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium">Private</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                Only you can see this view.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibility"
              checked={visibility === "shared_users"}
              onChange={() => {
                setVisibility("shared_users")
              }}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium">Specific users</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                Pick teammates who can see and use this view.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibility"
              checked={visibility === "org"}
              onChange={() => {
                setVisibility("org")
              }}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium">Everyone in the org</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                All teammates can see and use this view.
              </div>
            </div>
          </label>
        </fieldset>

        {visibility === "shared_users" && (
          <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
            <div className="text-sm font-medium">Share with</div>
            {eligibleMembers.length === 0 ? (
              <EmptyState
                className="px-4 py-6"
                icon={<Users className="size-6" />}
                title="No teammates yet"
                description="Invite people to your org to share views with them."
              />
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {eligibleMembers.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(m.id)}
                      onChange={() => {
                        toggle(m.id)
                      }}
                    />
                    <span>{m.name ?? m.email}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              onSubmit(visibility, visibility === "shared_users" ? selected : null)
            }}
          >
            {submitting ? "Saving…" : "Save visibility"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
