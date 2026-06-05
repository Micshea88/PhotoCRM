import { notFound, redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { getCategoryById, getProviderById } from "@/modules/integrations/registry"
import { ProviderDetail } from "@/modules/integrations/ui/provider-detail"

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
 * `canManage` is passed to ProviderDetail. With the current guard
 * redirecting non-owner/admin, it's always true here — but the
 * component is the single source of truth on what's gated, so the
 * route forwards the computed value rather than hard-coding it.
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
  const provider = getProviderById(providerId)
  if (!provider) notFound()
  if (provider.categoryId !== category.id) notFound()

  // After the guard above, extendedRole is narrowed to "owner" | "admin".
  // The constant is passed through so ProviderDetail stays the single
  // source of truth on what's gated — if the route ever loosens, this
  // flag becomes the load-bearing one.
  const canManage = true

  return (
    <div className="p-6">
      <ProviderDetail category={category} provider={provider} canManage={canManage} />
    </div>
  )
}
