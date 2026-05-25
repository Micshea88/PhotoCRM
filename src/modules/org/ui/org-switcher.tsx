"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronDown, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { setActiveOrgAndPersist } from "@/modules/auth/ui/persist-active-org"

interface Org {
  id: string
  name: string
  slug: string
}

/**
 * Push 2c.6.11 — invite-flow + multi-org rewrite.
 *
 *   - ZERO orgs: render nothing. The user is in onboarding (no
 *     active org). Topbar covers the "no studio yet" state via
 *     its own studioName fallback.
 *   - ONE org: render the org name as plain text. No dropdown
 *     chrome — there's nothing to switch to and the chevron
 *     would imply otherwise.
 *   - MULTI orgs: dropdown showing active org with chevron.
 *     Click another org → setActiveOrgAndPersist + router.refresh
 *     so all org-scoped data re-fetches against the new GUC.
 *
 * Click-to-switch goes through setActiveOrgAndPersist, which
 * updates BA's session cookie AND persists
 * user.last_active_organization_id so the next sign-in restores
 * the same active org.
 */
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

  if (organizations.length === 0) return null

  if (organizations.length === 1) {
    // Single-org: plain text. The studio name lives in the topbar
    // already (passed as studioName prop). Returning null here so
    // the topbar's text is the only display and we don't get a
    // duplicate render. The "New organization" affordance still
    // exists via the dropdown when the user has a second org.
    return null
  }

  async function switchTo(orgId: string) {
    if (orgId === activeOrgId) return
    setBusy(true)
    await setActiveOrgAndPersist(orgId)
    setBusy(false)
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {active?.name ?? "Select organization"}
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
