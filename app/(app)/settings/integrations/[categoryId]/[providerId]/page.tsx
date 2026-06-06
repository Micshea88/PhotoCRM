import { notFound, redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { getCategoryById, getProviderById } from "@/modules/integrations/registry"
import type { IntegrationProvider } from "@/modules/integrations/types"
import { ProviderDetail } from "@/modules/integrations/ui/provider-detail"
import { listConnectedProvidersForUser } from "@/modules/telephony/queries"

/**
 * /settings/integrations/[categoryId]/[providerId] — provider wizard.
 *
 * Same guard chain as the parent pages:
 *   session → org → member → owner/admin (redirect otherwise).
 *
 * 404 (notFound) cases:
 *   - Unknown category id.
 *   - Unknown provider id.
 *   - Provider's categoryId does NOT match the route's categoryId
 *     (so /email/ringcentral 404s instead of rendering RingCentral
 *     under the wrong category header).
 *
 * Live connection state is read at PER-USER scope. The wizard is
 * the per-user connect/disconnect surface — RingCentral tokens are
 * issued per user, telephony_connections is keyed by (org, user,
 * provider), and disconnectTelephony filters by ctx.session.user.id.
 * If we used the org-level read here, User B would see "Connected"
 * because User A connected, then Disconnect would NOT_FOUND on
 * User B's own (missing) row. The integrations Connected Apps tab
 * is the org-level roll-up; this page is the per-user grant view.
 *
 * `canManage` is `true` here — the guard above narrowed extendedRole
 * to "owner" | "admin". The constant is passed through so
 * ProviderDetail stays the single source of truth on what's gated.
 */
export default async function IntegrationsProviderPage({
  params,
}: {
  params: Promise<{ categoryId: string; providerId: string }>
}) {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  if (!member) redirect("/dashboard")
  const baRole = member.role as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const extendedRole =
    (await runWithOrgContext({ orgId, role: tentativeRole, userId: session.user.id }, async () =>
      getExtendedMemberRole(session.user.id),
    )) ?? tentativeRole

  if (extendedRole !== "owner" && extendedRole !== "admin") {
    redirect("/dashboard")
  }

  const { categoryId, providerId } = await params
  const category = getCategoryById(categoryId)
  if (!category) notFound()
  const staticProvider = getProviderById(providerId)
  if (!staticProvider) notFound()
  if (staticProvider.categoryId !== category.id) notFound()

  // Per-user scope: matches disconnectTelephony's where-clause.
  const rows = await runWithOrgContext(
    { orgId, role: extendedRole, userId: session.user.id },
    async () => listConnectedProvidersForUser(session.user.id),
  )
  const hasLiveRow = rows.some((r) => r.provider === staticProvider.id)
  // tel: has connectKind "none" and is never written to
  // telephony_connections (upsert.ts only writes "ringcentral"), so
  // hasLiveRow can never be true for tel:. No defensive guard needed.
  const provider: IntegrationProvider = hasLiveRow
    ? { ...staticProvider, connectState: "connected" }
    : staticProvider

  const canManage = true

  return (
    <div className="p-6">
      <ProviderDetail category={category} provider={provider} canManage={canManage} />
    </div>
  )
}
