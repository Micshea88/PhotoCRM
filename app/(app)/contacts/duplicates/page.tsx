import { redirect } from "next/navigation"
import Link from "next/link"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { getLabel } from "@/modules/terminology/queries"
import { DuplicatesTabs } from "@/modules/duplicates/ui/duplicates-tabs"
import { ContactDuplicatesShell } from "@/modules/duplicates/ui/contact-duplicates-shell"
import { PageContainer } from "@/modules/shared/ui/page-container"

/**
 * Push 4 (B1) — /contacts/duplicates. Owner+Admin only (matches the
 * /settings/custom-fields pattern). The scan button + result
 * rendering lives in the client shell; this route is a thin RBAC
 * gate + tab strip + terminology resolver.
 */
export default async function ContactDuplicatesPage() {
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
    <PageContainer variant="full" className="space-y-6">
      <div>
        <Link
          href="/contacts"
          className="text-xs text-[var(--color-muted-foreground)] hover:underline"
        >
          ← {contactPlural}
        </Link>
        <h1 className="mt-1 font-serif text-2xl font-semibold">Manage duplicates</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Records that may be the same. Review and merge.
        </p>
      </div>
      <DuplicatesTabs contactLabel={contactPlural} companyLabel={companyPlural} active="contact" />
      <ContactDuplicatesShell />
    </PageContainer>
  )
}
