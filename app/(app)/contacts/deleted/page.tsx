import Link from "next/link"
import { redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { listDeletedContactsForOrg } from "@/modules/contacts/queries"
import { contactLabel } from "@/modules/contacts/display"
import { RestoreDeletedButton } from "@/modules/contacts/ui/restore-deleted-button"

/**
 * Push 2c.5 — Deleted contacts list with per-row Restore.
 *
 * Push 2a originally stubbed this page ("Bulk-restore UI ships in
 * PUSH 4"). Push 2c.2 added "Restore records" to the top-header
 * Actions dropdown pointing here, so the stub had to grow into a
 * real surface. Mirrors the Archived page's structure.
 *
 * 90-day auto-purge runs via the existing cron at
 * app/api/jobs/cron/purge-deleted/route.ts — this page just lists
 * the deletedAt-IS-NOT-NULL rows so users can restore them before
 * the cron sweeps.
 */
export default async function ContactsDeletedPage() {
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
        listDeletedContactsForOrg(),
      )
    },
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/contacts"
          className="text-xs text-[var(--color-muted-foreground)] hover:underline"
        >
          ← Contacts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Deleted contacts</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Restore within 90 days before permanent purge.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">No deleted contacts.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Deleted</th>
                <th className="w-24 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-border)]">
                  <td className="px-4 py-2">
                    <span className="font-medium">
                      {contactLabel({
                        firstName: row.firstName,
                        lastName: row.lastName,
                        primaryEmail: row.primaryEmail,
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                    {row.deletedAt ? new Date(row.deletedAt).toLocaleDateString() : ""}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <RestoreDeletedButton id={row.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
