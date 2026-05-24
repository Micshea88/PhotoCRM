"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Modal } from "@/components/ui/modal"
import { cancelOrgInvitation, resendOrgInvitation, resetOrgInvitation } from "@/modules/org/actions"
import { getRoleDisplay } from "@/modules/rbac/display"
import {
  EXTENDED_ROLES,
  extendedFromBetterAuth,
  type BetterAuthRole,
  type ExtendedRole,
} from "@/modules/rbac/types"

/**
 * Push 2c.6.10 — pending invitations list gains Cancel / Resend /
 * Reset actions per row. Admin/owner only; non-admin viewers see
 * the email + role label but no buttons.
 *
 * Each destructive action runs through a confirmation modal +
 * server action. Success surfaces as an inline Alert (no toast
 * library in the codebase yet — see Push 2c.6.10 audit findings)
 * and triggers router.refresh() to re-pull the list.
 */
export interface PendingInvitationRow {
  id: string
  email: string
  /** Better Auth role on the invitation row — owner/admin/member. */
  role: string
  /** Extended-role metadata (Push 2c.6.4). Null for legacy invites. */
  extendedRole: string | null
}

function isExtendedRole(v: string): v is ExtendedRole {
  return (EXTENDED_ROLES as readonly string[]).includes(v)
}

export function getDisplayRole(inv: PendingInvitationRow): string {
  if (inv.extendedRole && isExtendedRole(inv.extendedRole)) {
    return getRoleDisplay(inv.extendedRole)
  }
  const fallback = extendedFromBetterAuth((inv.role || "member") as BetterAuthRole)
  return getRoleDisplay(fallback)
}

type ActionKind = "cancel" | "resend" | "reset"

interface ConfirmState {
  kind: ActionKind
  invitationId: string
  email: string
}

export function PendingInvitations({
  invitations,
  canManage,
}: {
  invitations: PendingInvitationRow[]
  /** True when the viewer is owner/admin and the buttons should render. */
  canManage: boolean
}) {
  const router = useRouter()
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ kind: "ok" | "error"; msg: string } | null>(null)

  async function runAction() {
    if (!confirm) return
    setBusyId(confirm.invitationId)
    setFlash(null)
    const { kind, invitationId, email } = confirm
    const result =
      kind === "cancel"
        ? await cancelOrgInvitation({ invitationId })
        : kind === "resend"
          ? await resendOrgInvitation({ invitationId })
          : await resetOrgInvitation({ invitationId })
    setBusyId(null)
    setConfirm(null)
    if (result.serverError) {
      setFlash({ kind: "error", msg: result.serverError })
      return
    }
    if (result.validationErrors) {
      setFlash({ kind: "error", msg: "Invalid request. Refresh and try again." })
      return
    }
    setFlash({
      kind: "ok",
      msg:
        kind === "cancel"
          ? `Canceled invitation for ${email}.`
          : kind === "resend"
            ? `Resent invitation to ${email}.`
            : `Reset complete — fresh invitation sent to ${email}.`,
    })
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {flash && (
        <Alert variant={flash.kind === "error" ? "destructive" : "default"}>
          <AlertDescription>{flash.msg}</AlertDescription>
        </Alert>
      )}
      <ul className="divide-y divide-[var(--color-border)]">
        {invitations.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">{inv.email}</p>
              <p className="text-xs text-[var(--color-muted-foreground)]">{getDisplayRole(inv)}</p>
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === inv.id}
                  onClick={() => {
                    setConfirm({ kind: "resend", invitationId: inv.id, email: inv.email })
                  }}
                >
                  Resend
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === inv.id}
                  onClick={() => {
                    setConfirm({ kind: "reset", invitationId: inv.id, email: inv.email })
                  }}
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === inv.id}
                  onClick={() => {
                    setConfirm({ kind: "cancel", invitationId: inv.id, email: inv.email })
                  }}
                >
                  {busyId === inv.id ? "Working…" : "Cancel"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {confirm && (
        <ConfirmActionModal
          state={confirm}
          submitting={busyId === confirm.invitationId}
          onCancel={() => {
            setConfirm(null)
          }}
          onConfirm={() => void runAction()}
        />
      )}
    </div>
  )
}

function ConfirmActionModal({
  state,
  submitting,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleByKind: Record<ActionKind, string> = {
    cancel: "Cancel invitation?",
    resend: "Resend invitation?",
    reset: "Reset invitation?",
  }
  const bodyByKind: Record<ActionKind, string> = {
    cancel: `Cancel invitation to ${state.email}? They will no longer be able to use the invitation link. This action cannot be undone.`,
    resend: `Resend the invitation email to ${state.email}? Uses the same invitation link as the original — no new token is generated.`,
    reset: `Reset invitation for ${state.email}? This cancels the current invitation, removes any incomplete signup at this email, and sends a fresh invitation with the same role.`,
  }
  const confirmLabel: Record<ActionKind, string> = {
    cancel: submitting ? "Canceling…" : "Cancel invitation",
    resend: submitting ? "Sending…" : "Resend",
    reset: submitting ? "Resetting…" : "Reset",
  }
  return (
    <Modal open={true} onClose={onCancel} title={titleByKind[state.kind]}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">{bodyByKind[state.kind]}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Back
          </Button>
          <Button
            type="button"
            variant={state.kind === "cancel" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={submitting}
          >
            {confirmLabel[state.kind]}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
