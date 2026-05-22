import { redirect } from "next/navigation"
import Link from "next/link"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { LEAD_SOURCE_DEFAULTS } from "@/modules/lead-sources/types"
import { countContactsPerLeadSource, listHiddenLeadSources } from "@/modules/lead-sources/queries"
import { LeadSourcesSettings } from "@/modules/lead-sources/ui/lead-sources-settings"

export default async function LeadSourcesSettingsPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  const baRole = (member?.role ?? "member") as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const { hidden, counts } = await runWithOrgContext(
    { orgId, role: tentativeRole, userId: session.user.id },
    async () => {
      const extended = (await getExtendedMemberRole(session.user.id)) ?? tentativeRole
      return runWithOrgContext({ orgId, role: extended, userId: session.user.id }, async () => {
        const [hiddenSources, countsMap] = await Promise.all([
          listHiddenLeadSources(),
          countContactsPerLeadSource(),
        ])
        return { hidden: hiddenSources, counts: countsMap }
      })
    },
  )

  const seededLower = new Set(LEAD_SOURCE_DEFAULTS.map((s) => s.toLowerCase()))
  const customRows = Array.from(counts.entries())
    .filter(([name]) => !seededLower.has(name.toLowerCase()))
    .map(([name, count]) => ({
      sourceName: name,
      count,
      hidden: hidden.includes(name),
    }))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/contacts"
          className="text-xs text-[var(--color-muted-foreground)] hover:underline"
        >
          ← Contacts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Lead sources</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Manage which lead sources appear in the contact form&apos;s Lead source dropdown. Hidden
          sources stay on existing contacts; deleted custom sources are wiped from every contact in
          your studio.
        </p>
      </div>
      <LeadSourcesSettings initialHidden={hidden} initialCustom={customRows} />
    </div>
  )
}
