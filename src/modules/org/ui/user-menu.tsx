"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Check, LogOut, Plus, User as UserIcon } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Org {
  id: string
  name: string
  slug: string
}

/**
 * Account menu (person icon). Holds identity, settings links, org switching,
 * and create-org — the HubSpot pattern where switching studios lives in the
 * account dropdown, NOT as a standalone header control. The "Switch studio"
 * section only renders when there's more than one org to switch between (the
 * V4 model is one-email-one-org, so most accounts never see it); "New
 * organization" stays available so a user can create a second org.
 */
export function UserMenu({
  userName,
  userEmail,
  organizations,
  activeOrgId,
}: {
  userName: string
  userEmail: string
  organizations: Org[]
  activeOrgId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  async function switchTo(orgId: string) {
    if (orgId === activeOrgId) return
    setBusy(true)
    await authClient.organization.setActive({ organizationId: orgId })
    setBusy(false)
    router.push("/dashboard")
    router.refresh()
  }

  const multiOrg = organizations.length > 1

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="User menu">
          <UserIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>
          <div className="text-sm font-medium text-[var(--color-foreground)]">{userName}</div>
          <div className="text-xs text-[var(--color-muted-foreground)]">{userEmail}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/account">Account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/organization">Organization</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/organization/members">Members</Link>
        </DropdownMenuItem>

        {/* Switch studio — only when there's more than one org to switch to. */}
        {multiOrg && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-[var(--color-muted-foreground)]">
              Switch studio
            </DropdownMenuLabel>
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                disabled={busy}
                onSelect={() => {
                  void switchTo(org.id)
                }}
              >
                {org.name}
                {org.id === activeOrgId && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding/create-organization">
            <Plus className="mr-2 size-4" /> New organization
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut()
          }}
        >
          <LogOut className="mr-2" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
