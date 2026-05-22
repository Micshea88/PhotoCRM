"use client"

import { useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  SavedViewsTabStrip,
  type SavedViewTab,
} from "@/modules/saved-views/ui/saved-views-tab-strip"
import type { OrgMember } from "@/modules/saved-views/ui/visibility-modal"
import type { Filter, Sort } from "@/modules/saved-views/types"
import { ContactsFilterBar } from "./contacts-filter-bar"
import { ContactsTable, type ContactRow } from "./contacts-table"
import { EditColumnsDrawer } from "./edit-columns-drawer"
import { MoreFiltersDrawer, type CustomFieldDef } from "./more-filters-drawer"
import { CONTACT_COLUMN_REGISTRY, resolveContactColumns, type ColumnConfigItem } from "./columns"

/**
 * Push 2b client shell for /contacts. Wraps the saved-view tab strip,
 * filter bar, More filters drawer, Edit columns drawer, and the
 * dynamic contacts table.
 *
 * ─── DIRTY DETECTION ──────────────────────────────────────────────────
 *
 * URL = "filter deltas on top of the active view's stored filters."
 * After tab switch, URL is just `?view=<id>`; server merges the view's
 * stored filters into the applied query. Any additional URL param
 * (other than `view`, `sort`) is treated as a user-applied override
 * and flips dirty=true on the filter side.
 *
 * Column dirty = current client column state ≠ view's stored
 * columnConfig (deep-equal).
 *
 * The shell exposes `currentState` (filters/columnConfig/sort) for
 * Save / Save-as. Filters are read from URL search params verbatim;
 * the action layer accepts the canonical jsonb-filter-array shape, so
 * `serializeFiltersFromUrl` translates here.
 *
 * ─── ALL CONTACTS SPECIAL CASE ────────────────────────────────────────
 *
 * The system default tab cannot be overwritten (visibility=org +
 * owner_user_id=NULL means RLS would reject the update, and the
 * tab strip enforces it visually too — only Save-as is offered when
 * the dirty active tab is the system default).
 */

interface ContactsShellProps {
  contacts: ContactRow[]
  /** Hint for "Showing N contacts" footer. Same number as contacts.length, kept explicit. */
  totalCount: number
  /** Available saved views the user can see (tab strip + dirty state). */
  views: SavedViewTab[]
  /** Per-user tab order (saved-view ids, system default is implicit-leftmost). */
  orderedViewIds: string[]
  /** Resolved active view id (?view= or fallback to system default). */
  activeViewId: string
  /** Session user id — drives owner-only menu items. */
  currentUserId: string
  /** Org members for the visibility modal picker. */
  members: OrgMember[]
  /** Filter bar inputs. */
  tagOptions: string[]
  ownerOptions: { id: string; name: string | null; email: string }[]
  companyOptions: { id: string; name: string }[]
  leadSourceOptions: string[]
  hiddenLeadSources: string[]
  customFieldDefs: CustomFieldDef[]
}

export function ContactsShell({
  contacts,
  totalCount,
  views,
  orderedViewIds,
  activeViewId,
  currentUserId,
  members,
  tagOptions,
  ownerOptions,
  companyOptions,
  leadSourceOptions,
  hiddenLeadSources,
  customFieldDefs,
}: ContactsShellProps) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  const activeView = views.find((v) => v.id === activeViewId)

  // ── Column state: initialized from the active view, reset on tab switch ─
  // We use the "store the prev key + reset in render" pattern instead of
  // useEffect: React allows setState during render as long as it
  // converges on a stable result, and this avoids the cascade-render
  // warning the lint flags on effect-driven resets.
  const [columnConfig, setColumnConfig] = useState<ColumnConfigItem[]>(
    activeView?.columnConfig ?? [],
  )
  const [resetKey, setResetKey] = useState(activeViewId)
  if (activeViewId !== resetKey) {
    setResetKey(activeViewId)
    setColumnConfig(activeView?.columnConfig ?? [])
  }

  // ── Dirty detection ──────────────────────────────────────────────────
  const filterDirty = useMemo(() => {
    let count = 0
    for (const key of params.keys()) {
      if (key !== "view" && key !== "sort") count++
    }
    return count > 0
  }, [params])

  const columnsDirty = useMemo(() => {
    return !columnConfigsEqual(columnConfig, activeView?.columnConfig ?? [])
  }, [columnConfig, activeView?.columnConfig])

  const isDirty = filterDirty || columnsDirty

  // ── Drawer states ────────────────────────────────────────────────────
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [editColumnsOpen, setEditColumnsOpen] = useState(false)

  // ── Snapshot the "current state" passed to Save/Save-as. ──────────────
  const currentState = useMemo(
    () => ({
      filters: serializeFiltersFromParams(params),
      columnConfig,
      sort: serializeSortFromParams(params),
    }),
    [params, columnConfig],
  )

  // ── Active panel-filter count for the "+ More filters (N)" button ────
  const morePanelCount = useMemo(() => {
    let n = 0
    if (params.get("hasPhone") === "true") n++
    if (params.get("hasEmail") === "true") n++
    if (params.get("lastActivityFrom") || params.get("lastActivityTo")) n++
    if (params.get("openTasksFrom") || params.get("openTasksTo")) n++
    for (const key of params.keys()) {
      if (key.startsWith("cf:")) {
        n++
      }
    }
    return n
  }, [params])

  const resolvedCols = resolveContactColumns(columnConfig)

  function clearAllOverrides() {
    // Drop every URL param except `view`. Resets the column state too.
    setColumnConfig(activeView?.columnConfig ?? [])
    router.push(`${pathname}?view=${activeViewId}`)
  }

  return (
    <div className="space-y-4">
      <SavedViewsTabStrip
        views={views}
        activeViewId={activeViewId}
        orderedViewIds={orderedViewIds}
        currentUserId={currentUserId}
        objectType="contact"
        members={members}
        isDirty={isDirty}
        currentState={currentState}
      />

      <ContactsFilterBar
        tagOptions={tagOptions}
        ownerOptions={ownerOptions}
        companyOptions={companyOptions}
        leadSourceOptions={leadSourceOptions}
        hiddenLeadSources={hiddenLeadSources}
      />

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setMoreFiltersOpen(true)
          }}
        >
          + More filters{morePanelCount > 0 ? ` (${String(morePanelCount)})` : ""}
        </Button>
        {isDirty && (
          <button
            type="button"
            onClick={clearAllOverrides}
            className="text-xs text-[var(--color-muted-foreground)] hover:underline"
          >
            Reset view to saved
          </button>
        )}
      </div>

      {contacts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No contacts match the current filters.
          </p>
        </div>
      ) : (
        <ContactsTable
          rows={contacts}
          columnConfig={columnConfig}
          onColumnConfigChange={setColumnConfig}
          onOpenEditColumns={() => {
            setEditColumnsOpen(true)
          }}
        />
      )}

      <p className="text-xs text-[var(--color-muted-foreground)]">
        Showing {totalCount} contact{totalCount === 1 ? "" : "s"} across{" "}
        {resolvedCols.visible.length} column{resolvedCols.visible.length === 1 ? "" : "s"}. Capped
        at 500 in V1 — refine filters to narrow further. Pagination ships in a later push.
      </p>

      <MoreFiltersDrawer
        open={moreFiltersOpen}
        onClose={() => {
          setMoreFiltersOpen(false)
        }}
        customFields={customFieldDefs}
      />
      <EditColumnsDrawer
        open={editColumnsOpen}
        onClose={() => {
          setEditColumnsOpen(false)
        }}
        columns={columnConfig}
        onChange={setColumnConfig}
      />
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function columnConfigsEqual(a: ColumnConfigItem[], b: ColumnConfigItem[]): boolean {
  if (a.length !== b.length) return false
  // Sort by order to compare layout. Items with the same id should be
  // at the same index after sort.
  const aSorted = [...a].sort((x, y) => x.order - y.order)
  const bSorted = [...b].sort((x, y) => x.order - y.order)
  for (let i = 0; i < aSorted.length; i++) {
    const x = aSorted[i]
    const y = bSorted[i]
    if (!x || !y) return false
    if (x.id !== y.id || x.visible !== y.visible || x.width !== y.width) return false
  }
  return true
}

/**
 * Translate the current URL search params into the canonical
 * `filters jsonb` array shape that saved_views.filters stores. The
 * inverse step (stored filters → URL params on tab switch) is
 * intentionally NOT done — see ContactsShell docblock for the
 * "URL = deltas" architecture.
 */
function serializeFiltersFromParams(params: URLSearchParams): Filter[] {
  const out: Filter[] = []
  function add(field: string, op: Filter["op"], value: unknown) {
    out.push({ field, op, value })
  }
  const q = params.get("q")
  if (q) add("q", "contains", q)
  const ct = params.get("contactType")
  if (ct) add("contactType", "eq", ct)
  const lcs = params.get("lifecycleStatus")
  if (lcs) add("lifecycleStatus", "eq", lcs)
  const tagsRaw = params.get("tags")
  if (tagsRaw) add("tags", "in", tagsRaw.split(",").filter(Boolean))
  const ownerUserId = params.get("ownerUserId")
  if (ownerUserId) add("ownerUserId", "eq", ownerUserId)
  const companyId = params.get("companyId")
  if (companyId) add("companyId", "eq", companyId)
  const leadSource = params.get("leadSource")
  if (leadSource) add("leadSource", "eq", leadSource)
  const createdFrom = params.get("createdFrom")
  if (createdFrom) add("createdAt", "gte", createdFrom)
  const createdTo = params.get("createdTo")
  if (createdTo) add("createdAt", "lte", createdTo)
  if (params.get("hasPhone") === "true") add("primaryPhone", "is_not_null", null)
  if (params.get("hasEmail") === "true") add("primaryEmail", "is_not_null", null)
  const laFrom = params.get("lastActivityFrom")
  if (laFrom) add("lastActivity", "gte", laFrom)
  const laTo = params.get("lastActivityTo")
  if (laTo) add("lastActivity", "lte", laTo)
  const otFrom = params.get("openTasksFrom")
  if (otFrom) add("openTasks", "gte", otFrom)
  const otTo = params.get("openTasksTo")
  if (otTo) add("openTasks", "lte", otTo)
  for (const [key, value] of params.entries()) {
    if (!key.startsWith("cf:")) continue
    const [, fieldId, op] = key.split(":")
    // Map drawer-side ops to canonical Filter.op values where they
    // diverge (drawer uses "from"/"to"/"min"/"max" for ergonomics;
    // canonical uses gte/lte for numeric and date).
    if (!fieldId || !op) continue
    const canonicalOp: Filter["op"] | null =
      op === "contains"
        ? "contains"
        : op === "eq"
          ? "eq"
          : op === "in"
            ? "in"
            : op === "min" || op === "from"
              ? "gte"
              : op === "max" || op === "to"
                ? "lte"
                : null
    if (canonicalOp) add(`customField.${fieldId}`, canonicalOp, value)
  }
  return out
}

function serializeSortFromParams(params: URLSearchParams): Sort | null {
  const sort = params.get("sort")
  if (!sort) return null
  const [field, direction] = sort.split(":")
  if (!field) return null
  return { field, direction: direction === "desc" ? "desc" : "asc" }
}

// Re-export the column registry & defaults for any consumer that needs them.
export { CONTACT_COLUMN_REGISTRY }
