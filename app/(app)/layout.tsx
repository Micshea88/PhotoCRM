import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { getSession } from "@/modules/auth/session"
import { getUserOrganizations } from "@/modules/org/queries"
import { AppSidebar } from "@/modules/org/ui/app-sidebar"
import { AppTopbar } from "@/modules/org/ui/app-topbar"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")

  const organizations = await getUserOrganizations(session.user.id)
  const activeOrgId = session.session.activeOrganizationId

  // The onboarding page handles its own "no active org" path; the rest of (app)
  // requires one. We check by route: any nested route except /onboarding/* must
  // have an active org.
  // Layouts can't read the pathname server-side, so onboarding pages do their
  // own redirect when an active org IS set, and other pages redirect to onboarding
  // when one is NOT set. The app shell only renders when both auth + active org
  // are present.

  if (!activeOrgId) {
    // Render minimal shell-less layout — onboarding owns its own UI.
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
