"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Modal } from "@/components/ui/modal"
import { removeIncompleteSignup } from "@/modules/org/actions"

/**
 * Push 2c.6.10 — admin-only section listing orphaned user signup
 * shells (unverified email, no membership, >24h old). Each row has
 * a Remove button that hard-deletes the user (BA cascade handles
 * session + account).
 *
 * Server-side query (listIncompleteSignups in src/modules/org/queries.ts)
 * already enforces the same constraints; the action body re-verifies
 * defensively. Empty state renders explicit copy so the section
 * doesn't look broken on a healthy org.
 */
export interface IncompleteSignupRow {
  id: string
  email: string
  /** ISO string from server-component .toISOString(). */
  createdAt: string
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))
  if (days >= 1) return `${days.toString()} day${days === 1 ? "" : "s"} ago`
  const hours = Math.floor(diff / (60 * 60 * 1000))
  return `${hours.toString()} hour${hours === 1 ? "" : "s"} ago`
}

export function IncompleteSignups({
  signups,
  canManage,
}: {
  signups: IncompleteSignupRow[]
  canManage: boolean
}) {
  const router = useRouter()
  const [target, setTarget] = useState<IncompleteSignupRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ kind: "ok" | "error"; msg: string } | null>(null)

  async function runRemove() {
    if (!target) return
    setBusyId(target.id)
    setFlash(null)
    const result = await removeIncompleteSignup({ userId: target.id })
    setBusyId(null)
    const removedEmail = target.email
    setTarget(null)
    if (result.serverError) {
      setFlash({ kind: "error", msg: result.serverError })
      return
    }
    if (result.validationErrors) {
      setFlash({ kind: "error", msg: "Invalid request. Refresh and try again." })
      return
    }
    setFlash({ kind: "ok", msg: `Removed orphaned signup for ${removedEmail}.` })
    router.refresh()
  }

  if (!canManage) return null

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Incomplete signups</h2>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Accounts that started signup but never verified their email — older than 24 hours and not
          part of any organization. Removing one frees their email so a fresh invitation can be
          sent.
        </p>
      </div>
      {flash && (
        <Alert variant={flash.kind === "error" ? "destructive" : "default"}>
          <AlertDescription>{flash.msg}</AlertDescription>
        </Alert>
      )}
      {signups.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No incomplete signups to clean up.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {signups.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{s.email}</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Created {formatRelative(s.createdAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === s.id}
                onClick={() => {
                  setTarget(s)
                }}
              >
                {busyId === s.id ? "Removing…" : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {target && (
        <Modal
          open={true}
          onClose={() => {
            setTarget(null)
          }}
          title="Remove incomplete signup?"
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Permanently delete the incomplete account for <strong>{target.email}</strong>? This
              will free their email so a fresh invitation can be sent. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTarget(null)
                }}
                disabled={busyId === target.id}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void runRemove()}
                disabled={busyId === target.id}
              >
                {busyId === target.id ? "Removing…" : "Remove"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
