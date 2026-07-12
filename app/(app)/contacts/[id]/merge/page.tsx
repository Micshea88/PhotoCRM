import { notFound, redirect } from "next/navigation"
import { runWithOrgContext, withOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationMembers } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { listContactsForOrg } from "@/modules/contacts/queries"
import { listCompaniesForOrg } from "@/modules/companies/queries"
import {
  listDistinctContactTags,
  listDistinctContactLeadSources,
} from "@/modules/contacts/filter-spec"
import { listHiddenLeadSources } from "@/modules/lead-sources/queries"
import { listFieldDefinitionsForRecordType } from "@/modules/custom-fields/queries"
import { fetchContactDisplayRows } from "@/modules/duplicates/queries"
import { ContactMergeSideBySide } from "@/modules/contacts/ui/contact-merge-side-by-side"
import { PageContainer } from "@/modules/shared/ui/page-container"

/**
 * Push 3 (C7) — manual pairwise merge route.
 *
 * URL: /contacts/[id]/merge?with=[otherId]
 *
 * Server-loads both contacts + the supporting metadata the inline-
 * edit primitives need (company list / member list / referral list /
 * lead-source list / tag list / active custom field defs), then
 * hands off to the client `ContactMergeSideBySide` shell.
 *
 * RBAC: gated on the `mergeContacts` action's Owner/Admin
 * requirement. Non-admins land here are bounced back to the contact.
 */
export default async function ContactMergePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ with?: string }>
}) {
  const { id: thisId } = await params
  const { with: withId } = await searchParams
  if (!withId || withId === thisId) {
    redirect(`/contacts/${thisId}`)
  }

  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  if (!member) redirect("/dashboard")
  const baRole = member.role as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const loaded = await runWithOrgContext(
    { orgId, role: tentativeRole, userId: session.user.id },
    async () => {
      const role = (await getExtendedMemberRole(session.user.id)) ?? tentativeRole
      return runWithOrgContext({ orgId, role, userId: session.user.id }, async () => {
        if (role !== "owner" && role !== "admin") return { ok: false as const, role }
        // fetchContactDisplayRows already filters by org + deleted_at IS
        // NULL, so missing rows here mean the contact doesn't exist for
        // this org or has been soft-deleted. notFound() on either.
        const displayMap = await withOrgContext(async (tx) =>
          fetchContactDisplayRows(tx, orgId, [thisId, withId]),
        )
        const recordA = displayMap.get(thisId) ?? null
        const recordB = displayMap.get(withId) ?? null
        if (!recordA || !recordB) return { ok: false as const, role }

        const [
          companiesRows,
          allContacts,
          tagOptions,
          leadSourceValues,
          hiddenLeadSources,
          allCfDefs,
          orgMembers,
        ] = await Promise.all([
          listCompaniesForOrg(),
          listContactsForOrg(),
          listDistinctContactTags(),
          listDistinctContactLeadSources(),
          listHiddenLeadSources(),
          listFieldDefinitionsForRecordType("contact"),
          getOrganizationMembers(orgId),
        ])
        return {
          ok: true as const,
          recordA,
          recordB,
          companyOptions: companiesRows.map((c) => ({ id: c.id, name: c.name })),
          ownerOptions: orgMembers.map((m) => ({
            id: m.user.id,
            name: m.user.name || m.user.email,
            email: m.user.email,
          })),
          referralOptions: allContacts
            .filter((c) => c.id !== thisId && c.id !== withId)
            .map((c) => ({
              id: c.id,
              firstName: c.firstName,
              lastName: c.lastName,
              primaryEmail: c.primaryEmail ?? null,
            })),
          tagOptions,
          leadSourceValues,
          hiddenLeadSources,
          customFieldDefs: allCfDefs
            .filter((d) => d.archivedAt === null)
            .map((d) => ({
              id: d.id,
              name: d.name,
              fieldType: d.fieldType,
              options:
                (d.options as { choices?: { value: string; label: string }[] } | null) ?? null,
              archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
            })),
        }
      })
    },
  )

  if (!loaded.ok) {
    if (loaded.role !== "owner" && loaded.role !== "admin") {
      redirect(`/contacts/${thisId}`)
    }
    notFound()
  }

  return (
    <PageContainer variant="full">
      <ContactMergeSideBySide
        recordA={loaded.recordA}
        recordB={loaded.recordB}
        customFieldDefs={loaded.customFieldDefs}
        companyOptions={loaded.companyOptions}
        ownerOptions={loaded.ownerOptions}
        referralOptions={loaded.referralOptions}
        leadSourceValues={loaded.leadSourceValues}
        hiddenLeadSources={loaded.hiddenLeadSources}
        tagOptions={loaded.tagOptions}
        cancelHref={`/contacts/${thisId}`}
      />
    </PageContainer>
  )
}
