"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { setMemberExtendedRole } from "@/modules/rbac/actions"
import { getRoleDisplay } from "@/modules/rbac/display"
import { EXTENDED_ROLES, type ExtendedRole } from "@/modules/rbac/types"
import { MemberRecoveryMenu } from "@/modules/org/ui/member-recovery-menu"

interface Member {
  id: string
  /** Better Auth member.role — one of owner/admin/member. */
  role: string
  /** Push 2c.5 — app-level extended role (6 values) from memberRole. */
  extendedRole: ExtendedRole
  user: { id: string; name: string; email: string }
}

/**
 * Push 2c.5 — picker exposes all 6 extended roles per the locked
 * RBAC spec (owner / admin / manager / user / accountant / client).
 * The select changes the EXTENDED role (memberRole table); the BA
 * `member.role` column stays as-is, since BA only knows 3 roles and
 * the app's permission gate reads from memberRole anyway. Permission
 * enforcement at the BA layer continues to map owner→owner,
 * admin→admin, everything else→"member" per extendedToBetterAuth.
 */
export function MembersList({
  members,
  currentUserId,
  currentUserRole,
}: {
  members: Member[]
  currentUserId: string
  currentUserRole: string
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const canManage = currentUserRole === "owner" || currentUserRole === "admin"

  async function changeRole(memberId: string, role: ExtendedRole) {
    setBusyId(memberId)
    const result = await setMemberExtendedRole({ memberId, role })
    setBusyId(null)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    router.refresh()
  }

  async function remove(memberId: string) {
    setBusyId(memberId)
    await authClient.organization.removeMember({ memberIdOrEmail: memberId })
    setBusyId(null)
    router.refresh()
  }

  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {members.map((m) => (
        <li key={m.id} className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium">{m.user.name}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">{m.user.email}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[var(--color-muted-foreground)]">
              {getRoleDisplay(m.extendedRole)}
            </span>
            {canManage && m.user.id !== currentUserId && m.extendedRole !== "owner" && (
              <>
                <select
                  aria-label={`Role for ${m.user.name}`}
                  value={m.extendedRole}
                  onChange={(e) => {
                    void changeRole(m.id, e.target.value as ExtendedRole)
                  }}
                  disabled={busyId === m.id}
                  className="h-8 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-xs"
                >
                  {/*
                   * Push 2c.5.1 — "client" is reserved for the future
                   * client-portal V2 work (external users invited
                   * against a contact record, not org members). Keep
                   * it in EXTENDED_ROLES (existing member_role rows
                   * with role="client" stay valid for forward compat)
                   * but hide it from this internal-team picker. The
                   * 5 internal roles are Owner / Admin / Manager /
                   * User / Accountant.
                   */}
                  {EXTENDED_ROLES.filter((r) => r !== "client").map((r) => (
                    <option key={r} value={r}>
                      {/*
                       * Push 2c.6.6 — display labels centralised in
                       * src/modules/rbac/display.ts. "user" renders
                       * as "Team member" (LOC1).
                       */}
                      {getRoleDisplay(r)}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === m.id}
                  onClick={() => void remove(m.id)}
                >
                  Remove
                </Button>
                <MemberRecoveryMenu memberId={m.id} memberName={m.user.name} />
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
