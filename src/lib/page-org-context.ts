import "server-only"
import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getUserOrganizations } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { runWithOrgContext, type OrgContext } from "@/lib/org-context"
import { resolveActiveOrg } from "@/lib/resolve-active-org"

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

  // This helper renders INDEPENDENTLY from app/(app)/layout.tsx (RSC layouts
  // and child pages render in separate async stacks), so it must self-protect
  // against a stale/revoked active org exactly as the layout does. Resolve the
  // active org against the authoritative membership list. If the session points
  // at a revoked org but the user still belongs to another, resolveActiveOrg
  // returns that other org (the layout will have persisted setActive); if the
  // user is memberless, it returns null → onboarding.
  //
  // SECURITY: resolveActiveOrg never returns a revoked org, so the stale id can
  // never establish org context here. This is SAFE from the redirect loop
  // because the layout no longer redirects into (app) for memberless users (it
  // renders shell-less) and clears the stale active org, so create-organization
  // renders instead of bouncing back.
  const organizations = await getUserOrganizations(session.user.id)
  const activeOrgId = resolveActiveOrg(session.session.activeOrganizationId, organizations)
  if (!activeOrgId) redirect("/onboarding/create-organization")

  // Resolve the extended role the same way the layout does: read
  // member_role under a tentative ALS scope, fall back to
  // extendedFromBetterAuth if the row is missing (Layer-2 fallback per
  // rbac/README.md).
  //
  // SECURITY: fail CLOSED when the member row is missing. `activeOrgId` is a
  // current membership by construction, so this should always find the row;
  // if it somehow doesn't, redirect to onboarding rather than defaulting the
  // role to "member" (which would grant read access to that org's data —
  // matching the write-path bug orgAction caught, throwing FORBIDDEN when m is
  // null). See: src/lib/safe-action.ts orgAction.
  const memberRow = await getCurrentMember(activeOrgId, session.user.id)
  if (!memberRow) redirect("/onboarding/create-organization")
  const baRole = memberRow.role as BetterAuthRole
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
