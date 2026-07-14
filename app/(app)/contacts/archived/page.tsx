import Link from "next/link"
import { redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { listArchivedContactsForOrg } from "@/modules/contacts/queries"
import { contactLabel } from "@/modules/contacts/display"
import { RestoreArchivedButton } from "@/modules/contacts/ui/restore-archived-button"
import { PageContainer } from "@/modules/shared/ui/page-container"

export default async function ContactsArchivedPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  const baRole = (member?.role ?? "member") as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const rows = await runWithOrgContext(
    { orgId, role: tentativeRole, userId: session.user.id },
    async () => {
      const extended = (await getExtendedMemberRole(session.user.id)) ?? tentativeRole
      return runWithOrgContext({ orgId, role: extended, userId: session.user.id }, async () =>
        listArchivedContactsForOrg(),
      )
    },
  )

  return (
    <PageContainer variant="full" className="space-y-6">
      <div>
        <Link
          href="/contacts"
          className="text-xs text-[var(--color-muted-foreground)] hover:underline"
        >
          ← Contacts
        </Link>
        <h1 className="mt-1 font-serif text-2xl font-semibold">Archived</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Contacts you&apos;ve archived. Restore at any time — no auto-purge.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">No archived contacts.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Archived</th>
                <th className="w-24 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-border)]">
                  <td className="px-4 py-2">
                    <Link href={`/contacts/${row.id}`} className="font-medium hover:underline">
                      {contactLabel({
                        firstName: row.firstName,
                        lastName: row.lastName,
                        primaryEmail: row.primaryEmail,
                      })}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                    {row.archivedAt ? new Date(row.archivedAt).toLocaleDateString() : ""}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <RestoreArchivedButton id={row.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  )
}
