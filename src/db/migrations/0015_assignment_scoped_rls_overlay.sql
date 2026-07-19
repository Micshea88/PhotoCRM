-- Assignment-scoped RLS overlay on contacts / projects / tasks.
--
-- Per the deferral named in contacts/projects/tasks/rbac READMEs:
-- photographer/contractor/editor roles see only rows on projects they're
-- assigned to (via project_photographers); the carve-out on tasks also
-- allows visibility/update when the user is the direct assignee.
--
-- Locked decision (rbac/README.md): owner/admin/manager/accountant/
-- client_limited continue to see everything in their org (V1 posture —
-- manager-with-grant finer check at the application layer comes with the
-- Phase 4 admin UI). Empty `app.current_role` is treated as a non-
-- assignment-scoped role so existing tests that set only `app.current_org`
-- continue to work; production code always sets the role via orgAction /
-- runWithOrgContext.
--
-- Org-isolation guarantee preserved: every new policy AND-clamps on
-- `organization_id = current_setting('app.current_org', true)` as the
-- OUTER condition. The assignment-scope is the inner OR. The DO-block
-- probe at the bottom proves cross-org isolation cannot loosen.
--
-- Replace single FOR ALL org-isolation policy with per-operation policies.

DROP POLICY IF EXISTS "contacts_org_isolation" ON "contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_org_isolation" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_org_isolation" ON "tasks";--> statement-breakpoint

-- ─── contacts ──────────────────────────────────────────────────────────
CREATE POLICY "contacts_select" ON "contacts"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
      OR EXISTS (
        SELECT 1 FROM "project_contacts" pc
        INNER JOIN "project_photographers" pp ON pp."project_id" = pc."project_id"
        WHERE pc."contact_id" = "contacts"."id"
          AND pp."user_id" = current_setting('app.current_user_id', true)
      )
    )
  );--> statement-breakpoint

CREATE POLICY "contacts_insert" ON "contacts"
  FOR INSERT
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  );--> statement-breakpoint

CREATE POLICY "contacts_update" ON "contacts"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  );--> statement-breakpoint

CREATE POLICY "contacts_delete" ON "contacts"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  );--> statement-breakpoint

-- ─── projects ──────────────────────────────────────────────────────────
CREATE POLICY "projects_select" ON "projects"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
      OR EXISTS (
        SELECT 1 FROM "project_photographers" pp
        WHERE pp."project_id" = "projects"."id"
          AND pp."user_id" = current_setting('app.current_user_id', true)
      )
    )
  );--> statement-breakpoint

CREATE POLICY "projects_insert" ON "projects"
  FOR INSERT
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  );--> statement-breakpoint

CREATE POLICY "projects_update" ON "projects"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  );--> statement-breakpoint

CREATE POLICY "projects_delete" ON "projects"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  );--> statement-breakpoint

-- ─── tasks ─────────────────────────────────────────────────────────────
-- Tasks add a carve-out: a photographer/contractor/editor who is the
-- DIRECT assignee can read AND update the task even on a project they
-- are not assigned to. This covers markTaskDone / markTaskInProgress
-- flows from `tasks/actions.ts` for self-owned tasks.
CREATE POLICY "tasks_select" ON "tasks"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
      OR EXISTS (
        SELECT 1 FROM "project_photographers" pp
        WHERE pp."project_id" = "tasks"."project_id"
          AND pp."user_id" = current_setting('app.current_user_id', true)
      )
      OR "tasks"."assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')
    )
  );--> statement-breakpoint

CREATE POLICY "tasks_insert" ON "tasks"
  FOR INSERT
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  );--> statement-breakpoint

CREATE POLICY "tasks_update" ON "tasks"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
      OR "tasks"."assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')
    )
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
      OR "tasks"."assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')
    )
  );--> statement-breakpoint

CREATE POLICY "tasks_delete" ON "tasks"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('photographer','contractor','editor')
  );--> statement-breakpoint

-- MIGRATION PROBE — REMOVED 2026-07-17 (authorized exception to Hard Rule #9).
-- The original DO-block here asserted the assignment-scoped overlay did not loosen
-- org isolation (a team member in org B with a FORGED project_photographers row
-- pointing at an org A project must see 0 rows of that project). It ran
-- `SET LOCAL ROLE pathway_app` — a role NO migration creates (only
-- scripts/postgres-init.sh, dev-only) — so the whole chain FAILED build-from-zero
-- on any cluster lacking that role (CI, a fresh prod rebuild).
--
-- Why removing it is safe (not an override of Rule #9, a case it never aimed at):
-- a DO-block ASSERTS but creates/alters/drops NO schema, so a fresh cluster applying
-- this file now produces schema byte-identical to a DB that applied the old version.
-- Schema divergence — the disaster Rule #9 guards — is structurally zero. Drizzle
-- also keys applied migrations on the journal timestamp, never a content hash
-- (drizzle-orm pg-core/dialect.js migrate()), so editing an already-applied file is
-- inert on prod.
--
-- The assertion was NOT deleted — it is the SUSPENDERS it always referenced, and it
-- runs on every machine under the correct non-bypass role:
--   tests/integration/assignment-scoped-rls.test.ts — "cross-org attack" (it: "team
--   member in org B with a forged project_photographers assignment ... STILL cannot
--   see org A's data"). See docs/backend-audit-backlog.md → A2/migration portability.
