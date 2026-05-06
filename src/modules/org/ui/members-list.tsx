"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

interface Member {
  id: string
  role: string
  user: { id: string; name: string; email: string }
}

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

  async function changeRole(memberId: string, role: "admin" | "member") {
    setBusyId(memberId)
    await authClient.organization.updateMemberRole({ memberId, role })
    setBusyId(null)
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
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--color-muted-foreground)]">{m.role}</span>
            {canManage && m.user.id !== currentUserId && m.role !== "owner" && (
              <>
                <select
                  value={m.role}
                  onChange={(e) => {
                    void changeRole(m.id, e.target.value as "admin" | "member")
                  }}
                  disabled={busyId === m.id}
                  className="h-8 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-xs"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === m.id}
                  onClick={() => void remove(m.id)}
                >
                  Remove
                </Button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
