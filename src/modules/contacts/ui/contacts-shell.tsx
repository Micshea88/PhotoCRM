"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  SavedViewsTabStrip,
  type SavedViewTab,
} from "@/modules/saved-views/ui/saved-views-tab-strip"
import type { OrgMember } from "@/modules/saved-views/ui/visibility-modal"
import type { Filter, Sort } from "@/modules/saved-views/types"
import { ContactsActionsDropdown } from "./contacts-actions-dropdown"
import { ContactsFilterBar } from "./contacts-filter-bar"
import { ContactsPagination } from "./contacts-pagination"
import { ContactsTable, type ContactRow } from "./contacts-table"
import { EditColumnsDrawer } from "./edit-columns-drawer"
import { MoreFiltersDrawer, type CustomFieldDef } from "./more-filters-drawer"
import { SelectionBanner } from "./selection-banner"
import { CONTACT_COLUMN_REGISTRY, type ColumnConfigItem } from "./columns"
import type { ContactsPageSize } from "../pagination"

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
  /** Total matching rows, capped at CONTACTS_LIST_HARD_CAP. */
  totalCount: number
  /** True when the unfiltered match set crossed 10k — host renders refine-filters banner. */
  cappedOut: boolean
  /** Current page (1-indexed). */
  page: number
  /** Active page size (25 / 50 / 100). */
  pageSize: ContactsPageSize
  /** Available saved views the user can see (tab strip + dirty state). */
  views: SavedViewTab[]
  /** Per-user pinned saved-view ids. Renders verbatim in the tab strip. */
  pinnedViewIds: string[]
  /** Per-user "set as my default" view id, or null to fall back to All Contacts. */
  defaultViewId: string | null
  /** True if a prefs row exists for this user+contact. Drives auto-pin behavior. */
  hasPrefsRow: boolean
  /** id → createdAt ISO for the Manage views drawer's Created sort. */
  createdAtById: Record<string, string>
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
  cappedOut,
  page,
  pageSize,
  views,
  pinnedViewIds,
  defaultViewId,
  hasPrefsRow,
  createdAtById,
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
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

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

  // ── Selection state for bulk actions (Push 2c Part 2) ───────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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

  return (
    <div className="space-y-4">
      {/*
       * Push 2c.2 — page header lifted into the shell so the top-right
       * toolbar (Actions / Import / New contact) can share state with
       * the Edit columns drawer below. The page itself is a server
       * component and can't open the drawer without prop-drilling.
       */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            People — the permanent record. Switch views to slice the list, customize columns, or
            save a new view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ContactsActionsDropdown
            onOpenEditColumns={() => {
              setEditColumnsOpen(true)
            }}
          />
          <Link href="/contacts/import">
            <Button variant="outline">Import</Button>
          </Link>
          <Link href="/contacts/new">
            <Button>New contact</Button>
          </Link>
        </div>
      </div>

      <SavedViewsTabStrip
        views={views}
        activeViewId={activeViewId}
        pinnedViewIds={pinnedViewIds}
        defaultViewId={defaultViewId}
        hasPrefsRow={hasPrefsRow}
        createdAtById={createdAtById}
        currentUserId={currentUserId}
        objectType="contact"
        members={members}
        isDirty={isDirty}
        currentState={currentState}
        onDiscard={() => {
          // Discard = revert to the view's saved state: clear all URL
          // filter overrides (everything except ?view=) AND reset client
          // column state to the active view's columnConfig.
          setColumnConfig(activeView?.columnConfig ?? [])
          startTransition(() => {
            router.push(activeViewId ? `${pathname}?view=${activeViewId}` : pathname)
          })
        }}
      />

      <ContactsFilterBar
        tagOptions={tagOptions}
        ownerOptions={ownerOptions}
        companyOptions={companyOptions}
        leadSourceOptions={leadSourceOptions}
        hiddenLeadSources={hiddenLeadSources}
        trailingChips={
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
        }
      />

      {/*
       * Push 2c.2 — selection banner replaces the "Actions" dropdown's
       * 1+-selected face. The 0-selected face's org-level items moved
       * to the top-header ContactsActionsDropdown above.
       */}
      <SelectionBanner
        selectedIds={[...selectedIds]}
        ownerOptions={ownerOptions}
        tagOptions={tagOptions}
        companyOptions={companyOptions}
        leadSourceOptions={leadSourceOptions}
        onClear={() => {
          setSelectedIds(new Set())
        }}
      />
      {selectedIds.size === 0 && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {String(totalCount)} contact{totalCount === 1 ? "" : "s"}
        </p>
      )}

      {cappedOut ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6 text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-200">
            Too many matches to display
          </p>
          <p className="mt-1 text-amber-700 dark:text-amber-300">
            More than 10,000 contacts match the current filters. Refine your filters (or pick a
            narrower saved view) to bring the list under the cap, or export your full dataset from
            Settings.
          </p>
        </div>
      ) : contacts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No contacts match the current filters.
          </p>
        </div>
      ) : (
        <>
          <ContactsTable
            rows={contacts}
            columnConfig={columnConfig}
            onColumnConfigChange={setColumnConfig}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            customFieldDefs={customFieldDefs}
          />
          <ContactsPagination totalCount={totalCount} page={page} pageSize={pageSize} />
        </>
      )}

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
        customFieldDefs={customFieldDefs}
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
