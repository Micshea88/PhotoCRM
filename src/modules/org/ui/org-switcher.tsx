"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronDown, Plus } from "lucide-react"
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

export function OrgSwitcher({
  organizations,
  activeOrgId,
}: {
  organizations: Org[]
  activeOrgId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const active = organizations.find((o) => o.id === activeOrgId)

  async function switchTo(orgId: string) {
    if (orgId === activeOrgId) return
    setBusy(true)
    await authClient.organization.setActive({ organizationId: orgId })
    setBusy(false)
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {active?.name ?? "Select org"}
          <ChevronDown className="ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onSelect={() => {
              void switchTo(org.id)
            }}
          >
            {org.name}
            {org.id === activeOrgId && (
              <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">active</span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding/create-organization">
            <Plus className="mr-2" /> New organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
