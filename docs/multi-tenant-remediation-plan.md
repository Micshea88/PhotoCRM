# Multi-Tenant Isolation Remediation Plan

**Status:** ACTIVE remediation. Owner standard: **multi-tenant-correct from the start — NO deferrals.** Every finding below gets fixed; none is accepted as "single-tenant-safe."

**Source:** four read-only isolation audits (2026-07-07) — RLS table coverage, cross-org query/resolver classification, deferred-isolation doc scan, and an RLS-policy-correctness leak hunt. Branch: `fix/multi-tenant-isolation` (stacked on `feat/email-round-notification-center`; merges together after Tier 1 + Tier 2 reviewed).

**Enforcement model (the load-bearing fact):** prod's Neon pool role (`neondb_owner`) is **BYPASSRLS**, so FORCE RLS is inert unless a transaction first runs `SET LOCAL ROLE app_authenticated` (NOBYPASSRLS, added in hotfix `0041`). Isolation therefore requires BOTH (a) `SET LOCAL ROLE app_authenticated` and (b) `set_config('app.current_org', …, true)`. A table with **no RLS** has no backstop even under `app_authenticated` (it's `GRANT`ed on ALL TABLES). This is the class that caused the confirmed **"Shanzy Studio saw K&K's contacts"** production leak (fixed by `0041`).

**What's already solid (verified — do NOT touch):** GUC lifecycle (transaction-local, no pool bleed); policies fail-closed (`current_setting(...,true)` unset → matches nothing); membership verified on writes (`orgAction`); `activeOrganizationId` can't be set to a non-member org (Better Auth `checkMembership`); crown-jewel tables (contacts/projects/tasks/companies/opportunities/pipelines/payments/saved_views/email_log/notifications/email_connections/email_delivery_events) have ENABLE+FORCE+correct policies; notifications two-policy INSERT doesn't widen SELECT; blob private-by-default.

---

## TIER 1 — ✅ COMPLETE + REVIEWED (2026-07-07)

Commits `8e5c3c9`→`5d339b5` on `fix/multi-tenant-isolation`. All 5 items done; review found a Critical (redirect loop in the T1.4 fix) + Important (guard coverage) + Minor — ALL fixed (`092b4a9`/`c1cbb25`/`5d339b5`) and re-verified. `check-rls-force` now confirms **all 50 org-bearing tables have FORCE RLS**. tier-2 green (1199 tests). Awaiting Mike's Tier-1 sign-off before Tier 2.

## TIER 1 — BLOCKS MERGE (defense-in-depth gaps + a live read-staleness hole)

### T1.1 — 7 org-scoped tables have NO RLS at all — HIGH

`files`, `items`, `audit_log`, `org_preferences`, `file_share_links`, `file_share_link_events`, `file_scan_diagnostics`. Each has `organization_id` but zero `.enableRLS()`/policy/FORCE. No live missing-filter exploit found (app filters defensively), but **zero DB backstop** — one forgotten `WHERE org=?` = silent cross-org breach; same class as the Shanzy leak. `audit_log` (every org's actions+IPs) and `files` (blob URLs/metadata) are the sensitive ones.

- **Fix:** add `.enableRLS()` + `pgPolicy` org-isolation + hand-append `FORCE ROW LEVEL SECURITY` (per AGENTS §10a) via `pnpm db:generate`. Declare RLS in the Drizzle TS schema (not SQL-only) so snapshots stay in sync.
- **Per-table nuance (must handle, not skip):**
  - `items`, `org_preferences`: straightforward org-scoped CRUD via `orgAction` → standard org policy. Clean.
  - `audit_log`: written by `audit()` (orgAction context = role+GUC present) and read by org-scoped admin views; the `workflow-trigger-matcher` cron reads cross-org as the BYPASSRLS owner (unaffected). Verify no `audit()` writer runs under `app_authenticated` WITHOUT an org GUC (would fail the INSERT); webhook/cron audit writes run as owner (bypass) so are fine.
  - `files`: mixed access — authenticated proxy (`/api/files/[id]`, session+activeOrg), public share-link download (by token, no session), blob-upload callback (token, no session). Add org policy + FORCE. **DECIDED APPROACH (Mike, Option 1):** the sessionless public/token + upload-callback paths **resolve the org FROM the token/payload, then run SCOPED** (`SET LOCAL ROLE app_authenticated` + `set_config('app.current_org', <org-from-token>, true)`) — NOT as the bypass owner. Document each site in-code. **Test that a foreign/tampered token cannot reach another org's file.**
  - `file_share_links`, `file_share_link_events`: same — public token path resolves org from the token row then runs scoped; tampered-token test required.
  - `file_scan_diagnostics`: has `organization_id` (nullable) → tenant-scoped → gets RLS+FORCE+org policy per the rule. Make `org_id` NOT NULL if the data model allows (backfill/drop null rows); if a null-org row is structurally required, document the exact reason in-code. (Confirm the table is still used; drop if dead.)
  - **`faq_entries` (help module): NO `organization_id` — genuinely GLOBAL content.** No RLS needed; **document that classification in-code** (a comment stating it's global, not tenant-scoped).
  - **VIEWS / SECURITY DEFINER audit (Mike's addition): DONE — none exist.** Grepped all migrations + schema: no `CREATE VIEW`/materialized view, no `SECURITY DEFINER` function, no drizzle `pgView`. No RLS-bypass-via-view surface to fix. (Add a note so future views default to `security_invoker`.)
- **Scope note (Mike):** industry-standard pattern only (AWS/Azure/Postgres RLS guidance = "enable RLS on ALL tables with tenant data") — the SAME pattern already on crown-jewel tables. No new architecture. B.10 (multi-tenant email sender) + B.11 (account linking) are product-shaped, OUT of this remediation, remain tracked separately.
- **Effort:** ~1–1.5 days (7 tables, mixed nuance; migrations + policy tests + fixing any broken public/system path).
- **Blocks merge:** YES.
- **Test:** cross-org SELECT/INSERT/UPDATE denied under `app_authenticated`+org-A-GUC for an org-B row, per table (extend `tests/integration/rls-cross-org.test.ts`). Public/token paths still work.

### T1.2 — `items` template teaches the no-RLS pattern — HIGH (propagation)

`src/modules/items/` is the canonical copy source (`AGENTS.md`, `/new-module`). It has no RLS, so every scaffolded module inherits the gap.

- **Fix:** T1.1 already adds RLS+FORCE to `items`; ALSO update the module template so `.enableRLS()` + `pgPolicy` org-isolation is the DEFAULT in a freshly-scaffolded schema. Update `AGENTS.md`/`add-module` skill/`/new-module` guidance to include the RLS step as mandatory.
- **Effort:** ~2–3 hrs.
- **Blocks merge:** YES (stops the pattern propagating).
- **Test:** N/A structural; verify a scaffold produces an RLS-declared schema.

### T1.3 — `user_preferences` missing FORCE — HIGH

Has correct user-scoped policies (keyed on `app.current_user_id`) but only `ENABLE`, no `FORCE` (`0033`). The owner role bypasses them; the only such table. Undocumented.

- **Fix:** new migration appending `ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;`.
- **Effort:** ~30 min.
- **Blocks merge:** YES.
- **Test:** owner-role bypass closed; user A can't read user B's prefs under `app_authenticated`.

### T1.4 — Read path doesn't fail-closed on revoked membership — MEDIUM (live read exposure)

`src/lib/page-org-context.ts:56-63` + `app/(app)/layout.tsx:73-76` default `role="member"` when the membership row is null instead of throwing (write path `orgAction` throws FORBIDDEN). A user removed from an org keeps READ access (contacts/projects/dashboard/files) until the session refreshes (up to 7-day session / 5-min cookie cache). RLS checks org, not membership.

- **Fix:** in `page-org-context.ts`, when `getCurrentMember(...)` is null → throw/redirect (mirror `orgAction`). Do not default the role.
- **Effort:** ~1–2 hrs (+ check every caller handles the redirect).
- **Blocks merge:** YES.
- **Test:** a session whose `activeOrganizationId` points at an org the user is no longer a member of → read paths deny (redirect/forbidden), not serve rows.

### T1.5 — `0041` migration asserts a now-false invariant — LOW (correctness/documentation)

`0041_app_authenticated_role.sql` header claims "every org-scoped table has FORCE ROW LEVEL SECURITY" — false until T1.1/T1.3 land.

- **Fix:** once T1.1+T1.3 are done, add a follow-up migration (or doc note — migrations are immutable, so a NEW migration's comment or a doc) recording that the invariant is now actually true, and add a CI check that fails if an org-scoped table lacks FORCE (prevents regression).
- **Effort:** ~2–4 hrs (the CI guard is the valuable part).
- **Blocks merge:** YES (the CI guard is the durable fix).
- **Test:** the guard fails on a deliberately-unforced table, passes on the fixed tree.

**STATUS (2026-07-07): DONE.** T1.1 (migration 0061) added FORCE to 7 tables; T1.3 (migration 0062) added FORCE to `user_preferences`. The invariant claimed by 0041 is now **actually true**: every org-bearing table in `src/modules/<name>/schema.ts` (46 tables) has `FORCE ROW LEVEL SECURITY` in the migration SQL. The `scripts/check-rls-force.mjs` CI guard (wired into `pnpm verify --tier=1` next to `check-actions`) enforces this invariant permanently — it parses every `src/modules/<name>/schema.ts` for tables with an `organization_id` column and exits 1 if any lack a FORCE statement in the migrations. Adding a new module that skips FORCE will fail the pre-commit verify hook.

---

## TIER 2 — multi-tenant-activation write/routing holes (fix, do NOT defer)

### T2.1 — `workflow-execute` → `handleUpdateField` cross-org write — MEDIUM

`workflows/dispatch.ts:213-222` updates contacts/projects/opportunities/tasks **by ID, no org filter**; `workflow-execute/route.ts:63-66` sets the org GUC but NOT `SET LOCAL ROLE` → BYPASSRLS. A workflow config with a foreign `resourceId` writes cross-org.

- **Fix:** add `SET LOCAL ROLE app_authenticated` as the first statement of the per-execution tx; AND add `eq(organizationId, exec.organizationId)` to each UPDATE's WHERE (defense-in-depth even with RLS on).
- **Effort:** ~2–3 hrs. **Test:** a workflow whose action targets a foreign-org resourceId updates 0 rows.

### T2.2 — `findContactAnyOrg` inbound-email routing hijack — MEDIUM/HIGH (multi-tenant)

`email-log/inbound.ts:143` routes inbound mail by "most-recently-updated contact with this address across ALL orgs" → wrong-org routing + reply-notification leak once a 2nd org exists.

- **Fix:** resolve the org from the RECEIVING mailbox/connection (which lane already knows: Nylas has `conn.organizationId` from `findLiveConnectionByAddressAnyOrg`; Resend inbound must carry the receiving-address→org mapping), then look up the contact WITHIN that org. Remove the cross-org "latest updatedAt wins" behavior.
- **Effort:** ~0.5–1 day (touches both inbound lanes + `processInboundEmail` signature). **Test:** same contact email in orgs A+B; inbound to A's mailbox logs to A + notifies A only.

### T2.3 — `listIncompleteSignups` cross-org admin view — MEDIUM

`org/queries.ts:89-92` shows incomplete sign-ups from ALL orgs to any org's admin.

- **Fix:** scope to the current org (e.g. only users created via an invite for this org), or remove if not needed. **Effort:** ~2–4 hrs. **Test:** org-A admin sees only org-A incomplete signups.

### T2.4 — Fail-OPEN role predicates → fail closed — LOW (latent)

`payment_installments` (`0016`): `COALESCE(current_setting('app.current_role', true),'') IN ('owner','admin','accountant','')` — the `''` lets an unset role through. Assignment overlay (`0015`/`0021`/`0047`): `... NOT IN ('user')` → unset role sees all. Not reachable today (role always set with org), but fail-open shape.

- **Fix:** new migrations dropping the `''` from the IN-list and the `COALESCE(...,'')`, and making the assignment overlay require an explicit allowed role rather than `NOT IN`. **Effort:** ~3–5 hrs (expand→contract policy replacement). **Test:** org set but role unset → financial/assignment reads deny.

### T2.5 — Webhook/cron write paths skip `SET LOCAL ROLE` — LOW (defense-in-depth)

`emitNotification` (dispatch.ts:67), `recordDeliveryEvent` (ingest.ts:249), `handleGrantExpired` (nylas-inbound.ts:226), and the cron lanes `workflow-execute` (covered by T2.1), plus verify `workflow-trigger-matcher`/`purge-deleted` (intentional owner scans — leave, but document). These set the org GUC but not the role → RLS inert; the "satisfies FORCE RLS" comments are misleading. Writes are currently correct via explicit org tagging.

- **Fix:** add `SET LOCAL ROLE app_authenticated` as the first statement in each user-data write tx so RLS actually enforces (matching `processInboundEmail`/`rc-sync/runner`). For the deliberate cross-org owner scans (purge, trigger-matcher), keep BYPASSRLS but correct the comments to say so explicitly.
- **Effort:** ~3–5 hrs (+ re-run the affected integration tests; watch for writes that then need the GUC set which they already do). **Test:** with RLS now enforcing, the existing delivery/notification/grant integration tests still pass; a deliberately-wrong org id is rejected by the CHECK.

### T2.6 — email-pixel route direct-DB escape hatch — LOW (boundary)

`app/api/email/track/[pixelId]/route.ts` imports `@/lib/db`+`drizzle-orm` directly (undocumented `app/` escape hatch ESLint should block) and does a cross-org `email_log` UPDATE keyed only on the pixel UUID.

- **Fix:** move the open-tracking read+update into `src/modules/email-log/` (a `recordPixelOpen(pixelId, …)` fn) and call it from the route; keep the "always return the pixel" behavior. Confirm the ESLint `no-restricted-imports` rule covers this path. (The pixel is inherently unauthenticated — org is resolved from the pixel row — so document that the write is intentionally keyed by the opaque pixel id.)
- **Effort:** ~2–4 hrs. **Test:** the pixel route still records opens via the module fn; ESLint boundary clean.

---

## Sequencing + gates

1. **This plan + logging** (committed) → checkpoint.
2. **Tier 1** (T1.1–T1.5) → isolation tests prove org A can't read/write org B on the newly-protected tables + revoked-member read denied → **review checkpoint.**
3. **Tier 2** (T2.1–T2.6) → isolation tests prove the write/routing holes closed → **review checkpoint.**
4. Only after BOTH tiers reviewed clean: merge `fix/multi-tenant-isolation` (incl. the notification work) to main. Nylas stays disconnected; nothing deployed until Mike's separate go.

## Effort roll-up

Tier 1 ≈ 2.5–3.5 days · Tier 2 ≈ 2–3 days · **Total ≈ 5–6.5 focused days.** Higher-risk items: T1.1 files/share-link RLS (public-path interaction) and T2.2 inbound routing (touches both lanes).
