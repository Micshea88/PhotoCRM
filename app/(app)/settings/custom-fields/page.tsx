import { redirect } from "next/navigation"
import Link from "next/link"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { getLabel } from "@/modules/terminology/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import {
  countDefinitionUsage,
  listFieldDefinitionsForRecordType,
} from "@/modules/custom-fields/queries"
import {
  CustomFieldsPageTabs,
  type CustomFieldsTabSpec,
} from "@/modules/custom-fields/ui/custom-fields-page-tabs"
import { CustomFieldsList } from "@/modules/custom-fields/ui/custom-fields-list"

/**
 * /settings/custom-fields — the per-org custom-field-definitions admin
 * surface. Owner + Admin only; Manager / Team member / Accountant get
 * redirected to /dashboard (matches the Members page pattern).
 *
 * One tab per record type. Tab labels come from the terminology module
 * (Contacts / Companies / Pipeline / Events) — DO NOT hardcode the
 * pipeline / events labels here; photographers use "Event", a future
 * vertical may use "Project" or "Job".
 *
 * The active tab is driven by ?type=<recordType>. Falls back to
 * "contact" when missing or unknown.
 */

const SUPPORTED_RECORD_TYPES = ["contact", "company", "opportunity", "project"] as const
type SupportedRecordType = (typeof SUPPORTED_RECORD_TYPES)[number]

function isSupported(t: string | undefined): t is SupportedRecordType {
  return typeof t === "string" && (SUPPORTED_RECORD_TYPES as readonly string[]).includes(t)
}

export default async function CustomFieldsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  if (!member) redirect("/dashboard")
  const baRole = member.role as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  // Compute the extended role (may differ from BA, e.g. Manager →
  // BA "member"). Custom-fields management is Owner + Admin only —
  // Manager has manage_settings but cannot reshape the per-org
  // schema. Spec language: "match the Members pattern exactly".
  const extendedRole =
    (await runWithOrgContext({ orgId, role: tentativeRole, userId: session.user.id }, async () =>
      getExtendedMemberRole(session.user.id),
    )) ?? tentativeRole

  if (extendedRole !== "owner" && extendedRole !== "admin") {
    redirect("/dashboard")
  }

  const params = await searchParams
  const requested = params.type
  const activeRecordType: SupportedRecordType = isSupported(requested) ? requested : "contact"

  const { tabs, definitions, usageById, activeLabel } = await runWithOrgContext(
    { orgId, role: extendedRole, userId: session.user.id },
    async () => {
      const [contactLabel, companyLabel, opportunityLabel, projectLabel] = await Promise.all([
        getLabel("contact"),
        getLabel("company"),
        getLabel("opportunity"),
        getLabel("project"),
      ])

      const labelByRecordType: Record<SupportedRecordType, { singular: string; plural: string }> = {
        contact: contactLabel,
        company: companyLabel,
        opportunity: opportunityLabel,
        project: projectLabel,
      }

      const tabSpecs: CustomFieldsTabSpec[] = SUPPORTED_RECORD_TYPES.map((rt) => ({
        recordType: rt,
        label: labelByRecordType[rt].plural,
      }))

      const [defs, usage] = await Promise.all([
        listFieldDefinitionsForRecordType(activeRecordType),
        countDefinitionUsage(activeRecordType),
      ])

      return {
        tabs: tabSpecs,
        definitions: defs,
        usageById: Object.fromEntries(usage),
        activeLabel: labelByRecordType[activeRecordType].singular,
      }
    },
  )

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-xs text-[var(--color-muted-foreground)] hover:underline"
        >
          ← Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Custom fields</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Tailor what data your studio captures on each record type. Custom fields appear in the
          create/edit forms for the matching entity.
        </p>
      </div>

      <CustomFieldsPageTabs tabs={tabs} active={activeRecordType} />

      <CustomFieldsList
        recordType={activeRecordType}
        recordTypeLabel={activeLabel}
        initialDefinitions={definitions}
        usageById={usageById}
      />
    </div>
  )
}
