import { redirect } from "next/navigation"
import { headers } from "next/headers"
import type { ReactNode } from "react"
import { auth } from "@/lib/auth"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getUserOrganizations } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { AppSidebar, resolveSidebarItems } from "@/modules/org/ui/app-sidebar"
import { AppTopbar } from "@/modules/org/ui/app-topbar"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")

  const organizations = await getUserOrganizations(session.user.id)
  let activeOrgId = session.session.activeOrganizationId

  // After sign-out + sign-in, Better Auth doesn't restore the previous active
  // organization. If the user is a member of one, auto-set it so we don't
  // bounce them back to onboarding every login.
  if (!activeOrgId && organizations.length > 0) {
    const first = organizations[0]
    if (first) {
      await auth.api.setActiveOrganization({
        headers: await headers(),
        body: { organizationId: first.id },
      })
      activeOrgId = first.id
    }
  }

  if (!activeOrgId) {
    // No memberships — render shell-less so onboarding owns its UI.
    return <>{children}</>
  }

  // Resolve the role from Better Auth's `member` table first (no RLS — BA
  // tables are excluded by design). Then look up the extended 8-role from
  // member_role for the assignment-scoped RLS overlay. Fall back to the
  // BA→extended mapping if member_role hasn't been seeded for this user
  // (documented Layer 2 fallback in rbac/README.md).
  const memberRow = await getCurrentMember(activeOrgId, session.user.id)
  const baRole = (memberRow?.role ?? "member") as BetterAuthRole
  const tentativeExtended = extendedFromBetterAuth(baRole)

  // First short-lived ALS scope: set context with the tentative extended
  // role so the member_role SELECT below is RLS-allowed (member_role's
  // FOR-SELECT policy is open to any org member; we just need
  // app.current_org set).
  const extendedRole =
    (await runWithOrgContext(
      { orgId: activeOrgId, role: tentativeExtended, userId: session.user.id },
      async () => getExtendedMemberRole(session.user.id),
    )) ?? tentativeExtended

  const activeOrg = organizations.find((o) => o.id === activeOrgId)
  const studioName = activeOrg?.name ?? "Studio"

  // Pre-compute the sidebar items INSIDE a runWithOrgContext scope.
  // hasPermission needs ALS to be active, and in Next.js production RSC
  // the layout's ALS scope does NOT propagate into async child server
  // components — those render outside the layout's frame. So we resolve
  // the permission-gated item list here, fully await it, and pass a
  // plain array to a SYNC sidebar component below.
  const sidebarItems = await runWithOrgContext(
    { orgId: activeOrgId, role: extendedRole, userId: session.user.id },
    async () => resolveSidebarItems(session.user.id, extendedRole),
  )

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[56px_1fr]">
      <AppTopbar
        user={{ name: session.user.name, email: session.user.email }}
        studioName={studioName}
        organizations={organizations.map((o) => ({ id: o.id, name: o.name, slug: o.slug }))}
        activeOrgId={activeOrgId}
        className="col-span-2 border-b border-[var(--color-border)]"
      />
      <AppSidebar items={sidebarItems} className="border-r border-[var(--color-border)]" />
      <main className="overflow-y-auto p-6">{children}</main>
    </div>
  )
}
