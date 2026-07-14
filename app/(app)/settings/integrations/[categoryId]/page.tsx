import { notFound, redirect } from "next/navigation"
import { runWithOrgContext, withOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { getCategoryById } from "@/modules/integrations/registry"
import { CategoryDetail } from "@/modules/integrations/ui/category-detail"
import { getLiveConnectionForUser } from "@/modules/email-connections/queries"
import { EmailProviderPicker } from "@/modules/email-connections/ui/email-provider-picker"
import { PageContainer } from "@/modules/shared/ui/page-container"

/**
 * /settings/integrations/[categoryId] — one category and its providers.
 *
 * Reachable by ALL members (Item 2) so every photographer can connect their own
 * email. Per-user email connect/disconnect is available to everyone; shared
 * org-level actions (RingCentral connect/disconnect + call-sync) stay gated to
 * owner/admin inside the provider wizard via `canManage`.
 *
 * The Email category renders the connect PICKER (featured + Other icons +
 * generic catch-all) instead of the generic provider-card grid.
 * Unknown categoryId → 404.
 */

/** Plain-English banner for a connect round-trip result. */
function statusMessage(error: string | undefined): string | null {
  switch (error) {
    case "denied":
      return "We couldn't connect that email provider. It may not be set up yet — contact your studio admin, or try another provider."
    case "not_configured":
      return "Email connection isn't configured for this workspace yet."
    case "state":
      return "That connection attempt expired. Please try again."
    case "exchange_failed":
      return "Something went wrong finishing the connection. Please try again."
    case "session":
      return "Please sign in again to connect your email."
    default:
      return null
  }
}

export default async function IntegrationsCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ categoryId: string }>
  searchParams: Promise<{ error?: string; connected?: string }>
}) {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  if (!member) redirect("/dashboard")
  const tentativeRole = extendedFromBetterAuth(member.role as BetterAuthRole)

  const { categoryId } = await params
  const category = getCategoryById(categoryId)
  if (!category) notFound()

  if (category.id === "email") {
    const { error } = await searchParams
    const extendedRole =
      (await runWithOrgContext({ orgId, role: tentativeRole, userId: session.user.id }, async () =>
        getExtendedMemberRole(session.user.id),
      )) ?? tentativeRole
    const conn = await runWithOrgContext(
      { orgId, role: extendedRole, userId: session.user.id },
      async () => withOrgContext((tx) => getLiveConnectionForUser(tx, orgId, session.user.id)),
    )
    return (
      <PageContainer variant="default" className="space-y-6">
        <div>
          <h1 className="font-serif text-xl font-semibold">Email</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
            Connect your own mailbox so client email sends from you and replies log to the right
            contact automatically.
          </p>
        </div>
        <EmailProviderPicker
          connectedEmail={conn?.email ?? null}
          statusError={statusMessage(error)}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer variant="default">
      <CategoryDetail category={category} />
    </PageContainer>
  )
}
