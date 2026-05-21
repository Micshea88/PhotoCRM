import Link from "next/link"
import { redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationMembers } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { listCompaniesForOrg } from "@/modules/companies/queries"
import { listSavedViewsForObject } from "@/modules/saved-views/queries"
import {
  listContactsForView,
  listDistinctContactLeadSources,
  listDistinctContactTags,
  type ContactFilterOverrides,
} from "@/modules/contacts/filter-spec"
import { contactLabel } from "@/modules/contacts/display"
import { Button } from "@/components/ui/button"
import { ContactsFilterBar } from "@/modules/contacts/ui/contacts-filter-bar"
import { ContactsOverflowMenu } from "@/modules/contacts/ui/contacts-overflow-menu"
import { SavedViewsBar } from "@/modules/saved-views/ui/saved-views-bar"
import { formatPhoneDisplay } from "@/lib/format/phone"

function parseFilters(
  searchParams: Record<string, string | string[] | undefined>,
): ContactFilterOverrides {
  function pick(k: string): string | undefined {
    const v = searchParams[k]
    if (Array.isArray(v)) return v[0]
    return v ?? undefined
  }
  const tagsRaw = pick("tags")
  const tags = tagsRaw ? tagsRaw.split(",").filter(Boolean) : undefined
  return {
    q: pick("q"),
    contactType: pick("contactType"),
    lifecycleStatus: pick("lifecycleStatus"),
    tags,
    ownerUserId: pick("ownerUserId"),
    companyId: pick("companyId"),
    leadSource: pick("leadSource"),
    createdFrom: pick("createdFrom"),
    createdTo: pick("createdTo"),
  }
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parseFilters(params)

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
        const [contactRows, tagOpts, leadSourceOpts, companyRows, savedViewRows] =
          await Promise.all([
            listContactsForView(filters),
            listDistinctContactTags(),
            listDistinctContactLeadSources(),
            listCompaniesForOrg(),
            listSavedViewsForObject("contact", session.user.id),
          ])
        return {
          contacts: contactRows,
          tags: tagOpts,
          leadSources: leadSourceOpts,
          companies: companyRows.map((c) => ({ id: c.id, name: c.name })),
          savedViews: savedViewRows.map((v) => ({
            id: v.id,
            name: v.name,
            isDefault: v.isDefault,
          })),
        }
      })
    },
  )

  const owners = (await getOrganizationMembers(orgId))
    .map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            People — the permanent record. Use filters to narrow the list; saved views are coming
            soon.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/contacts/new">
            <Button>New contact</Button>
          </Link>
          <ContactsOverflowMenu />
        </div>
      </div>

      <SavedViewsBar views={data.savedViews} />

      <ContactsFilterBar
        tagOptions={data.tags}
        ownerOptions={owners}
        companyOptions={data.companies}
        leadSourceOptions={data.leadSources}
      />

      {data.contacts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No contacts match the current filters.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Tags</th>
              </tr>
            </thead>
            <tbody>
              {data.contacts.map(({ contact, company }) => (
                <tr
                  key={contact.id}
                  className="border-t border-[var(--color-border)] hover:bg-[var(--color-accent)]/30"
                >
                  <td className="px-4 py-2">
                    <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                      {contactLabel(
                        {
                          firstName: contact.firstName,
                          lastName: contact.lastName,
                          primaryEmail: contact.primaryEmail,
                        },
                        company?.name,
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                    {contact.primaryEmail ?? ""}
                  </td>
                  <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                    {formatPhoneDisplay(contact.primaryPhone)}
                  </td>
                  <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                    {contact.contactType ?? ""}
                  </td>
                  <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                    {contact.lifecycleStatus ?? ""}
                  </td>
                  <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                    {(contact.tags ?? []).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--color-muted-foreground)]">
        Showing {data.contacts.length} contact{data.contacts.length === 1 ? "" : "s"}. Capped at 500
        in V1 — refine filters to narrow further. Pagination ships in a later push.
      </p>
    </div>
  )
}
