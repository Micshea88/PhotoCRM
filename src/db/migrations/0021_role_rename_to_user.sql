-- ─────────────────────────────────────────────────────────────────────
-- 0021_role_rename_to_user.sql
--
-- P4-roles: 8-role → 6-role access-tier consolidation.
--
-- Per the P4-audit-fixes audit (commit 6d3cc65) and the locked Phase 4
-- role decisions:
--
--   A1 — Access-tier rename only:
--          photographer/contractor/editor → "user"
--          client_limited                  → "client"
--        Domain occurrences ("project_photographers" table,
--        "photographerUserId" columns, PHOTOGRAPHER_ROLES enum,
--        "photographer pipeline pack" terminology) stay byte-unchanged.
--        This is a wedding-photography CRM; "photographer" is a domain
--        noun, not a role name.
--
--   A3 — The merged "user" role's permission set is the broader
--        photographer baseline (view_contacts + view_events + send_sms
--        + use_ai_assistant). One access tier, one permission set.
--
-- ───── Policy-rewrite scope ──────────────────────────────────────────
--
-- Only THREE tables actually role-string-match on the renamed roles
-- (per the ground-truth check against the migration source):
--
--   contacts  — select / insert / update / delete    (×4 policies)
--   projects  — select / insert / update / delete    (×4 policies)
--   tasks     — select / insert / update / delete    (×4 policies, includes
--                                                     the direct-assignee
--                                                     carve-out on select
--                                                     and update)
--
-- Plus two data-mutating UPDATEs on member_role to rewrite stored
-- role strings.
--
-- Tables explicitly NOT touched by this migration (no role-string
-- match on the renamed roles):
--   payment_installments  — positive-match on UNCHANGED roles
--                           (owner / admin / accountant)
--   member_role           — positive-match on UNCHANGED roles
--                           (owner / admin)
--   member_permission_override  — positive-match on UNCHANGED roles
--   project_contacts / project_photographers / project_sub_events
--                         — org-isolation only
--   task_dependencies / task_checklist_items
--                         — org-isolation only
--
-- ───── ROLLBACK ──────────────────────────────────────────────────────
--
-- This migration is destructive to the old role names: the UPDATEs
-- change data; the DROP POLICY drops the old policy definitions. There
-- is no production deployment at this point — local dev DB and CI test
-- DB only. If a future deployment ever needed to undo, a new migration
-- 0022_role_revert would do the inverse UPDATEs and policy rewrites;
-- standard expand-contract is NOT used here because no live writers
-- depend on the old role names.
--
-- ───── TRANSACTIONALITY ──────────────────────────────────────────────
--
-- Wrapped in a single transaction by drizzle-kit's migrator. If any
-- statement below fails (UPDATE, DROP, CREATE, or the final invariant
-- check), the entire migration rolls back and the DB is left in its
-- pre-0021 state.
-- ─────────────────────────────────────────────────────────────────────

-- ───── 1. Data rewrite on member_role ────────────────────────────────
-- The 3-role consolidation. Three old labels → one new "user" label.
UPDATE "member_role"
   SET "role" = 'user',
       "updated_at" = NOW()
 WHERE "role" IN ('photographer', 'contractor', 'editor');--> statement-breakpoint

-- The client-portal parked role. One rename.
UPDATE "member_role"
   SET "role" = 'client',
       "updated_at" = NOW()
 WHERE "role" = 'client_limited';--> statement-breakpoint

-- ───── 2. contacts: DROP + CREATE 4 policies ─────────────────────────
DROP POLICY IF EXISTS "contacts_select" ON "contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "contacts_insert" ON "contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "contacts_update" ON "contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "contacts_delete" ON "contacts";--> statement-breakpoint

CREATE POLICY "contacts_select" ON "contacts"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
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
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  );--> statement-breakpoint

CREATE POLICY "contacts_update" ON "contacts"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  );--> statement-breakpoint

CREATE POLICY "contacts_delete" ON "contacts"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  );--> statement-breakpoint

-- ───── 3. projects: DROP + CREATE 4 policies ─────────────────────────
DROP POLICY IF EXISTS "projects_select" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_insert" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_update" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_delete" ON "projects";--> statement-breakpoint

CREATE POLICY "projects_select" ON "projects"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
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
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  );--> statement-breakpoint

CREATE POLICY "projects_update" ON "projects"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  );--> statement-breakpoint

CREATE POLICY "projects_delete" ON "projects"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  );--> statement-breakpoint

-- ───── 4. tasks: DROP + CREATE 4 policies ────────────────────────────
-- The direct-assignee carve-out on tasks_select / tasks_update is
-- preserved verbatim from 0015 — only the role-string list changes.
DROP POLICY IF EXISTS "tasks_select" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_insert" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_update" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_delete" ON "tasks";--> statement-breakpoint

CREATE POLICY "tasks_select" ON "tasks"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
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
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  );--> statement-breakpoint

CREATE POLICY "tasks_update" ON "tasks"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
      OR "tasks"."assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')
    )
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
      OR "tasks"."assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')
    )
  );--> statement-breakpoint

CREATE POLICY "tasks_delete" ON "tasks"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
  );--> statement-breakpoint

-- ───── 5. POST-REWRITE INVARIANT CHECK ───────────────────────────────
-- Belt-and-suspenders. If any policy on contacts/projects/tasks still
-- carries the old role names in its USING or WITH CHECK expression,
-- the migration FAILS at this step (in-transaction → full rollback).
-- Faster feedback than waiting for the integration suite.
DO $$
DECLARE
  v_stale INT;
BEGIN
  SELECT COUNT(*) INTO v_stale
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('contacts', 'projects', 'tasks')
     AND (
       COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
         ~ '''(photographer|contractor|editor|client_limited)'''
       OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
         ~ '''(photographer|contractor|editor|client_limited)'''
     );

  IF v_stale > 0 THEN
    RAISE EXCEPTION
      'P4-roles migration 0021 FAILED: % policy expression(s) on contacts/projects/tasks still reference the old role names. Rewrite is incomplete.',
      v_stale;
  END IF;

  RAISE NOTICE 'P4-roles migration 0021 OK: 12 policies rewritten; no old-role strings remain in policy expressions on contacts/projects/tasks.';
END $$;
