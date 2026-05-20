import "server-only"
import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { runWithOrgContext, type OrgContext } from "@/lib/org-context"

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>

/**
 * Set up `runWithOrgContext` for a server-rendered page that needs to call
 * `queries.ts` functions.
 *
 * Why this exists: in Next.js production builds, RSC layouts and child
 * pages render independently. The `runWithOrgContext` call in
 * `app/(app)/layout.tsx` only wraps the layout's own JSX (its topbar +
 * sidebar). The page's render happens in a separate async stack, so the
 * layout's AsyncLocalStorage scope is not visible to the page's queries
 * — `withOrgContext()` throws "no org context in scope."
 *
 * Each authenticated page that needs RLS-scoped reads must establish its
 * own org context. This helper duplicates the layout's session + role
 * resolution and wraps the page's body in `runWithOrgContext`. Redirects
 * to `/sign-in` or `/onboarding/create-organization` as the layout would.
 *
 * Usage:
 *
 *   export default async function MyPage() {
 *     return withPageOrgContext(async (ctx, session) => {
 *       const rows = await listSomething()   // queries.ts using withOrgContext
 *       return <div>...</div>
 *     })
 *   }
 *
 * Trade-off: this does duplicate the layout's auth lookups (session,
 * member row, extended-role lookup). A cleaner long-term refactor would
 * either (a) thread `OrgContext` through props from layout to page via a
 * Server Component pattern, or (b) change `queries.ts` to accept explicit
 * `(orgId, role, userId)` args and stop relying on AsyncLocalStorage at
 * the request boundary. Both are larger changes; this helper unblocks the
 * dashboard now.
 */
export async function withPageOrgContext<T>(
  fn: (ctx: OrgContext, session: Session) => Promise<T>,
): Promise<T> {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) redirect("/onboarding/create-organization")

  // Resolve the extended role the same way the layout does: read
  // member_role under a tentative ALS scope, fall back to
  // extendedFromBetterAuth if the row is missing (Layer-2 fallback per
  // rbac/README.md).
  const memberRow = await getCurrentMember(activeOrgId, session.user.id)
  const baRole = (memberRow?.role ?? "member") as BetterAuthRole
  const tentativeExtended = extendedFromBetterAuth(baRole)
  const extendedRole =
    (await runWithOrgContext(
      { orgId: activeOrgId, role: tentativeExtended, userId: session.user.id },
      async () => getExtendedMemberRole(session.user.id),
    )) ?? tentativeExtended

  const ctx: OrgContext = {
    orgId: activeOrgId,
    role: extendedRole,
    userId: session.user.id,
  }
  return runWithOrgContext(ctx, async () => fn(ctx, session))
}
