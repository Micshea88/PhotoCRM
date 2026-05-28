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
  CONTACTS_DEFAULT_PAGE_SIZE,
  CONTACTS_VALID_PAGE_SIZES,
  listContactsForView,
  listDistinctContactLeadSources,
  listDistinctContactTags,
  type ContactFilterOverrides,
  type ContactsPageSize,
  type CustomFieldFilter,
} from "@/modules/contacts/filter-spec"
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
    // P3 (C6c followup) — bi-directional sort. Reads sortBy + sortDir
    // straight from the URL. The list query whitelists sortBy against
    // SORTABLE_CONTACT_FIELDS internally; an unknown value falls back
    // to the default (lastName asc) so URL drift can't break the list.
    sortBy: pick("sortBy"),
    sortDir: pick("sortDir") === "desc" ? "desc" : pick("sortDir") === "asc" ? "asc" : undefined,
  }
}

function isCustomFieldOp(op: string): op is CustomFieldFilter["op"] {
  return ["contains", "eq", "in", "min", "max", "from", "to"].includes(op)
}

/**
 * P3 (C6c followup) — apply a saved view's stored `sort` jsonb on
 * top of URL overrides. URL params win — `sortBy` / `sortDir` from
 * the URL take precedence over the view's persisted sort. The
 * `sortJsonSchema` (saved-views/types.ts) accepts either a single
 * `{ field, direction }` or an array; we honor the first entry of
 * the array form for V1 (multi-key sort isn't surfaced through the
 * URL today).
 */
function mergeViewSortIntoOverrides(
  overrides: ContactFilterOverrides,
  storedSort: unknown,
): ContactFilterOverrides {
  if (overrides.sortBy) return overrides
  if (!storedSort || typeof storedSort !== "object") return overrides
  const first: unknown = Array.isArray(storedSort) ? storedSort[0] : storedSort
  if (!first || typeof first !== "object") return overrides
  const s = first as { field?: unknown; direction?: unknown }
  if (typeof s.field !== "string") return overrides
  const dir: "asc" | "desc" = s.direction === "desc" ? "desc" : "asc"
  return { ...overrides, sortBy: s.field, sortDir: dir }
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
  cfDefsByFieldId: Map<string, { fieldType: string }>,
): ContactFilterOverrides {
  if (!storedFilters || storedFilters.length === 0) return overrides
  const out: ContactFilterOverrides = { ...overrides }
  // Accumulator for custom-field filters lifted out of the stored
  // saved-view filter array. URL overrides win — only entries the URL
  // didn't already supply land here.
  const urlCfKeys = new Set((out.customFields ?? []).map((cf) => `${cf.fieldId}:${cf.op}`))
  const cfFromView: CustomFieldFilter[] = []
  for (const raw of storedFilters) {
    if (!raw || typeof raw !== "object") continue
    const f = raw as { field?: unknown; op?: unknown; value?: unknown }
    if (typeof f.field !== "string") continue
    // Push 4 (A4) — custom field filters in saved-view jsonb use the
    // `field: "customField.<fieldId>"` namespacing convention (set by
    // contacts-shell.tsx:serializeFiltersFromParams). Translate them
    // back into the URL-overrides shape so the list query receives
    // them and the More Filters drawer reflects active state.
    if (f.field.startsWith("customField.")) {
      const fieldId = f.field.slice("customField.".length)
      const def = cfDefsByFieldId.get(fieldId)
      const drawerOp = canonicalToDrawerOp(typeof f.op === "string" ? f.op : "", def?.fieldType)
      if (!fieldId || !drawerOp) continue
      const valueStr = typeof f.value === "string" ? f.value : null
      if (!valueStr) continue
      if (urlCfKeys.has(`${fieldId}:${drawerOp}`)) continue
      cfFromView.push({ fieldId, op: drawerOp, value: valueStr })
      continue
    }
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
  if (cfFromView.length > 0) {
    out.customFields = [...(out.customFields ?? []), ...cfFromView]
  }
  return out
}

/**
 * Translate the canonical filter op (the shape stored in the
 * saved_views.filters jsonb) back into the drawer-side op set
 * (contains / eq / in / min / max / from / to) that the URL params +
 * buildContactConditions both speak. Mirrors the inverse mapping in
 * contacts-shell.tsx:serializeFiltersFromParams.
 *
 * Returns null when the op isn't recognised for a custom field —
 * silently dropped (forward-compat).
 */
function canonicalToDrawerOp(
  canonical: string,
  fieldType: string | undefined,
): CustomFieldFilter["op"] | null {
  switch (canonical) {
    case "contains":
      return "contains"
    case "eq":
      return "eq"
    case "in":
      return "in"
    case "gte":
      return fieldType === "date" || fieldType === "datetime" ? "from" : "min"
    case "lte":
      return fieldType === "date" || fieldType === "datetime" ? "to" : "max"
    default:
      return null
  }
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
        // set-as-default pref, else last-viewed pref, else the system
        // default. Push 2c — defaultViewId pref takes precedence over
        // last-viewed because the user explicitly elected it.
        const requestedViewId = typeof params.view === "string" ? params.view : undefined
        const defaultView = savedViewRows.find((v) => v.isDefault) ?? null
        const fallbackId =
          prefs?.defaultViewId ?? prefs?.lastViewedViewId ?? defaultView?.id ?? null
        const activeViewId = requestedViewId ?? fallbackId
        const activeView = savedViewRows.find((v) => v.id === activeViewId) ?? defaultView

        // Merge view-stored filters with URL overrides (URL wins).
        const cfDefsByFieldId = new Map(cfDefs.map((d) => [d.id, { fieldType: d.fieldType }]))
        const mergedFilters = mergeViewFiltersIntoOverrides(
          urlOverrides,
          (activeView?.filters as unknown[] | null) ?? null,
          cfDefsByFieldId,
        )
        // P3 (C6c followup) — merge the saved view's `sort` jsonb into
        // the query overrides. URL params win — `sortBy`/`sortDir` on
        // the URL override the view's persisted sort. When neither is
        // set, the list query falls back to its default (lastName asc).
        const appliedFilters = mergeViewSortIntoOverrides(mergedFilters, activeView?.sort)

        // Pagination — page + pageSize resolved from URL with prefs fallback.
        const requestedPage =
          typeof params.page === "string" ? Math.max(1, parseInt(params.page, 10) || 1) : 1
        const requestedPageSize: ContactsPageSize = (() => {
          const raw = typeof params.pageSize === "string" ? parseInt(params.pageSize, 10) : NaN
          if (CONTACTS_VALID_PAGE_SIZES.includes(raw as ContactsPageSize)) {
            return raw as ContactsPageSize
          }
          const stored = prefs?.contactPageSize
          if (stored && CONTACTS_VALID_PAGE_SIZES.includes(stored as ContactsPageSize)) {
            return stored as ContactsPageSize
          }
          return CONTACTS_DEFAULT_PAGE_SIZE
        })()

        const contactResult = await listContactsForView(appliedFilters, {
          page: requestedPage,
          pageSize: requestedPageSize,
        })

        // Push 2c.6 — resolve owner_user_id → display name for the Owner
        // column. Returns null when the FK is null or the linked user has
        // been deleted (set null cascade on the FK). The same member
        // listing also feeds the outer `owners` prop computation — kept
        // inside the runWithOrgContext block so we don't issue the same
        // query twice.
        const orgMembers = await getOrganizationMembers(orgId)
        const ownerNameById = new Map<string, string>(
          orgMembers.map((m) => [m.user.id, m.user.name]),
        )

        return {
          contacts: contactResult.rows.map(({ contact, company }) => {
            // Push 2c.6 — extract mailingAddress jsonb sub-fields into
            // flat row props for the Mailing city / state / zip
            // columns. Schema is parsed as Record<string, unknown>; the
            // strict shape lives in mailingAddressSchema.
            const addr = (contact.mailingAddress ?? {}) as {
              city?: unknown
              state?: unknown
              zip?: unknown
            }
            const mailingCity = typeof addr.city === "string" ? addr.city : null
            const mailingState = typeof addr.state === "string" ? addr.state : null
            const mailingZip = typeof addr.zip === "string" ? addr.zip : null
            return {
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
              secondaryEmail: contact.secondaryEmail,
              secondaryPhone: contact.secondaryPhone,
              mailingCity,
              mailingState,
              mailingZip,
              dob: contact.dob,
              anniversaryDate: contact.anniversaryDate,
              instagramHandle: contact.instagramHandle,
              facebookUrl: contact.facebookUrl,
              website: contact.website,
              leadSource: contact.leadSource,
              sourceDetail: contact.sourceDetail,
              ownerName: contact.ownerUserId
                ? (ownerNameById.get(contact.ownerUserId) ?? null)
                : null,
              updatedAt: contact.updatedAt.toISOString(),
              notes: contact.notes,
              customFields: contact.customFields,
            }
          }),
          totalCount: contactResult.totalCount,
          cappedOut: contactResult.cappedOut,
          page: requestedPage,
          pageSize: requestedPageSize,
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
          // Push 2c — pinned-tab-driven render. If the user has no prefs
          // row yet and the system default exists, seed the strip with it
          // so the page is never empty; the tab strip's mount effect
          // persists this on first visit.
          pinnedViewIds: prefs?.pinnedViewIds ?? (defaultView ? [defaultView.id] : []),
          defaultViewId: prefs?.defaultViewId ?? null,
          hasPrefsRow: prefs !== null,
          createdAtById: Object.fromEntries(
            savedViewRows.map((v) => [v.id, v.createdAt.toISOString()]),
          ),
          activeViewId: activeViewId ?? defaultView?.id ?? "",
          hiddenLeadSources: hiddenSources,
          cfDefs: cfDefs.map((d) => ({
            id: d.id,
            name: d.name,
            fieldType: d.fieldType,
            options: (d.options as { choices?: { value: string; label: string }[] } | null) ?? null,
            archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
          })),
          orgMembers,
        }
      })
    },
  )

  const owners = data.orgMembers
    .map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-6">
      <ContactsShell
        contacts={data.contacts}
        totalCount={data.totalCount}
        cappedOut={data.cappedOut}
        page={data.page}
        pageSize={data.pageSize}
        views={data.savedViews}
        pinnedViewIds={data.pinnedViewIds}
        defaultViewId={data.defaultViewId}
        hasPrefsRow={data.hasPrefsRow}
        createdAtById={data.createdAtById}
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
