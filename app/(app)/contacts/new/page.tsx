import { redirect } from "next/navigation"
import Link from "next/link"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationMembers } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { listCompaniesForOrg } from "@/modules/companies/queries"
import { listContactsForOrg } from "@/modules/contacts/queries"
import {
  listDistinctContactLeadSources,
  listDistinctContactTags,
} from "@/modules/contacts/filter-spec"
import { listActiveFieldDefinitionsForRecordType } from "@/modules/custom-fields/queries"
import { listHiddenLeadSources } from "@/modules/lead-sources/queries"
import { ContactForm } from "@/modules/contacts/ui/contact-form"

export default async function NewContactPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  const baRole = (member?.role ?? "member") as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const { companies, contacts, customFields, leadSources, hiddenLeadSources, tagOptions } =
    await runWithOrgContext({ orgId, role: tentativeRole, userId: session.user.id }, async () => {
      const extended = (await getExtendedMemberRole(session.user.id)) ?? tentativeRole
      // Re-enter to set the final role for the data fetches.
      return runWithOrgContext({ orgId, role: extended, userId: session.user.id }, async () => {
        const [
          companiesRows,
          contactRows,
          customFieldRows,
          leadSourceRows,
          hiddenSources,
          distinctTags,
        ] = await Promise.all([
          listCompaniesForOrg(),
          listContactsForOrg(),
          listActiveFieldDefinitionsForRecordType("contact"),
          listDistinctContactLeadSources(),
          listHiddenLeadSources(),
          listDistinctContactTags(),
        ])
        return {
          companies: companiesRows.map((c) => ({ id: c.id, name: c.name })),
          contacts: contactRows.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            primaryEmail: c.primaryEmail,
          })),
          customFields: customFieldRows,
          leadSources: leadSourceRows,
          hiddenLeadSources: hiddenSources,
          tagOptions: distinctTags,
        }
      })
    })

  const owners = (await getOrganizationMembers(orgId))
    .map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">New contact</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Person record. Permanent details that don&apos;t change between projects.
          </p>
        </div>
        <Link
          href="/contacts"
          className="text-sm text-[var(--color-muted-foreground)] hover:underline"
        >
          ← Back to contacts
        </Link>
      </div>
      <ContactForm
        companies={companies}
        referrals={contacts}
        owners={owners}
        customFieldDefinitions={customFields}
        leadSourceValues={leadSources}
        hiddenLeadSources={hiddenLeadSources}
        tagOptions={tagOptions}
        currentUserId={session.user.id}
      />
    </div>
  )
}
