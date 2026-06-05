import { notFound, redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { getCategoryById } from "@/modules/integrations/registry"
import { CategoryDetail } from "@/modules/integrations/ui/category-detail"

/**
 * /settings/integrations/[categoryId] — one category and its providers.
 *
 * Same guard chain as /settings/integrations:
 *   session → org → member → owner/admin (redirect otherwise).
 * Unknown categoryId → 404 (notFound).
 */
export default async function IntegrationsCategoryPage({
  params,
}: {
  params: Promise<{ categoryId: string }>
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

  const { categoryId } = await params
  const category = getCategoryById(categoryId)
  if (!category) notFound()

  return (
    <div className="p-6">
      <CategoryDetail category={category} />
    </div>
  )
}
