"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  EXTENDED_ROLES,
  extendedFromBetterAuth,
  type BetterAuthRole,
  type ExtendedRole,
} from "@/modules/rbac/types"

/**
 * Push 2c.6.5 — pending-invitations list now renders the inviter's
 * intended extended role instead of the BA-mapped 3-role collapse.
 *
 *   - extendedRole present (post-2c.6.4 invites) → render that
 *     value (capitalized; "user" → "Team member" per LOC1).
 *   - extendedRole null (legacy invites; no metadata row) →
 *     fall back to extendedFromBetterAuth(role).
 *
 * Kept in lockstep with members-list.tsx's display rules so the
 * two surfaces use the same role naming.
 */
export interface PendingInvitationRow {
  id: string
  email: string
  /** Better Auth role on the invitation row — always one of owner/admin/member. */
  role: string
  /**
   * Push 2c.6.4 extended-role metadata (Admin/Manager/User/
   * Accountant). Null for legacy invitations created before the
   * invitation_extended_role table existed.
   */
  extendedRole: string | null
}

const ROLE_DISPLAY: Record<ExtendedRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  user: "Team member",
  accountant: "Accountant",
  client: "Client",
}

function isExtendedRole(v: string): v is ExtendedRole {
  return (EXTENDED_ROLES as readonly string[]).includes(v)
}

/**
 * Single source of truth for what label appears next to the email.
 * Centralised so the metadata-vs-legacy branching is in one place
 * — future surfaces (audit log entries, email subject lines, etc.)
 * can call this directly instead of re-deriving the rule.
 */
export function getDisplayRole(inv: PendingInvitationRow): string {
  if (inv.extendedRole && isExtendedRole(inv.extendedRole)) {
    return ROLE_DISPLAY[inv.extendedRole]
  }
  const fallback = extendedFromBetterAuth((inv.role || "member") as BetterAuthRole)
  return ROLE_DISPLAY[fallback]
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
