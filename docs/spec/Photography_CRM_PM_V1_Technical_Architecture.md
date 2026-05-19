# PHOTOGRAPHY CRM/PM — V1 TECHNICAL ARCHITECTURE

**Written against the verified stack** (repo `Micshea88/PhotoCRM`, "Pathway Foundation", audited 2026-05-18).
**Companions:** Requirements (what), Build Spec (modules + cost), Implementation Guide (how to build in this repo), Sprint Plan (order), Wireframes (UI), Template Library (content).
**This doc:** the concrete data model, schema, and engineering decisions in this stack's actual primitives — Drizzle, Better Auth org scoping, Postgres RLS, the `items` module pattern.

If the repo has diverged from the 2026-05-18 audit, re-audit before trusting specifics here.

---

## 1. ARCHITECTURE IN ONE PAGE

- **Tenancy:** Better Auth `organization` IS the studio account/workspace. Everything scoped by `organizationId`. No second tenancy concept.
- **Module shape:** every product feature is a clone of `src/modules/items/` — `schema.ts → types.ts → queries.ts → actions.ts → ui/ → README.md`. Schema re-exported from `src/db/schema.ts`. Routes under `app/(app)/<feature>/`.
- **Writes:** only through `orgAction` (`src/lib/safe-action.ts`). Resolves org + role, gives `ctx.db`, captures IP/UA, writes the audit row.
- **Reads:** only through a module's `queries.ts`. No DB access from `app/` (ESLint-blocked).
- **Isolation:** application-layer today (`orgAction`); the real guarantee is **Postgres RLS we add**, per table, in the same migration that creates the table.
- **Deletes:** soft-delete columns on every app table; the existing 90-day purge cron is the only hard-delete.
- **Audit:** append-only `audit_log` exists; every state change writes via `orgAction`.
- **Jobs:** Vercel Cron + `verifyCronAuth`. The substrate the recompute engine schedules on.
- **Files:** Vercel Blob, org-scoped, signed-token (the `src/modules/files/` pattern).
- **Email:** Resend for transactional/system mail (exists). Per-user Gmail/MS/IMAP OAuth for studio↔client mail is net-new.

Everything below is detail on this skeleton.

---

## 2. THE DATA MODEL (Drizzle tables, real types)

Conventions for every app table (non–Better-Auth): `id text primaryKey`, `organizationId text notNull references organization.id`, `createdAt`/`updatedAt` timestamptz, `createdBy`/`updatedBy`/`deletedAt`/`deletedBy` (soft-delete standard), `customFields jsonb` where the spec calls for custom fields. Index `(organizationId, deletedAt, createdAt desc)` as the foundation does on `items`.

Better Auth owns and we DO NOT modify: `user, session, account, verification, organization, member, invitation`. App-specific user/role data goes in **adjacent** tables keyed by those ids, never as new columns on Better Auth tables.

### 2.1 Identity & access (extends, never edits, Better Auth)

- **`member_role`** — `(id, organizationId, userId, role)`, role ∈ owner|admin|manager|photographer|contractor|editor|accountant|client_limited. Keyed to Better Auth `member`. Role transitions audited.
- **`member_permission_override`** — `(id, organizationId, memberId, permission_key, granted bool)`. Sparse: only rows differing from the role default (e.g. a manager granted financial visibility).
- **`terminology_map`** — `(id, organizationId, object_key, label_singular, label_plural)`. V1 seeds the photographer pack (`project→Event`). UI label resolver reads this; nothing hard-codes object display strings.

### 2.2 Core records (three-record model)

- **`contacts`** — `first_name, last_name, company_id (nullable FK→companies), primary_email, secondary_email, primary_phone, secondary_phone, mailing_address jsonb, dob, anniversary_date, instagram_handle, instagram_user_id, facebook_url, website, lead_source, source_detail, referred_by_contact_id, contact_type, lifecycle_status, tags text[], owner_user_id, custom_fields jsonb` + standard. Central display helper renders `"Last, First — Company"`, falling back to `"Name — primary_email"` when `company_id` is null.
- **`companies`** — lightweight reference, NOT a full object. `(id, organizationId, name, website, main_phone, instagram_handle, category)` + standard. Typeahead + inline-create. `website`/`main_phone` live here (shared by every contact at the company, entered once); the person's own phones stay on `contacts`. Indexed `(organizationId, name)`. No pipelines/timeline/record-page in V1 (parked decision).
- **`projects`** — UI label "Event". `name, project_type, lifecycle_status, primary_date, start_datetime, end_datetime, hours_of_coverage, photographer_count, primary_venue_name, primary_venue_address jsonb, primary_venue_coordinates point, ceremony_venue jsonb, reception_venue jsonb, venue_notes, package_name, package_base_price, line_items jsonb, subtotal, discount_type, discount_value, tax_rate, tax_sign, tax_amount, total_value, anniversary_date, project_notes, internal_notes, custom_fields jsonb, sun_data jsonb, template_id (nullable)` + standard. `subtotal/tax_amount/total_value` computed by the fixed order of operations (§4).
- **`project_contacts`** — `(id, organizationId, project_id, contact_id, role)` role ∈ primary|partner|billing|vendor. Many-to-many; couples + separate billing payers.
- **`project_photographers`** — `(id, organizationId, project_id, user_id, role, confirmation_status)` role ∈ lead|second|backup.
- **`project_sub_events`** — `(id, organizationId, project_id, event_type, included bool, event_date, venue, photographer_user_id, gallery_delivered_at)`.
- **`opportunities`** — `(id, organizationId, project_id, contact_id, pipeline_id, stage_id, value, probability, status, owner_user_id, expected_close_date, stage_changed_at, lost_reason)` + standard.
- **`pipelines`** / **`pipeline_stages`** — configurable; stages carry order, color, automation hooks, WIP/stale settings.

### 2.3 Project-management engine

- **`tasks`** — `(id, organizationId, project_id, stage_id (nullable), title, description, assignee_user_id (nullable), assignee_role (nullable — resolved at instantiation), due_date, status, priority, order, created_from_template_item_id (nullable), due_date_overridden bool)` + standard. Status ∈ not_started|blocked|ready|in_progress|done.
- **`task_dependencies`** — `(id, task_id, blocked_by_task_id)`. Blocked while any blocker incomplete; flips ready when all clear. No critical-path computation — deliberately excluded.
- **`task_checklist_items`** — `(id, task_id, label, done bool, assignee_user_id (nullable), order)`.
- **`project_stages`** — per-project, user-editable; seeded from template, divergeable. `(id, organizationId, project_id, name, order, color)`.
- **`project_templates`** — `(id, organizationId, name, project_type, package_defaults jsonb, payment_schedule_defaults jsonb, default_workflow_ids text[], questionnaire_id, contract_template_id)` + standard.
- **`project_template_task_items`** — the task-plan blueprint. `(id, project_template_id, stage_name, title, description, relative_offset_days int, assignee_role, blocked_by_template_item_id (nullable), checklist_items jsonb, order)`.

### 2.4 Money

- **`invoices`** — `(id, organizationId, project_id, billing_contact_id, smart_document_id, invoice_number, line_items jsonb, subtotal, discount_type, discount_value, tax_rate, tax_sign, tax_amount, total, status, due_date, sent_at, viewed_at, paid_at, payment_intent_id, payment_method, stripe_invoice_id)` + standard.
- **`payment_installments`** — one row per installment. `(id, organizationId, project_id, sequence_no, split_method, split_param jsonb, amount_cents integer, amount_overridden bool, due_date, due_date_rule jsonb, due_date_overridden bool, billing_contact_id, status, invoice_id (nullable))`. App-layer constraint: Σ amount_cents per project == project.total_value to the cent; mismatch surfaces a visible warning, never silently persists.
- **`payments`** — `(id, organizationId, invoice_id, payment_installment_id, amount, status, stripe_payment_intent_id, paid_at, refunded_amount, refund_log jsonb)`.

### 2.5 Documents, comms, files

- **`smart_documents`** — `(id, organizationId, project_id, primary_contact_id, template_id, status, package_options jsonb, signature_data jsonb, viewed_log jsonb, expires_at)` + standard.
- **`templates`** — `(id, organizationId, template_type, content jsonb, merge_fields text[], project_type_variant, version)` + standard.
- **`messages`** — unified comms log. `(id, organizationId, contact_id, channel, direction, subject, body, thread_ref, external_id, ai_intent, status)` + standard. Channel ∈ email|sms|instagram_dm|facebook_dm.
- **`oauth_email_accounts`** — per-user mail link. `(id, organizationId, user_id, provider, scope, token_ref, status)`. Tokens stored encrypted; never logged.
- **`project_files`** — `(id, organizationId, project_id, file_name, storage_key, mime_type, size_bytes, folder, client_visible bool, uploaded_by)` + standard. Vercel Blob; `client_visible` rides the existing signed-token no-login link.

### 2.6 System

- **`notifications`** — `(id, organizationId, user_id, event_type, channel, payload jsonb, read_at, delivered_at)`. Channel ∈ in_app|email (push reserved V2).
- **`notification_preferences`** — `(id, organizationId, user_id, event_type, channel, enabled bool)`.
- **`audit_log`** — EXISTS in foundation. Append-only. Do not add fields; give it a read UI only (Settings).

---

## 3. ROW-LEVEL SECURITY (the load-bearing build)

Foundation has ZERO RLS. This is ours, and it is the highest-risk item in V1.

**Rule: every org-scoped table's RLS policy ships in the same migration that creates the table. Never a follow-up migration.**

One-time `orgAction` extension (first RBAC task — everything depends on it): after resolving session, push org + role into the DB transaction:

```ts
await ctx.db.execute(sql`SELECT set_config('app.current_org', ${ctx.activeOrg.id}, true)`)
await ctx.db.execute(sql`SELECT set_config('app.current_role', ${ctx.activeOrg.role}, true)`)
```

Per-table baseline:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_org_isolation ON <t>
  USING (organization_id = current_setting('app.current_org', true));
```

Financial tables (`invoices`, `payments`, `payment_installments`, profit-bearing columns/rows): additional policy requiring `current_setting('app.current_role')` ∈ money-permitted set (owner, admin, manager-with-grant). Photographer/contractor/editor → rows do not return.

Assignment-scoped (events/tasks for photographer/contractor/editor): policy joins the assignment table; visible only for assigned work.

Field-level (Event visible, `profit` hidden): RLS is row-grain. Field-grain = `queries.ts` composes a role-aware projection (omits restricted columns for restricted roles) PLUS a Postgres column `GRANT` backstop. Restricted columns documented per table in its README.

**Mandatory negative test per org-scoped table:** integration test, real Postgres, application layer bypassed — set a wrong org / wrong role in the session config, query the table directly, assert zero rows. No test → not done.

---

## 4. THE TWO RECOMPUTE ENGINES ARE ONE ENGINE

Payment-schedule recompute and templated-task-plan recompute share one helper. Build it once.

Fixed order of operations (mandatory, identical everywhere — do not re-derive):
`subtotal = Σ line_items` → `discounted = subtotal − (discount_type='percent' ? subtotal*pct : flat)` → `total = discounted ± tax_rate*discounted` → split runs on `total`.

Split methods: `pay_in_full`; `even_by_count` (integer-cents; rounding remainder absorbed on the LAST installment so Σ == total exactly); `percentage` (Σ pct == 100 validated); `fraction` (exact rationals for thirds/quarters); `manual` (Σ == total validated; visible mismatch warning, never silent).

Recompute trigger (both domains): on change to a driving input (price/discount/tax/event-date), recompute every child row where `*_overridden = false`; protect `*_overridden = true` rows. Integer-cents internally, never float. Schedules on the existing Vercel Cron substrate. This helper is the core of module 4.30 and the highest overrun risk — build on a proven task engine, last in its phase.

---

## 5. EXTERNAL INTEGRATIONS (all net-new; isolate behind module boundaries)

| Integration              | Notes                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe Connect           | per-workspace connected account; hosted KYC; webhooks for payment events; needs platform legal entity (human-owed)                                                      |
| Native e-signature (4.6) | typed+drawn capture, document hash + immutability, tamper-evident audit trail, ESIGN/UETA owned by platform; pre-launch legal review REQUIRED, separate budget line     |
| Email per-user OAuth     | Gmail (restricted scope → Google review + annual CASA), Microsoft Graph (lighter), IMAP/SMTP (no review — launch fallback). Threading preserved by sending as the user. |
| SMS                      | Twilio; multiple numbers per workspace; per-user permissions                                                                                                            |
| Instagram DM (priority)  | Meta Messaging API; webhook not polling; AI intent (booking/active/noise); human-sends. Meta app review submitted week 1.                                               |
| Geocoding + sun          | Maps API once per venue for coords; open-source astro lib for sun/golden hour (no per-call cost)                                                                        |

Three external review queues — Meta, Google Gmail (CASA recurs annually), Stripe — are clock-starting tasks. Submit week 1. They gate launch, not the next line of code.

---

## 6. BUILD SEQUENCE (foundation-aware)

1. **Boot:** `pnpm install` → `pnpm setup` → `docker compose up -d` → `pnpm db:migrate` → `pnpm seed` → `pnpm dev`. Confirm starter runs green before touching anything.
2. **Foundation extension:** extend `orgAction` for RLS session config; custom-fields engine; `terminology_map` + label resolver; 8-role model + override table.
3. **Core + PM (critical path):** contacts → companies → projects(Events) → opportunities/pipelines → task engine → templated task plans + instantiation → Team This Week → universal saved views. RLS policy with every table's migration.
4. **Money & comms:** Stripe + invoicing + the shared recompute helper → Smart Documents → native e-sign (legal-review gate) → templates → email OAuth → SMS → Instagram DM → inbound parser → unified inbox.
5. **Differentiation/settings/polish:** workflow engine → reporting → calendar → briefs/editing/sun/time → notifications → Settings & Administration → reliability monitoring → onboarding → CSV migration → hardening → beta → launch.

Week-1 parallel (not build tasks): Meta review, Google Gmail verification, Stripe platform setup.

---

## 7. DEFINITION OF DONE (per module)

1. Follows the `items` pattern; schema registered; routes under `app/(app)/<feature>/`.
2. Mutations via `orgAction`; no DB in `app/`; no default exports in module/lib; no `console.*`.
3. Soft-delete columns; queries filter deleted by default.
4. Org-scoped → RLS policy in the creating migration + negative test (cross-org/cross-role returns zero rows, app layer bypassed).
5. Audit rows on state changes.
6. UI strings via `terminology_map`, not hard-coded.
7. `pnpm verify` tier 2 green; tier 3 green before a phase is called complete.
8. Module README in the foundation's style.

"It works when I click it" is not done. Done is this list.

---

## 8. HUMAN-OWED, NOT CODE (resolve before the dependent module ships)

1. Stripe Connect platform entity + country/payout model → blocks 4.7.
2. Meta Business entity for app review → blocks 4.10; submit week 1.
3. Google Cloud project + privacy policy for Gmail restricted scope → blocks 4.8 Gmail path; submit week 1.
4. One-time legal review of contract templates + e-sign flow → blocks 4.6 launch (not build).
5. Parked Company-object decision: stays lightweight unless (a) committing to non-photography verticals or (b) repeated demand for company-level history/reporting. Decide before 4.34's company-management surface.

Everything else is buildable now against this foundation by following this doc + the Implementation Guide.

**END OF TECHNICAL ARCHITECTURE**
