import { redirect } from "next/navigation"
import Link from "next/link"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { getLabel } from "@/modules/terminology/queries"
import { DuplicatesTabs } from "@/modules/duplicates/ui/duplicates-tabs"
import { CompanyDuplicatesShell } from "@/modules/duplicates/ui/company-duplicates-shell"

/**
 * Push 4 (B1) — /companies/duplicates. Owner+Admin only. The
 * /companies list page doesn't exist yet (P4.x); this duplicates
 * route is reachable via the entity tab strip on
 * /contacts/duplicates, the Manage duplicates Actions item, or the
 * URL directly.
 */
export default async function CompanyDuplicatesPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  if (!member) redirect("/dashboard")
  const baRole = member.role as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const { extendedRole, contactPlural, companyPlural } = await runWithOrgContext(
    { orgId, role: tentativeRole, userId: session.user.id },
    async () => {
      const resolved = (await getExtendedMemberRole(session.user.id)) ?? tentativeRole
      return runWithOrgContext({ orgId, role: resolved, userId: session.user.id }, async () => {
        const [contactLabel, companyLabel] = await Promise.all([
          getLabel("contact"),
          getLabel("company"),
        ])
        return {
          extendedRole: resolved,
          contactPlural: contactLabel.plural,
          companyPlural: companyLabel.plural,
        }
      })
    },
  )

  if (extendedRole !== "owner" && extendedRole !== "admin") {
    redirect("/dashboard")
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/contacts"
          className="text-xs text-[var(--color-muted-foreground)] hover:underline"
        >
          ← {contactPlural}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Manage duplicates</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Records that may be the same. Review and merge.
        </p>
      </div>
      <DuplicatesTabs contactLabel={contactPlural} companyLabel={companyPlural} active="company" />
      <CompanyDuplicatesShell />
    </div>
  )
}
