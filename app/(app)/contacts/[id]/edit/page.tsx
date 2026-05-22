import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationMembers } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { listCompaniesForOrg } from "@/modules/companies/queries"
import {
  getContactForOrg,
  listContactCompanyAssociations,
  listContactsForOrg,
} from "@/modules/contacts/queries"
import { listDistinctContactLeadSources } from "@/modules/contacts/filter-spec"
import { listFieldDefinitionsForRecordType } from "@/modules/custom-fields/queries"
import { listHiddenLeadSources } from "@/modules/lead-sources/queries"
import { ContactForm } from "@/modules/contacts/ui/contact-form"

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  const baRole = (member?.role ?? "member") as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const data = await runWithOrgContext(
    { orgId, role: tentativeRole, userId: session.user.id },
    async () => {
      const extended = (await getExtendedMemberRole(session.user.id)) ?? tentativeRole
      return runWithOrgContext({ orgId, role: extended, userId: session.user.id }, async () => {
        const row = await getContactForOrg(id)
        if (!row) return null
        const [associations, customFields, companies, contacts, leadSources, hiddenSources] =
          await Promise.all([
            listContactCompanyAssociations(id),
            listFieldDefinitionsForRecordType("contact"),
            listCompaniesForOrg(),
            listContactsForOrg(),
            listDistinctContactLeadSources(),
            listHiddenLeadSources(),
          ])
        return {
          row,
          associations,
          customFields,
          companies,
          contacts,
          leadSources,
          hiddenLeadSources: hiddenSources,
        }
      })
    },
  )

  if (!data) notFound()

  const owners = (await getOrganizationMembers(orgId))
    .map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Edit contact</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Update any field. The full HubSpot-style inline-editing detail page ships later; this
            form is the V1 way to change contact data.
          </p>
        </div>
        <Link
          href={`/contacts/${id}`}
          className="text-sm text-[var(--color-muted-foreground)] hover:underline"
        >
          ← Back to contact
        </Link>
      </div>
      <ContactForm
        companies={data.companies.map((c) => ({ id: c.id, name: c.name }))}
        referrals={data.contacts
          .filter((c) => c.id !== id)
          .map((c) => ({ id: c.id, firstName: c.firstName, lastName: c.lastName }))}
        owners={owners}
        customFieldDefinitions={data.customFields}
        leadSourceValues={data.leadSources}
        hiddenLeadSources={data.hiddenLeadSources}
        currentUserId={session.user.id}
        initialContact={data.row.contact}
        initialAssociations={data.associations.map(({ association }) => ({
          id: association.id,
          companyId: association.companyId,
          role: association.role,
        }))}
      />
    </div>
  )
}
