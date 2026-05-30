import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationMembers } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import {
  getContactForOrg,
  listContactCompanyAssociations,
  listContactsForOrg,
} from "@/modules/contacts/queries"
import { listDistinctContactTags } from "@/modules/contacts/filter-spec"
import { contactLabel } from "@/modules/contacts/display"
import { loadContactActivity } from "@/modules/contacts/activity-loader"
import { listCompaniesForOrg } from "@/modules/companies/queries"
import { listDistinctContactLeadSources } from "@/modules/contacts/filter-spec"
import { listHiddenLeadSources } from "@/modules/lead-sources/queries"
import { ContactActionsDropdown } from "@/modules/contacts/ui/contact-actions-dropdown"
import { ContactDetailLeft } from "@/modules/contacts/ui/contact-detail-left"
import { ContactDetailCenter } from "@/modules/contacts/ui/contact-detail-center"
import { ContactDetailMobile } from "@/modules/contacts/ui/contact-detail-mobile"
import { ContactDetailRight } from "@/modules/contacts/ui/contact-detail-right"
import { ActionIconRow } from "@/modules/contacts/ui/action-icon-row"
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
        const [
          associations,
          activity,
          companiesRows,
          leadSources,
          hiddenSources,
          allContacts,
          allTags,
        ] = await Promise.all([
          listContactCompanyAssociations(id),
          loadContactActivity(orgId, id),
          listCompaniesForOrg(),
          listDistinctContactLeadSources(),
          listHiddenLeadSources(),
          listContactsForOrg(),
          listDistinctContactTags(),
        ])
        return {
          row,
          associations,
          activity,
          companyOptions: companiesRows.map((c) => ({ id: c.id, name: c.name })),
          leadSourceValues: leadSources,
          hiddenLeadSources: hiddenSources,
          // P3 (C6c polish #2) — referrals = every contact in the org
          // except this one. ContactRefPicker filters client-side.
          referralOptions: allContacts
            .filter((c) => c.id !== id)
            .map((c) => ({
              id: c.id,
              firstName: c.firstName,
              lastName: c.lastName,
              primaryEmail: c.primaryEmail ?? null,
            })),
          tagOptions: allTags,
        }
      })
    },
  )

  if (!data) notFound()
  const {
    row,
    associations,
    activity,
    companyOptions,
    leadSourceValues,
    hiddenLeadSources,
    referralOptions,
    tagOptions,
  } = data
  const { contact, company } = row
  // P3 (C6c polish #2) — find the referred-by contact's display name
  // for the read-mode label. Falls back to "—" when absent.
  const referredByContact = contact.referredByContactId
    ? referralOptions.find((c) => c.id === contact.referredByContactId)
    : null

  const orgMembers = await getOrganizationMembers(orgId)
  const owner = orgMembers.find((m) => m.user.id === contact.ownerUserId)?.user
  const ownerView = owner ? { name: owner.name, email: owner.email } : null
  // P3 (C6c polish) — UserRefPicker requires `name: string`. Fall
  // back to the email when the user row has a null display name.
  const ownerOptions = orgMembers.map((m) => ({
    id: m.user.id,
    name: m.user.name || m.user.email,
    email: m.user.email,
  }))

  const insights = readCachedInsights(contact.aiInsightsJson)
  const associationsView = associations.map(({ company: c, association }) => ({
    label: c.name,
    sub: association.role,
  }))

  return (
    // P3 (C6c polish #2) — full page width. Earlier mx-auto max-w-7xl
    // capped the page at ~1280px; on 1920+ viewports that left
    // distracting empty margins AND squeezed the action icon row past
    // its 6th slot. Drop the cap; columns flex with soft min/max
    // bounds so the center fills any extra space.
    <div className="space-y-6 px-6">
      {/* P3 (C6c polish #3) — Actions dropdown sits adjacent to the
          back breadcrumb on the LEFT (HubSpot pattern). Row 1:
          [← Contacts] [Actions ▼]. Row 2: H1 title + lead status
          badge. See docs/pathway-design-system.md §4b. */}
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <Link
            href="/contacts"
            className="text-xs text-[var(--color-muted-foreground)] hover:underline"
          >
            ← Contacts
          </Link>
          <ContactActionsDropdown contactId={contact.id} archived={!!contact.archivedAt} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <AiStatusBadge status={contact.aiLeadStatus} reasoning={contact.aiLeadStatusReasoning} />
        </div>
        {contact.archivedAt && (
          <span className="inline-block rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">
            Archived
          </span>
        )}
      </header>

      {(() => {
        const contactSlice = {
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          primaryEmail: contact.primaryEmail,
          primaryPhone: contact.primaryPhone,
          contactType: contact.contactType,
          lifecycleStatus: contact.lifecycleStatus,
          leadSource: contact.leadSource,
          ownerUserId: contact.ownerUserId,
          companyId: contact.companyId,
          tags: contact.tags ?? [],
          mailingAddress: contact.mailingAddress,
          referredByContactId: contact.referredByContactId,
        }
        // P3 polish #5 Fix 5 — AssociationsPicker options. Contacts =
        // every contact except this one; companies = all org companies.
        const associationContactOptions = referralOptions.map((c) => ({
          id: c.id,
          label: `${c.firstName} ${c.lastName}`.trim() || (c.primaryEmail ?? "") || c.id,
          sub: c.primaryEmail ?? null,
        }))
        const associationCompanyOptions = companyOptions.map((c) => ({
          id: c.id,
          label: c.name,
          sub: null,
        }))
        const leftBaseProps = {
          contact: contactSlice,
          owner: ownerView,
          companyName: company?.name ?? null,
          ownerOptions,
          companyOptions,
          leadSourceValues,
          hiddenLeadSources,
          referralOptions,
          referredByDisplayName: referredByContact
            ? `${referredByContact.firstName} ${referredByContact.lastName}`.trim()
            : null,
          tagOptions,
          associationContactOptions,
          associationCompanyOptions,
        }
        const aiBlock = (
          <div className="space-y-4">
            <AiSummaryCard
              summary={contact.aiSummaryText}
              generatedAt={contact.aiGeneratedAt}
              generationModel={contact.aiGenerationModel}
              rightSlot={<RegenerateAiButton contactId={contact.id} />}
            />
            <AiInsightsCard insights={insights} />
          </div>
        )
        const activityBlock = <ContactActivityFeed entries={activity} />
        return (
          <>
            {/* P3 (C6d) — mobile single-column tabbed shell (<lg).
                Identity is covered by the page header H1 + AI badge;
                the action row sits above the tabs; About tab renders
                ContactDetailLeft panes=["info","about"] so the desktop
                card styling is preserved without the action row dup. */}
            <div className="space-y-4 lg:hidden" data-testid="contact-detail-mobile-shell">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-3">
                <ActionIconRow
                  contactId={contact.id}
                  contactLabel={`${contact.firstName} ${contact.lastName}`.trim() || "Contact"}
                  primaryEmail={contact.primaryEmail}
                  primaryPhone={contact.primaryPhone}
                  contactOptions={associationContactOptions}
                  companyOptions={associationCompanyOptions}
                />
              </div>
              <ContactDetailMobile
                activity={
                  <div className="space-y-4">
                    {aiBlock}
                    {activityBlock}
                  </div>
                }
                associations={<ContactDetailRight associations={associationsView} />}
                about={<ContactDetailLeft {...leftBaseProps} panes={["info", "about"]} />}
              />
            </div>

            {/* Desktop 3-column (lg+). P3 polish #5 Fix 2 —
                lg:min-h-[calc(100vh-14rem)] keeps the columns tall on
                content-light contacts so dropdowns near the bottom of
                the left card have room to open. 14rem (~224px) is a
                conservative offset for global header + page header
                rows 1+2+3 + page padding. min-h (not h) so heavy
                activity still grows the row past the viewport. */}
            <div className="hidden gap-6 lg:grid lg:min-h-[calc(100vh-14rem)] lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(280px,360px)]">
              <ContactDetailLeft {...leftBaseProps} />
              <ContactDetailCenter overview={aiBlock} activity={activityBlock} />
              <ContactDetailRight associations={associationsView} />
            </div>
          </>
        )
      })()}
    </div>
  )
}
