import Link from "next/link"
import { redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationMembers } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { listCompaniesForOrg } from "@/modules/companies/queries"
import { listFieldDefinitionsForRecordType } from "@/modules/custom-fields/queries"
import { getUserViewPrefs, listSavedViewsForObject } from "@/modules/saved-views/queries"
import { listHiddenLeadSources } from "@/modules/lead-sources/queries"
import {
  listContactsForView,
  listDistinctContactLeadSources,
  listDistinctContactTags,
  type ContactFilterOverrides,
  type CustomFieldFilter,
} from "@/modules/contacts/filter-spec"
import { Button } from "@/components/ui/button"
import { ContactsOverflowMenu } from "@/modules/contacts/ui/contacts-overflow-menu"
import { ContactsShell } from "@/modules/contacts/ui/contacts-shell"
import type { SavedViewTab } from "@/modules/saved-views/ui/saved-views-tab-strip"
import type { Visibility } from "@/modules/saved-views/types"

/**
 * Parse URL search params into ContactFilterOverrides. Both the
 * URL-level filter chips (Push 2a) and the More filters drawer
 * (Push 2b) write to URL params; this is the single source of truth
 * for what the user has overridden on top of the active view's
 * stored filters.
 */
function parseUrlOverrides(
  searchParams: Record<string, string | string[] | undefined>,
): ContactFilterOverrides {
  function pick(k: string): string | undefined {
    const v = searchParams[k]
    if (Array.isArray(v)) return v[0]
    return v ?? undefined
  }
  const tagsRaw = pick("tags")
  const tags = tagsRaw ? tagsRaw.split(",").filter(Boolean) : undefined
  const customFields: CustomFieldFilter[] = []
  for (const [key, raw] of Object.entries(searchParams)) {
    if (!key.startsWith("cf:")) continue
    const value = Array.isArray(raw) ? raw[0] : raw
    if (!value) continue
    const [, fieldId, op] = key.split(":")
    if (!fieldId || !op) continue
    if (!isCustomFieldOp(op)) continue
    customFields.push({ fieldId, op, value })
  }
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
    hasPhone: pick("hasPhone") === "true" ? true : undefined,
    hasEmail: pick("hasEmail") === "true" ? true : undefined,
    lastActivityFrom: pick("lastActivityFrom"),
    lastActivityTo: pick("lastActivityTo"),
    openTasksFrom: pick("openTasksFrom"),
    openTasksTo: pick("openTasksTo"),
    customFields: customFields.length > 0 ? customFields : undefined,
  }
}

function isCustomFieldOp(op: string): op is CustomFieldFilter["op"] {
  return ["contains", "eq", "in", "min", "max", "from", "to"].includes(op)
}

/**
 * Apply a saved view's stored filter array on top of URL overrides.
 * URL overrides WIN. The stored array follows the
 * `{field, op, value}` shape from saved-views/types.ts. Unknown
 * fields are silently ignored — the saved-views renderer is the
 * source of truth for what we honor.
 */
function mergeViewFiltersIntoOverrides(
  overrides: ContactFilterOverrides,
  storedFilters: unknown[] | null,
): ContactFilterOverrides {
  if (!storedFilters || storedFilters.length === 0) return overrides
  const out: ContactFilterOverrides = { ...overrides }
  for (const raw of storedFilters) {
    if (!raw || typeof raw !== "object") continue
    const f = raw as { field?: unknown; op?: unknown; value?: unknown }
    if (typeof f.field !== "string") continue
    switch (f.field) {
      case "contactType":
        if (!out.contactType && typeof f.value === "string") out.contactType = f.value
        break
      case "lifecycleStatus":
        if (!out.lifecycleStatus && typeof f.value === "string") out.lifecycleStatus = f.value
        break
      case "tags":
        if (!out.tags && Array.isArray(f.value)) {
          out.tags = f.value.filter((v): v is string => typeof v === "string")
        }
        break
      case "ownerUserId":
        if (!out.ownerUserId && typeof f.value === "string") out.ownerUserId = f.value
        break
      case "companyId":
        if (!out.companyId && typeof f.value === "string") out.companyId = f.value
        break
      case "leadSource":
        if (!out.leadSource && typeof f.value === "string") out.leadSource = f.value
        break
      case "createdAt":
        if (f.op === "gte" && !out.createdFrom && typeof f.value === "string")
          out.createdFrom = f.value
        if (f.op === "lte" && !out.createdTo && typeof f.value === "string") out.createdTo = f.value
        break
      case "primaryPhone":
        if (f.op === "is_not_null" && out.hasPhone === undefined) out.hasPhone = true
        break
      case "primaryEmail":
        if (f.op === "is_not_null" && out.hasEmail === undefined) out.hasEmail = true
        break
      case "lastActivity":
        if (f.op === "gte" && !out.lastActivityFrom && typeof f.value === "string")
          out.lastActivityFrom = f.value
        if (f.op === "lte" && !out.lastActivityTo && typeof f.value === "string")
          out.lastActivityTo = f.value
        break
      case "openTasks":
        if (f.op === "gte" && !out.openTasksFrom && typeof f.value === "string")
          out.openTasksFrom = f.value
        if (f.op === "lte" && !out.openTasksTo && typeof f.value === "string")
          out.openTasksTo = f.value
        break
    }
  }
  return out
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const urlOverrides = parseUrlOverrides(params)

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
        const [tagOpts, leadSourceOpts, companyRows, savedViewRows, hiddenSources, prefs, cfDefs] =
          await Promise.all([
            listDistinctContactTags(),
            listDistinctContactLeadSources(),
            listCompaniesForOrg(),
            listSavedViewsForObject("contact", session.user.id),
            listHiddenLeadSources(),
            getUserViewPrefs(session.user.id, "contact"),
            listFieldDefinitionsForRecordType("contact"),
          ])

        // Resolve active view: explicit ?view= wins, else user's
        // last-viewed pref, else the system default. The system default
        // is guaranteed to exist for any org seeded after the saved-view
        // seed shipped; older orgs may need a backfill.
        const requestedViewId = typeof params.view === "string" ? params.view : undefined
        const defaultView = savedViewRows.find((v) => v.isDefault) ?? null
        const fallbackId = prefs?.lastViewedViewId ?? defaultView?.id ?? null
        const activeViewId = requestedViewId ?? fallbackId
        const activeView = savedViewRows.find((v) => v.id === activeViewId) ?? defaultView

        // Merge view-stored filters with URL overrides (URL wins).
        const appliedFilters = mergeViewFiltersIntoOverrides(
          urlOverrides,
          (activeView?.filters as unknown[] | null) ?? null,
        )
        const contactRows = await listContactsForView(appliedFilters)

        return {
          contacts: contactRows.map(({ contact, company }) => ({
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            primaryEmail: contact.primaryEmail,
            primaryPhone: contact.primaryPhone,
            contactType: contact.contactType,
            lifecycleStatus: contact.lifecycleStatus,
            tags: contact.tags,
            companyName: company?.name ?? null,
            createdAt: contact.createdAt.toISOString(),
          })),
          tags: tagOpts,
          leadSources: leadSourceOpts,
          companies: companyRows.map((c) => ({ id: c.id, name: c.name })),
          savedViews: savedViewRows.map(
            (v): SavedViewTab => ({
              id: v.id,
              name: v.name,
              visibility: v.visibility as Visibility,
              sharedWithUserIds: v.sharedWithUserIds ?? null,
              ownerUserId: v.ownerUserId,
              isDefault: v.isDefault,
              columnConfig: v.columnConfig,
              filters: v.filters,
              sort: v.sort,
            }),
          ),
          orderedViewIds: prefs?.orderedViewIds ?? [],
          activeViewId: activeViewId ?? defaultView?.id ?? "",
          hiddenLeadSources: hiddenSources,
          cfDefs: cfDefs.map((d) => ({
            id: d.id,
            name: d.name,
            fieldType: d.fieldType,
            options: (d.options as { choices?: { value: string; label: string }[] } | null) ?? null,
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
            People — the permanent record. Switch views to slice the list, customize columns, or
            save a new view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/contacts/new">
            <Button>New contact</Button>
          </Link>
          <ContactsOverflowMenu />
        </div>
      </div>

      <ContactsShell
        contacts={data.contacts}
        totalCount={data.contacts.length}
        views={data.savedViews}
        orderedViewIds={data.orderedViewIds}
        activeViewId={data.activeViewId}
        currentUserId={session.user.id}
        members={owners}
        tagOptions={data.tags}
        ownerOptions={owners}
        companyOptions={data.companies}
        leadSourceOptions={data.leadSources}
        hiddenLeadSources={data.hiddenLeadSources}
        customFieldDefs={data.cfDefs}
      />
    </div>
  )
}
