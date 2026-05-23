import { redirect } from "next/navigation"
import Link from "next/link"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationMembers } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { Button } from "@/components/ui/button"
import { listDistinctContactTags } from "@/modules/contacts/filter-spec"
import { ContactsImportWizard } from "@/modules/contacts/ui/contacts-import-wizard"

export const dynamic = "force-dynamic"

export default async function ContactsImportPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const memberRow = await getCurrentMember(orgId, session.user.id)
  const baRole = (memberRow?.role ?? "member") as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const data = await runWithOrgContext(
    { orgId, role: tentativeRole, userId: session.user.id },
    async () => {
      const extended = (await getExtendedMemberRole(session.user.id)) ?? tentativeRole
      return runWithOrgContext({ orgId, role: extended, userId: session.user.id }, async () => {
        const tags = await listDistinctContactTags()
        return { tags }
      })
    },
  )

  const members = (await getOrganizationMembers(orgId))
    .map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Import contacts</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Upload a CSV (max 10,000 rows). We&apos;ll match against existing contacts by email,
            then phone, and let you confirm each action before importing.
          </p>
        </div>
        <Link href="/contacts">
          <Button variant="outline">Cancel</Button>
        </Link>
      </div>
      <ContactsImportWizard
        currentUserId={session.user.id}
        orgMembers={members}
        existingTags={data.tags}
      />
    </div>
  )
}
