import { redirect } from "next/navigation"
import { headers } from "next/headers"
import type { ReactNode } from "react"
import { auth } from "@/lib/auth"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getUserOrganizations } from "@/modules/org/queries"
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

  // Resolve the role from Better Auth's `member` table (no RLS — Better Auth
  // tables are excluded by design). The role is needed both for client-side
  // permission gating and as the value pushed into app.current_role on every
  // RSC read/transactional write below this layout.
  const memberRow = await getCurrentMember(activeOrgId, session.user.id)
  const role = (memberRow?.role ?? "member") as "owner" | "admin" | "member"

  // Establish the per-request org context. RSC descendants of this layout
  // that call withOrgContext (in their module's queries.ts) will see this
  // org/role and run their reads with the RLS settings applied.
  //
  // The inner function is intentionally async with no explicit await: the
  // Promise it returns keeps the AsyncLocalStorage scope alive across React's
  // RSC render chain. A sync function would have its ALS frame popped before
  // React renders the children below.
  //
  // eslint-disable-next-line @typescript-eslint/require-await
  return runWithOrgContext({ orgId: activeOrgId, role }, async () => (
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
  ))
}
