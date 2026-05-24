"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { getRoleDisplay } from "@/modules/rbac/display"
import {
  EXTENDED_ROLES,
  extendedFromBetterAuth,
  type BetterAuthRole,
  type ExtendedRole,
} from "@/modules/rbac/types"

/**
 * Push 2c.6.5 — pending-invitations list renders the inviter's
 * intended extended role instead of the BA-mapped 3-role collapse.
 * Push 2c.6.6 — display labels now come from the central
 * ROLE_DISPLAY map (src/modules/rbac/display.ts) instead of a
 * local copy, so every role-rendering surface stays in lockstep.
 *
 *   - extendedRole present (post-2c.6.4 invites) → render that
 *     value via getRoleDisplay (which maps "user" → "Team member").
 *   - extendedRole null (legacy invites; no metadata row) →
 *     fall back to extendedFromBetterAuth(role), then display.
 */
export interface PendingInvitationRow {
  id: string
  email: string
  /** Better Auth role on the invitation row — always one of owner/admin/member. */
  role: string
  /**
   * Push 2c.6.4 extended-role metadata (admin/manager/user/
   * accountant). Null for legacy invitations created before the
   * invitation_extended_role table existed.
   */
  extendedRole: string | null
}

function isExtendedRole(v: string): v is ExtendedRole {
  return (EXTENDED_ROLES as readonly string[]).includes(v)
}

/**
 * Centralised metadata-vs-legacy branching for the pending-list
 * label. Future surfaces (audit log entries, email subject lines)
 * can call this if they need the SAME fallback logic; for
 * already-resolved ExtendedRole values use getRoleDisplay() from
 * @/modules/rbac/display directly.
 */
export function getDisplayRole(inv: PendingInvitationRow): string {
  if (inv.extendedRole && isExtendedRole(inv.extendedRole)) {
    return getRoleDisplay(inv.extendedRole)
  }
  const fallback = extendedFromBetterAuth((inv.role || "member") as BetterAuthRole)
  return getRoleDisplay(fallback)
}

export function PendingInvitations({ invitations }: { invitations: PendingInvitationRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function cancel(id: string) {
    setBusyId(id)
    await authClient.organization.cancelInvitation({ invitationId: id })
    setBusyId(null)
    router.refresh()
  }

  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {invitations.map((inv) => (
        <li key={inv.id} className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium">{inv.email}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">{getDisplayRole(inv)}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busyId === inv.id}
            onClick={() => void cancel(inv.id)}
          >
            {busyId === inv.id ? "Cancelling…" : "Cancel"}
          </Button>
        </li>
      ))}
    </ul>
  )
}
