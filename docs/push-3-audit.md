# Push 3 Audit (C1)

Investigation-only doc. Captures the current state of every system Push 3
will touch across C2–C7. Source-of-truth for the C2–C7 prompts.

Each section: **current state** → **C-commit assignment** → **recommendations** → **stop-and-ask items if any**.

---

## STOP-AND-ASK SUMMARY (read first)

1. **AI infrastructure already exists** — see §14. `src/lib/ai-model.ts` ships
   `callAiModel({systemPrompt, userPrompt})` against Anthropic SDK with
   graceful disable; `src/modules/ai-assistant/` is a full module with
   retrievers / route catalog / message persistence / write-proposal
   confirmation flow. The Mike-locked decision _"Provider: Anthropic ONLY,
   AIProvider abstraction"_ is mostly already delivered. **C6 should extend
   the existing surface (add model-tier selection + cf-summary/status
   prompts), not rebuild.** Confirm.

2. **RBAC roles disagreement.** The codebase ships 6 EXTENDED_ROLES
   (`owner / admin / manager / user / accountant / client`). The Push 3
   locked decision says 4 roles (User / Manager / Admin / Owner). The
   extras:
   - `accountant`: financial-tables access; no contact-edit perms by
     default. Per the locked spec it would be treated as "view-only on
     contacts" (similar to User-but-not-owner). Confirm.
   - `client`: V2 client-portal placeholder, no perms in V1.
     `INVITABLE_EXTENDED_ROLES` already excludes `client` from the
     internal-team invite picker. Should C6 just treat `client` as
     "no contact-detail view at all"? Confirm.

3. **Push 3 partially shipped findings (skip duplicate work in C2–C7):**
   - **§3 contact-form headers**: NO "Contact channels" or "Dates"
     section header exists. Current headers are _Identity / Companies /
     Communication / Address / Social profiles / Lead generation / Notes
     / Custom fields_. dob + anniversary are inline (no separate "Dates"
     section). ✅ Already clean.
   - **§6 lead-source combobox**: `src/modules/contacts/ui/lead-source-combobox.tsx`
     is **already a typeahead combobox** with seeded defaults + custom
     values + inline "Add new" affordance. C3 should skip this field
     entirely.
   - **§14 AI module**: see item 1 above.

4. **CSV import bypasses `createContact`.** The dedup HARD BLOCK in C4
   needs TWO touchpoints, not one:
   - `createContact` / `updateContact` (form path via contact-form.tsx)
   - `runContactsImport` server action (bypasses the createContact path,
     calls `ctx.db.insert(contacts)` directly)
   - The DB-level partial-unique constraint (migration) is the
     load-bearing protection; action-level checks are friendlier UX.

5. **`callLog` table already supports the activity-feed source flag**
   (`source: "manual" | "ringcentral"`). C6 doesn't need to migrate
   it. SMS table + meetings table do need to be created.

6. **Companies merge schema gotcha** (already documented in Push 4
   B2's commit): `companies_org_name_uidx` partial-unique blocks
   same-name companies in one org organically. Push 4's company merge
   handles the edge case; C7's UI rebuild doesn't reopen it.

---

## §1. App nav sidebar (C2 target)

**Current state:**

- Components:
  - `src/modules/org/ui/app-sidebar.tsx` — Server Component. Exports
    `resolveSidebarItems(userId, extendedRole)` + the sync `<AppSidebar />`
    renderer. Permission-gates each entry via `hasPermission()` +
    OWNER_ADMIN_ONLY_SIDEBAR allowlist.
  - `src/modules/org/ui/app-sidebar-nav.tsx` — `"use client"`.
    `usePathname`-driven active-state highlighting. Lucide icons mapped
    server-side by string key, resolved client-side (server can't pass
    forwardRef across the boundary).
- Mounted in `app/(app)/layout.tsx` inside a CSS grid:
  `grid-cols-[240px_1fr] grid-rows-[56px_1fr]`. **Fixed 240px width**;
  no collapse state exists.
- Entries (in order, with permission gates):
  Dashboard, Contacts, Events, Pipeline, Tasks, Settings, Custom fields.
- Items are **route-driven**: each entry resolves to a `ROUTE_CATALOG`
  entry in `src/modules/ai-assistant/route-catalog.ts`. Single source of
  truth shared with the AI assistant's `navigate` capability.
- Pages without the sidebar: anything under `app/(auth)/` (sign-in /
  sign-up / accept-invite / forgot / reset / verify) — separate route
  group, no `(app)/layout.tsx` ancestor. Onboarding has the sidebar but
  the layout `return <>{children}</>` short-circuits when the user has
  no org membership.
- No mobile responsive treatment. Sidebar renders at the same 240px on
  every viewport. No bottom-nav exists.
- No `user_preferences` table for nav state. localStorage isn't used
  for the sidebar today.

**C2 recommendations:**

- Add a collapse toggle. Persist state in **localStorage**
  (`pathway:nav-collapsed` key) — simpler than a new table, no
  migration, and the spec's locked decision allows either.
- Change layout grid to dynamic widths: `grid-cols-[var(--nav-w)_1fr]`
  with a CSS variable swapped on collapse. Collapsed width ~64px (icons
  only). Animation via CSS transition on width.
- Mobile breakpoint (`md`): hide sidebar entirely below 768px, render a
  fixed bottom-nav row instead. Bottom nav items per locked spec:
  Home / Contacts / Tasks / Dashboards / Search. Tap-target = 44px+
  (iOS HIG). Active-state highlight reuses the same `usePathname` hook.
- The `MD_DASHBOARDS_ITEM_IDS` constant should align to current
  catalog entries — Dashboards = dashboard route; Search is new (need
  a `/search` route or a search modal-trigger).
- **C2 stop-and-ask**: should "Search" be a route or a global search
  modal triggered from the bottom-nav button? Confirm in C2 prompt.

---

## §2. Contact detail page (C6 target)

**Current state:**

- `app/(app)/contacts/[id]/page.tsx` — Server Component. Loads
  contact, company join, associations, custom field defs, optional
  referred-by row. Layout is `<div className="mx-auto max-w-4xl">`
  single column.
- `src/modules/contacts/ui/contact-tabs.tsx` — `"use client"`.
  **5 tabs**: Overview / Companies / Events / Tasks / Activity.
  In-component `useState<ContactTabKey>("overview")` — no URL
  persistence.
- Sections rendered in OverviewPane:
  Communication, Address, dob+anniversary (no section title — just
  field rows), Social profiles, Lead generation, Notes (notes +
  internalNotes), Custom fields (from A3's read-only renderer wired
  in — verified).
- CompaniesPane renders primary + associations.
- Events / Tasks / Activity panes are **empty placeholders**:
  `<EmptyPane label="...ships in PUSH 3..." />` — Push 3 is the planned
  fulfillment.
- Edit form: `app/(app)/contacts/[id]/edit/page.tsx` exists (reuses
  contact-form.tsx). Detail page Edit button links there.
- No mobile responsive treatment — `max-w-4xl` only.
- No Actions dropdown on the detail page. Top-right just has Edit /
  Archive / Delete buttons.

**C6 recommendations:**

- 3-column layout (desktop ≥ md):
  - Left column: contact header + action buttons row + "About this
    contact" inline-editable fields + "View all properties" link.
  - Center column: 3 tabs (Overview / Activity / To-Do's per locked
    spec; replaces current 5 tabs).
  - Right column: Companies / Events / Financials / Files sections,
    each collapsible.
- Mobile (< md): single-column tabbed layout: Activity / Associations
  / About (3 tabs). Top-row action circles. Bottom nav.
- The 5-tab `ContactTabs` component will be **replaced** in C6 (not
  extended). Tabs change from {Overview, Companies, Events, Tasks,
  Activity} → {Overview, Activity, To-Do's}. Companies/Events/Tasks
  move to right-sidebar sections; completed Tasks move to Activity
  filter; upcoming Tasks move to To-Do's tab.
- Detail page Actions dropdown (NEW in C6 / C7): add Edit / Archive /
  Delete / **Merge with...** items. C7 spec calls for the manual
  merge trigger from here.

---

## §3. Contact form (C4 / dedup target)

**Current state:**

- `src/modules/contacts/ui/contact-form.tsx` (~845 lines).
- Section headers (h2's): Identity / Companies / Communication /
  Address / Social profiles / Lead generation / Notes / Custom fields.
  **No "Contact channels" or "Dates" headers** — Mike's instinct that
  these had been cleaned up is correct. ✅
- Server actions: `createContact` (line 283 callsite) +
  `updateContact`. Defined in `src/modules/contacts/actions.ts`.
- Validation: action-side via Zod (`createContactInput` /
  `updateContactInput`). The form's onSubmit calls the action and
  rendered errors via `setError(result.serverError)` toast/banner.
  Per-field error rendering is minimal — server returns a single
  string, surfaced near the submit button.
- **Current dedup behavior**: no pre-write check on `primary_email` or
  `primary_phone`. `createContact` will INSERT even if the email
  matches an existing active contact. The action does call
  `assertCompanyInOrg()` for company FK validity, but no email/phone
  uniqueness.
- `src/modules/contacts/schema.ts` indexes (relevant):
  - `contacts_org_email_idx` — non-unique index on `(organizationId, primaryEmail)`
  - **No unique constraint** on email or phone
- Inline-create from CompanyPicker exists (Push 2 work) — Companies
  section in form has "+ Add company" inline modal that calls
  `createCompany` from inside the form.

**C4 recommendations:**

- Add migration: partial unique on `(organization_id, lower(primary_email)) WHERE deleted_at IS NULL AND primary_email IS NOT NULL`.
- Phone unique: needs a generated column or expression index on
  `parsePhoneInput(primary_phone)` normalized form — Drizzle has
  limited support; easiest is an expression index via raw SQL in the
  migration (`CREATE UNIQUE INDEX ... ON contacts (organization_id, regexp_replace(primary_phone, '\D', '', 'g')) WHERE deleted_at IS NULL AND primary_phone IS NOT NULL`).
- Action layer: extend `createContact` + `updateContact` to query
  existing active contacts by normalized email + phone BEFORE the
  insert. On match: throw `ActionError("CONFLICT", "...")` with a
  payload the form reads + renders the "Go to existing contact" modal.
- Modal UX: pre-write detection client-side could also fire on
  blur of email/phone field (debounced) for instant feedback before
  submit — soft check; server is authoritative.
- Secondary email/phone: per Mike's spec, these are also checked. Same
  query — server returns ALL matches across primary+secondary for both
  fields.
- ContactRefPicker today has **NO inline-create** affordance.

---

## §4. All contact-create paths (C4)

Enumerated paths that can create or update a contact:

| Path                                | File                                                                         | Action called                                                          | Bypasses validation?                             |
| ----------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| `/contacts/new` form submit         | `src/modules/contacts/ui/contact-form.tsx:283`                               | `createContact`                                                        | No (uses createContact)                          |
| `/contacts/[id]/edit` form submit   | `src/modules/contacts/ui/contact-form.tsx:283` (same component, edit branch) | `updateContact`                                                        | No                                               |
| **CSV import**                      | `src/modules/contacts/import-actions.ts:runContactsImport` (~line 480)       | **`ctx.db.insert(contacts)` direct** — bypasses `createContact` action | **YES — bypasses**                               |
| Bulk-update from /contacts list     | `src/modules/contacts/actions.ts:bulkUpdateContactFields`                    | Direct UPDATE, no email/phone change                                   | N/A (doesn't touch identifying fields typically) |
| Inline-create from ContactRefPicker | **Does not exist today**                                                     | —                                                                      | —                                                |
| API endpoints under `app/api/`      | None for contacts; routes confined to auth/blob/cron/files/jobs              | —                                                                      | —                                                |

**C4 implications:**

- The dedup HARD BLOCK must fire BOTH in:
  - `createContact` / `updateContact` (form path)
  - `runContactsImport` (CSV path — currently has "update existing" via
    `matchedContactId`, but the matching logic is email-priority + phone
    fallback; align with the new normalized-unique behavior)
- The DB partial-unique constraint is the load-bearing safety net for
  all paths.

---

## §5. Pre-write dedup schema + race safety (C4)

**Current state:**

- contacts indexes (full inventory):
  - `contacts_org_deleted_created_idx`
  - `contacts_org_type_deleted_idx`
  - `contacts_org_company_deleted_idx`
  - `contacts_tags_gin_idx`
  - `contacts_custom_fields_gin_idx`
  - `contacts_org_email_idx` (NON-unique, regular B-tree)
  - `contacts_org_archived_deleted_idx`
- **No unique constraint exists** on email or phone. C4 needs to add.

**C4 migration shape recommendation:**

```sql
-- Partial unique on org+lower(email) excluding soft-deleted rows.
-- Allows a soft-deleted row to keep its email while a new active
-- contact reuses it (matches the soft-delete recycle pattern).
CREATE UNIQUE INDEX "contacts_org_lower_email_uidx"
  ON "contacts" ("organization_id", LOWER("primary_email"))
  WHERE "deleted_at" IS NULL AND "primary_email" IS NOT NULL;

-- Same for phone, normalized to digits-only.
CREATE UNIQUE INDEX "contacts_org_normalized_phone_uidx"
  ON "contacts" ("organization_id", regexp_replace("primary_phone", '\D', '', 'g'))
  WHERE "deleted_at" IS NULL AND "primary_phone" IS NOT NULL;
```

- These need to be hand-written in the migration SQL (Drizzle's
  `uniqueIndex` doesn't support expression indexes directly via the
  schema builder — same pattern as existing migrations).
- **Secondary email/phone**: per Mike's spec, also checked. Adding
  unique constraints on secondary fields is wrong (same person can
  have the same secondary phone as someone else's primary); the
  action-level check should query against both primary + secondary
  for completeness. **No DB constraint for secondary.**

---

## §6. Dropdown inventory (C3)

**ALREADY searchable / combobox (skip in C3):**

- `src/modules/custom-fields/ui/user-ref-picker.tsx` — UserRefPicker
- `src/modules/custom-fields/ui/contact-ref-picker.tsx` — ContactRefPicker
- `src/modules/companies/ui/company-picker.tsx` — CompanyPicker (with
  inline "+ Add company" modal)
- `src/modules/contacts/ui/lead-source-combobox.tsx` — **ALREADY a
  combobox** with seeded defaults + custom values + "+ Add new"
  inline input. Used on /contacts/new form AND the filter chip.

**NEEDS upgrade in C3** (currently native `<select>` in
`contact-form.tsx`):

- **Contact type** (line 684 area) — native select, fixed enum from
  `CONTACT_TYPES`
- **Lifecycle status** (line 702 area) — native select, fixed enum
- **Owner** (line 720 area) — native select of org members; **should
  be searchable** when team grows
- **Referred by** (line 752 area) — native select; **should reuse
  ContactRefPicker** from A3
- **Country/state** — not currently used in contact form (address is
  just text inputs)

**Filter bar (`src/modules/contacts/ui/contacts-filter-bar.tsx`):**

- 4 native `<select>` elements (lines 166, 183, 239, 263) —
  contactType / lifecycleStatus / ownerUserId / companyId
- These are short fixed-list filter chips — could stay native for V1
  list filter ergonomics, OR upgrade for consistency. Recommend
  upgrade to searchable since owner + company are unbounded.

**Tags input** (line ~770 area, just before Notes section):

- Currently a plain `<Input>` with comma-separated string parsing
  (line ~565 `tagsRaw` state, parsed on submit).
- **Not a multi-select combobox** with chip rendering + autocomplete
  against existing org tags. C3 spec calls for true multi-select.

**Should stay native (short fixed lists):**

- Yes/No toggles (checkboxes already)
- Workflow status enums (when those modules ship)

**Recommendation for C3:**

- Build a generic `SearchableSelect` primitive in
  `src/components/ui/searchable-select.tsx`, modeled on UserRefPicker
  (filter input above native select). Reuse for owner, contact type,
  lifecycle status, referred-by, filter-bar dropdowns.
- Build `TagsCombobox` separately — different shape (multi-select +
  chip render + autocomplete from `listDistinctContactTags`).
- The lead-source-combobox stays as-is.

---

## §7. CSV import preview (C5)

**Current state:**

- `src/modules/contacts/ui/contacts-import-wizard.tsx:PreviewStep`
- Per-row "Match / dup" column shows:
  - "—" for no match
  - Matched contact name (clickable in a future iteration)
  - "Duplicate of row N" (amber) for CSV-internal duplicates
- Per-row Action dropdown: "Create new" / "Update existing" / "Skip".
  - Default for **matched rows**: `"update"` (set by
    `proposedAction` in `previewContactsImport`). ✅ Already matches
    Mike's locked decision.
- Bulk "Set all matched to..." + "Set all unmatched to..." controls
  exist.
- Warning surface: amber summary banner at top
  ("N rows look like duplicates of earlier rows in this CSV").
- Match detection: `previewContactsImport` action in
  `src/modules/contacts/import-actions.ts` uses:
  - email exact (LOWER comparison via inArray)
  - phone normalized digits (via `parsePhoneInput`)
- **Internal-CSV duplicate detection**: `findCsvInternalDuplicates`
  in `import-spec.ts` flags rows that duplicate each other within
  the upload (by normalized email or phone).

**C5 recommendations:**

- Mike's spec: red TEXT (not banner) warning. Today's banner is
  amber. **Swap to red text inline near matched rows** or as a
  per-row indicator. The existing summary banner can stay; the
  per-row indicator is the new affordance.
- Default Action for matched rows is already "update" ✅
- Per-row skip control already exists ✅
- The match algorithm is already email + phone — matches the
  pre-write hard-block in C4. Consistency check: when C4's
  `createContact` rejects on dedup, the import should be the
  authoritative same-shape check.

---

## §8. Merge modal (B2, C7 rebuild target)

**Current state (Push 4 B2):**

- `src/modules/duplicates/ui/merge-contact-modal.tsx`
- `src/modules/duplicates/ui/merge-company-modal.tsx`
- Shape: conflict-rows-only with primary picker at top + per-row
  radios per conflicting field.
- Rows where all records share the same value are HIDDEN
  (not rendered).
- Two-phase: Compare → Confirm.
- `fieldChoices` API accepts arbitrary intrinsic keys + `cf:<defId>`
  for custom fields. Confirmed by reading
  `src/modules/duplicates/merge-engine.ts` — `pickFieldValue` is a
  generic that resolves any keyof T.
- Tags mode: union | use-from. Companies-mode: union | use-from.
- Manual merge trigger: **does not exist** on /contacts/[id] today.
  Actions menu on /contacts list has "Manage duplicates" → routes to
  /contacts/duplicates auto-detection page. No "Merge with..." entry.

**C7 recommendations:**

- New side-by-side full-record UI replaces the current conflict-only
  layout.
- Reuses the SAME `executeContactMerge` engine (from B2 — no engine
  changes). Only the UI layer rebuilds.
- The C7 modal renders ALL fields (intrinsic + custom + tags +
  associations) as columns per record. "Set as primary" floating
  button + click-any-cell-to-pick the row's value for that field.
  Reuses C6's `InlineEditField` primitive for the cell renderers.
- Manual "Merge with..." trigger: add Actions dropdown on
  /contacts/[id] → opens contact search picker (reuses ContactRefPicker
  styling) → after pick, opens the merge modal pre-populated with
  current contact + selected target.

---

## §9. Modal pattern (C6 inline modals)

**Current state:**

- `components/ui/modal.tsx` — minimal portal-less modal. Backdrop
  click + Esc to close. No focus trap. ~60 lines.
- 9 callsites:
  - save-view-modal.tsx (form)
  - visibility-modal.tsx (form)
  - custom-field-editor.tsx (form)
  - pending-invitations.tsx, incomplete-signups.tsx (forms)
  - selection-banner.tsx (delete confirm wrapped)
  - merge-contact-modal.tsx, merge-company-modal.tsx (multi-phase)
  - company-picker.tsx (inline-create form)
- `components/ui/delete-confirm-modal.tsx` — type-to-confirm modal
  for destructive actions.
- **No tabbed-modal primitive** exists. The CSV import wizard has a
  4-step flow but built ad-hoc.
- `components/ui/drawer.tsx` exists for right-side slideouts (Edit
  columns drawer, More filters).

**C6 recommendations:**

- Add a tabbed-modal primitive: `<TabbedModal />` that takes tabs
  `[{ key, label, content }]` and switches body. Used for right-
  sidebar "+ Add" → "Create new" / "Add existing" pattern in C6.
- The simplest implementation: extend the existing `<Modal>` with a
  tabs strip at the top — no need for a new primitive if Modal stays
  generic + a `TabsHeader` component handles the strip.
- Inline-create pattern in `company-picker.tsx` is the reference
  for "Create new" tab body. C6 reuses this pattern for the right-
  sidebar's Add Company / Add Event / Add Note / Add Call modals.

---

## §10. Inline editing (C6)

**Current state:**

- **No inline-edit primitives exist anywhere in the codebase.** Grep
  for `inline-edit` / `editable-field` / `isEditing` returns only
  unrelated hits.
- All field editing today is full-form via contact-form.tsx — user
  navigates to /contacts/[id]/edit, edits everything, submits.
- Vercel Blob upload pattern in `src/modules/custom-fields/ui/custom-fields-renderer.tsx`:
  uses `@vercel/blob/client` `upload()` to /api/blob/upload, stores
  the returned URL. Reusable for inline file/image edit.
- `mailing_address` is a `jsonb` column. In contact-form.tsx it's
  currently edited via FOUR separate `<Input>` elements
  (`street1`, `city`, `state`, `zip`) with `buildMailingAddress()`
  assembling the jsonb on submit.

**C6 recommendations:**

- Build `<InlineEditField />` primitive in
  `src/components/ui/inline-edit-field.tsx`. Props:
  `value`, `onSave(next)`, `inputType` (text/email/phone/url/date/select/textarea),
  optional `options` for select. Behavior: click to enter edit mode,
  Enter to save, Esc to cancel, click outside also commits (per
  Mike's locked decision).
- Variants:
  - `<InlineEditText />` (single-line)
  - `<InlineEditTextarea />` (multiline — notes/internalNotes)
  - `<InlineEditSelect />` (for picker-style fields — reuses C3's
    SearchableSelect)
  - `<InlineEditFile />` (reuses Vercel Blob upload pattern)
  - `<InlineEditAddress />` (for mailing_address jsonb — sub-form
    modal triggered from the inline cell. Recommend sub-modal over
    multi-input because nested-jsonb inline is unwieldy.)
- Each variant calls a dedicated `updateContactField` action OR the
  general `updateContact` action with the single-field patch.
  **Recommend: keep the existing `updateContact` action** with its
  zod inputSchema; the inline-edit primitive sends a partial patch
  via the same action. No new action needed.

---

## §11. Activity feed raw data (C6)

**Current state — audit_log action strings (full inventory, 60+ unique values):**

- contacts: create, created, update, updated, delete, deleted,
  archive, archived, unarchive, unarchived, restore, restored,
  bulk_add_tag, bulk_remove_tag, bulk_change_type, bulk_change_status,
  bulk_change_owner, bulk_delete, bulk_restore, bulk_restored,
  bulk_update_fields, merged, duplicates_scan, duplicates_scanned
- companies: create, created, update, updated, delete, deleted,
  restore, restored, merged, duplicates_scan, duplicates_scanned
- opportunities: create, created, update, updated, delete, deleted,
  restore, restored, mark_won, mark_lost, won, lost, move_stage,
  stage_moved
- projects: create, created, etc. (similar shape)
- tasks: create, created, etc.
- items: create, created, update, updated, delete, deleted, restore, restored
- files: delete, deleted
- custom_field_definitions: created, updated, archived, unarchived,
  deleted, restored, reordered
- ai_assistant_messages: turn, ... (from the assistant module)
- All entries carry `resourceType` + `resourceId` + optional
  `metadata` jsonb.

**contact_notes table:**

- Schema in `src/modules/contacts/schema.ts` — `contact_notes` table.
  Columns: id, organizationId, contactId, body, createdAt, updatedAt,
  createdBy, updatedBy, deletedAt, deletedBy.
- Read/write paths exist (per A2 — read via queries.ts, write via
  actions.ts).

**call_log table:**

- `src/modules/calls/schema.ts`. Columns: id, orgId, contactId,
  userId, direction (inbound/outbound), startedAt, durationSeconds,
  notes, recordingFileId (FK to files), source (manual/ringcentral),
  externalId, externalMetadata.
- ✅ Already supports both manual logging AND RingCentral integration
  shape. Partial-unique on `(org, externalId) WHERE source='ringcentral'`
  prevents duplicate webhook deliveries.

**Missing tables:**

- **No `meetings` table.** C6 needs to create one (placeholder for
  Push 8 Calendar's AI meeting assistant). Minimal shape: id, orgId,
  contactId nullable, eventProjectId nullable, scheduledAt,
  durationMinutes, title, status (scheduled/completed/cancelled),
  source (manual/zoom/google), externalId, externalMetadata,
  summaryText nullable (filled by Push 8 AI assistant), createdBy,
  createdAt, updatedBy, updatedAt, deletedAt, deletedBy. Soft-delete
  - audit columns standard.
- **No `sms_messages` table.** C6 needs to create one (placeholder
  for future RingCentral SMS sync). Minimal shape: id, orgId,
  contactId nullable, userId nullable (who sent if outbound),
  direction (inbound/outbound), body, sentAt, source (manual/ringcentral),
  externalId, externalMetadata, audit columns.
- The Activity tab filter chips show: Emails / Notes / Calls /
  Meetings (completed) / Tasks (completed) / SMS. All except Emails
  - SMS have backing tables today; Emails + SMS get placeholder
    tables in C6 (Emails ships when email integration lands; for
    Push 3 the Emails filter shows "0 emails — connect Gmail/Outlook
    to sync" empty state).

**Activity feed query recommendation:**

- A unified read query that UNIONs audit_log + contact_notes +
  call_log + meetings + sms_messages, filtered by contact_id,
  ordered by created_at DESC, with a discriminator column for the
  filter chips.
- Pagination: cursor-based on created_at, limit 50 per page.

---

## §12. Tabs structure (C6)

**Current state:** 5-tab `ContactTabs` component in
`src/modules/contacts/ui/contact-tabs.tsx` — Overview / Companies /
Events / Tasks / Activity. State via `useState`, no URL persistence.

**C6 target:** REPLACE with 3 tabs — Overview / Activity / To-Do's.

- Companies, Events, Tasks become RIGHT SIDEBAR sections (not center
  tabs).
- Completed Tasks → Activity tab filter chip.
- Upcoming Tasks → To-Do's tab.
- The `ContactTabKey` enum gets rewritten; saved-view-style
  persistence is N/A for this component.

**Touch point:** entire `contact-tabs.tsx` replaced. The detail
page's prop-drilling of `overview / companies / events / tasks /
activity` reduces to `overview / activity / todos` + right sidebar
prop set.

---

## §13. RBAC on inline editing (C6)

**Current state:**

- `src/modules/rbac/types.ts` ships `EXTENDED_ROLES` as 6 values:
  `["owner", "admin", "manager", "user", "accountant", "client"]`.
  Locked spec calls for 4 (User / Manager / Admin / Owner).
- `INVITABLE_EXTENDED_ROLES` is 4 values:
  `["admin", "manager", "user", "accountant"]` — excludes owner (org
  creator) and client (V2 portal).
- `ROLE_DEFAULTS` map in `src/modules/rbac/queries.ts` — sets
  per-role permission grants. `manager` has `manage_settings`; `user`
  is the standard team-member tier.
- Permission enforcement happens in **the action wrapper**
  (`src/lib/safe-action.ts:orgAction`) at the membership / org level
  only. Per-action permission gating is the responsibility of the
  individual action body via `assertOwnerOrAdmin()`-style helpers
  (used in /settings/custom-fields, /contacts/duplicates).
- **No field-level RBAC enforcement** on contact edits today. A
  User-role member can call `updateContact` and change anything
  (owner_user_id, lifecycle status, etc.) on any contact they can
  see. RLS scopes visibility to the org; assignment-scoped overlay
  applies via the role policies on `contacts` table for `user` role
  reads (see `src/db/migrations/0015_assignment_scoped_rls_overlay.sql`).
- Read-only fields by convention (no code enforcement): id,
  created_at, created_by, updated_at, updated_by, organization_id,
  mergedRecordIds (per Push 4 — merge engine writes only).

**C6 recommendations + STOP-AND-ASK:**

- Implement field-level RBAC checks inside `updateContact`:
  - If actor's role is `user` AND `contact.ownerUserId !== actor.id`:
    reject with FORBIDDEN.
  - If actor's role is `manager` / `admin` / `owner`: allow.
  - Confirm `accountant` treatment: locked spec doesn't mention
    accountant. **STOP-AND-ASK**: should accountant get User-equivalent
    contact edit perms (own only), full Manager-equivalent edit, or
    no contact edit at all?
- The InlineEditField primitive should render read-only mode (no
  click-to-edit affordance) when the user can't edit the field. The
  server-side check is authoritative; UI-side is UX.
- Fields that stay read-only regardless of role: id, created_at,
  created_by, updated_at, updated_by, organization_id,
  mergedRecordIds.
- Recommend: extend `safe-action.ts` with a `contactEditableBy(user, contact)`
  helper used by both the UI prop computation and the action
  validation.

---

## §14. AI integration architecture (C6)

**Current state — SUBSTANTIALLY ALREADY BUILT:**

- `src/lib/ai-model.ts`: exports `callAiModel({ systemPrompt, userPrompt })`
  using `@anthropic-ai/sdk`. Graceful disable when
  `ANTHROPIC_API_KEY` is missing — throws clear error, build doesn't
  fail. **Per the locked PIVOTS_LEDGER AI1 rule, this file is the
  ONE SDK importer, enforced by ESLint allowlist.**
- `src/lib/env.ts` already declares:
  - `ANTHROPIC_API_KEY` (optional)
  - `AI_WORKFLOW_BUILDER_MODEL` defaulting to `claude-sonnet-4-6`
  - Rate limit envs: `AI_WORKFLOW_BUILDER_HOURLY_USER`, etc.
- `src/modules/ai-assistant/`: full module —
  - `actions.ts`: `assistantTurn`, `confirmWriteProposal`, etc.
  - `prompt.ts`: system prompt builder
  - `retrievers.ts`: read-side capability allowlist
  - `route-catalog.ts`: navigate capability targets (shared with
    sidebar)
  - `schema.ts`: `ai_assistant_messages` table with conversation
    persistence + write-proposal lifecycle columns
  - `rate-limit.ts`: per-user / per-org hourly + daily limits
  - `render.ts`: client-side message renderer
- `src/modules/ai-workflow-builder/`: separate module for
  AI-drafted workflows.
- **Existing AI cost model** is per-user/org rate-limited via the
  envs.
- No existing `ai_*` columns on contacts. Locked spec proposes
  `ai_lead_status`, `ai_lead_status_reasoning`, `ai_summary_text`,
  `ai_insights_json`, `ai_generated_at`, `ai_generation_model` — no
  conflict with existing columns. Safe to add.

**C6 recommendations:**

- DO NOT rebuild the AI integration layer. EXTEND `callAiModel` in
  `src/lib/ai-model.ts`:
  - Add a `model` arg to select between Haiku (default for status/summary)
    and Sonnet (for complex Layer 3 insights).
  - Default model selection per task type.
  - Keep the single-SDK-import discipline (ESLint allowlist).
- Add a thin `src/lib/ai/` directory (or extend the existing pattern)
  with task-specific helpers:
  - `src/lib/ai/lead-status.ts` — classifier for the 19-status enum
  - `src/lib/ai/summary.ts` — paragraph generator for contact summary
  - `src/lib/ai/insights.ts` — Layer 3 starter insights
- Each task helper composes its prompt + calls `callAiModel` + parses
  the response. They are server-only (`"server-only"` import).
- New migration: add the 6 `ai_*` columns to contacts table.
- Cache regeneration triggers (per locked spec) implemented as a
  small policy module: `shouldRegenerateAiCache(contact, signal)`
  returns boolean.
- AI Help Module abstraction: the locked spec says the SAME
  integration powers future help module. The existing
  `assistantTurn` action in `src/modules/ai-assistant/actions.ts`
  IS the help-module surface (already supports navigate + retrieve +
  write-proposal). C6 just adds new retrievers for the new tasks; no
  new architecture.

**STOP-AND-ASK ITEMS for C6:**

- Confirm: extend existing `callAiModel` vs. build new `AIProvider`
  interface. (Recommendation: extend existing — the abstraction
  Mike asked for is already there in a different shape.)
- The locked spec mentions Claude **Haiku 4.5** + Sonnet 4.6. Confirm
  the model identifier strings used in C6 (e.g.,
  `claude-haiku-4-5-20251001` per the env defaults + the
  AGENTS.md guidance).

---

## §15. Schema gaps summary (across C2-C7)

| Commit | Migration needed?                                | What                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C2     | **No** (recommended: localStorage for nav state) | —                                                                                                                                                                                                                                                           |
| C3     | No                                               | —                                                                                                                                                                                                                                                           |
| **C4** | **YES** — single migration                       | Partial unique on `(org, lower(primary_email))` excluding soft-deletes; same shape for normalized primary_phone (digits-only via regexp_replace expression index). Both are hand-written SQL (Drizzle doesn't model expression indexes via schema builder). |
| C5     | No                                               | —                                                                                                                                                                                                                                                           |
| **C6** | **YES** — single migration                       | (a) 6 `ai_*` columns on contacts; (b) `meetings` table; (c) `sms_messages` table                                                                                                                                                                            |
| C7     | No (reuses Push 4 B2 merge engine)               | —                                                                                                                                                                                                                                                           |

**Migration numbering:** next available is `0033`. Recommend:

- `0033_push3_c4_contacts_pre_write_dedup.sql`
- `0034_push3_c6_meetings_sms_ai_columns.sql`

Single migration per commit. No bundling across commits.

---

## Appendix A — Files Push 3 will touch (synthesis)

| File / path                                                     | C2                | C3  | C4  | C5  | C6                   | C7           |
| --------------------------------------------------------------- | ----------------- | --- | --- | --- | -------------------- | ------------ |
| `app/(app)/layout.tsx`                                          | ✏️                |     |     |     |                      |              |
| `src/modules/org/ui/app-sidebar.tsx`                            | ✏️                |     |     |     |                      |              |
| `src/modules/org/ui/app-sidebar-nav.tsx`                        | ✏️                |     |     |     |                      |              |
| `src/modules/ai-assistant/route-catalog.ts`                     | ✏️ (add /search?) |     |     |     |                      |              |
| `components/ui/searchable-select.tsx` (new)                     |                   | ✨  |     |     |                      |              |
| `components/ui/tags-combobox.tsx` (new)                         |                   | ✨  |     |     |                      |              |
| `src/modules/contacts/ui/contact-form.tsx`                      |                   | ✏️  | ✏️  |     |                      |              |
| `src/modules/contacts/ui/contacts-filter-bar.tsx`               |                   | ✏️  |     |     |                      |              |
| `src/modules/contacts/actions.ts` (createContact/updateContact) |                   |     | ✏️  |     | ✏️                   |              |
| `src/modules/contacts/import-actions.ts`                        |                   |     | ✏️  | ✏️  |                      |              |
| `src/db/migrations/0033_*.sql` (new)                            |                   |     | ✨  |     |                      |              |
| `src/db/migrations/0034_*.sql` (new)                            |                   |     |     |     | ✨                   |              |
| `src/modules/contacts/ui/contacts-import-wizard.tsx`            |                   |     |     | ✏️  |                      |              |
| `app/(app)/contacts/[id]/page.tsx`                              |                   |     |     |     | ✏️ (major rebuild)   |              |
| `src/modules/contacts/ui/contact-tabs.tsx`                      |                   |     |     |     | ✏️ (replaced)        |              |
| `components/ui/inline-edit-field.tsx` (new)                     |                   |     |     |     | ✨                   |              |
| `components/ui/tabbed-modal.tsx` (new, or extend Modal)         |                   |     |     |     | ✨                   |              |
| `src/lib/ai-model.ts`                                           |                   |     |     |     | ✏️ (model selection) |              |
| `src/lib/ai/lead-status.ts` (new)                               |                   |     |     |     | ✨                   |              |
| `src/lib/ai/summary.ts` (new)                                   |                   |     |     |     | ✨                   |              |
| `src/lib/ai/insights.ts` (new)                                  |                   |     |     |     | ✨                   |              |
| `src/modules/meetings/` (new module)                            |                   |     |     |     | ✨                   |              |
| `src/modules/sms/` (new module)                                 |                   |     |     |     | ✨                   |              |
| `src/modules/duplicates/ui/merge-contact-modal.tsx`             |                   |     |     |     |                      | ✏️ (rebuild) |
| `src/modules/duplicates/ui/merge-company-modal.tsx`             |                   |     |     |     |                      | ✏️ (rebuild) |
| `app/(app)/contacts/[id]/page.tsx` Actions menu (Merge with...) |                   |     |     |     |                      | ✏️           |

✏️ = modify, ✨ = create.

---

## Appendix B — Audit log action strings to render in contact activity feed

Filter list for the Activity tab (sourced from audit_log unless
otherwise noted):

- **Notes** filter: `contact_notes` table rows (not audit_log)
- **Calls** filter: `call_log` table rows (not audit_log)
- **Meetings** filter (completed only): `meetings.status='completed'`
  rows (new table in C6)
- **Tasks** filter (completed only): from `tasks` table with
  `completed_at IS NOT NULL` AND `tasks.contactId = currentContactId`
  via the project_contacts join (when Push 7 wires tasks fully —
  for Push 3 the filter can render zero results gracefully)
- **SMS** filter: `sms_messages` table rows (new table in C6)
- **Audit events** filter (changes log): audit*log rows where
  resourceType='contact' AND resourceId = currentContactId, EXCLUDING
  noisy events like `duplicates_scan` / `bulk*\*`. Filter to:
  - contacts.created, contacts.updated (with metadata.customFieldChanges
    rendered as field-by-field diff lines), contacts.archived,
    contacts.unarchived, contacts.merged

---

End of audit.
