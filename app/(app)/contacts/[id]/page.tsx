import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationMembers } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { getContactForOrg, listContactCompanyAssociations } from "@/modules/contacts/queries"
import { contactLabel } from "@/modules/contacts/display"
import { loadContactActivity } from "@/modules/contacts/activity-loader"
import { Button } from "@/components/ui/button"
import { DeleteContactButton } from "@/modules/contacts/ui/delete-contact-button"
import { ArchiveContactButton } from "@/modules/contacts/ui/archive-contact-button"
import { ContactDetailLeft } from "@/modules/contacts/ui/contact-detail-left"
import { ContactDetailCenter } from "@/modules/contacts/ui/contact-detail-center"
import { ContactDetailRight } from "@/modules/contacts/ui/contact-detail-right"
import { ContactActivityFeed } from "@/modules/contacts/ui/contact-activity-feed"
import { AiStatusBadge } from "@/modules/contacts/ui/ai-status-badge"
import { AiSummaryCard } from "@/modules/contacts/ui/ai-summary-card"
import { AiInsightsCard } from "@/modules/contacts/ui/ai-insights-card"
import { RegenerateAiButton } from "@/modules/contacts/ui/regenerate-ai-button"
import type { AiInsight } from "@/modules/contacts/ai/insights-detector"

/**
 * Push 3 (C6c) — contact detail page rebuild.
 *
 * Desktop-only 3-column layout (mobile is C6d).
 *   - Left: identity card + action buttons + about panel
 *     (ContactDetailLeft)
 *   - Center: 3 tabs (Overview / Activity / To-Do's)
 *     (ContactDetailCenter)
 *   - Right: 4 collapsible sections — Associations / Events /
 *     Financials / Files (ContactDetailRight; Financials + Files
 *     render "Coming soon" per autonomous default G).
 *
 * Loaders preserved per autonomous default B — no fields removed
 * from the existing data flow. AI cache columns (C6a) feed the
 * Overview tab; if the cache is empty, the user hits "Regenerate"
 * (button in the summary card) and the AI engine populates it.
 *
 * Activity feed merges notes + calls + meetings + sms_messages via
 * `loadContactActivity`. All current dummy contacts will show empty
 * feeds + the empty-floor AI status until real activity arrives.
 */

interface InsightsCacheShape {
  insights?: unknown
  version?: number
}

function readCachedInsights(raw: unknown): AiInsight[] {
  if (!raw || typeof raw !== "object") return []
  const shape = raw as InsightsCacheShape
  if (!Array.isArray(shape.insights)) return []
  // Trust the cache shape — it was written by detectInsights. Defensive
  // parse would be overkill; the integration boundary is the regenerate
  // action.
  return shape.insights as AiInsight[]
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
        const [associations, activity] = await Promise.all([
          listContactCompanyAssociations(id),
          loadContactActivity(orgId, id),
        ])
        return { row, associations, activity }
      })
    },
  )

  if (!data) notFound()
  const { row, associations, activity } = data
  const { contact, company } = row

  const orgMembers = await getOrganizationMembers(orgId)
  const owner = orgMembers.find((m) => m.user.id === contact.ownerUserId)?.user
  const ownerView = owner ? { name: owner.name, email: owner.email } : null

  const insights = readCachedInsights(contact.aiInsightsJson)
  const associationsView = associations.map(({ company: c, association }) => ({
    label: c.name,
    sub: association.role,
  }))

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/contacts"
            className="text-xs text-[var(--color-muted-foreground)] hover:underline"
          >
            ← Contacts
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-semibold">
              {contactLabel(
                {
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                  primaryEmail: contact.primaryEmail,
                },
                company?.name,
              )}
            </h1>
            <AiStatusBadge
              status={contact.aiLeadStatus}
              reasoning={contact.aiLeadStatusReasoning}
            />
          </div>
          {contact.archivedAt && (
            <span className="mt-2 inline-block rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">
              Archived
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/contacts/${contact.id}/edit`}>
            <Button type="button" variant="outline" size="sm">
              Edit
            </Button>
          </Link>
          {!contact.archivedAt && <ArchiveContactButton id={contact.id} />}
          <DeleteContactButton id={contact.id} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr_320px]">
        <ContactDetailLeft
          contact={{
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            primaryEmail: contact.primaryEmail,
            primaryPhone: contact.primaryPhone,
            contactType: contact.contactType,
            lifecycleStatus: contact.lifecycleStatus,
            leadSource: contact.leadSource,
          }}
          owner={ownerView}
          companyName={company?.name ?? null}
        />

        <ContactDetailCenter
          overview={
            <div className="space-y-4">
              <AiSummaryCard
                summary={contact.aiSummaryText}
                generatedAt={contact.aiGeneratedAt}
                generationModel={contact.aiGenerationModel}
                rightSlot={<RegenerateAiButton contactId={contact.id} />}
              />
              <AiInsightsCard insights={insights} />
            </div>
          }
          activity={<ContactActivityFeed entries={activity} />}
          todos={
            <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
              Tasks integration ships in Push 7.
            </p>
          }
        />

        <ContactDetailRight associations={associationsView} />
      </div>
    </div>
  )
}
