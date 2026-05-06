import { redirect } from "next/navigation"
import { headers } from "next/headers"
import type { ReactNode } from "react"
import { auth } from "@/lib/auth"
import { getSession } from "@/modules/auth/session"
import { getUserOrganizations } from "@/modules/org/queries"
import { AppSidebar } from "@/modules/org/ui/app-sidebar"
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

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[56px_1fr]">
      <AppTopbar
        user={{ name: session.user.name, email: session.user.email }}
        organizations={organizations.map((o) => ({ id: o.id, name: o.name, slug: o.slug }))}
        activeOrgId={activeOrgId}
        className="col-span-2 border-b border-[var(--color-border)]"
      />
      <AppSidebar className="border-r border-[var(--color-border)]" />
      <main className="overflow-y-auto p-6">{children}</main>
    </div>
  )
}
