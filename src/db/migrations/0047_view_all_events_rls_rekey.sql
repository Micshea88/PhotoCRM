-- ─────────────────────────────────────────────────────────────────────
-- 0047_view_all_events_rls_rekey.sql
--
-- Re-key the assignment-scoped RLS overlay on contacts / projects / tasks
-- from a ROLE-string check to a PER-USER VISIBILITY FLAG.
--
-- BEFORE (migration 0021): the "sees everything" branch was
--   COALESCE(current_setting('app.current_role', true), '') NOT IN ('user')
-- AFTER (this migration): the same branch is
--   current_setting('app.current_view_all_events', true) = 'true'
--
-- Nothing else changes. The org-isolation OUTER AND-clamp, the
-- project_photographers EXISTS sub-select, and the tasks direct-assignee
-- carve-out (select + update) are preserved byte-for-byte from 0021.
--
-- The GUC `app.current_view_all_events` is set by orgAction
-- (src/lib/safe-action.ts) and withOrgContext (src/lib/org-context.ts) from
-- the resolved `view_all_events` permission (ROLE_DEFAULTS: owner/admin/
-- manager/accountant granted, `user` not — overridable per user). A missing/
-- unset GUC evaluates the branch to FALSE → assignment-scoped (fail-closed,
-- never a leak).
--
-- Behavior parity: owner/admin/manager/accountant default to view_all_events
-- = true (identical to the old NOT IN ('user') sees-all set). The `user`
-- tier defaults to false (identical to the old assignment-scoped behavior).
-- `client` shifts from moot-sees-all to moot-sees-assigned (no permissions in
-- V1 either way — harmless).
--
-- Policy-only migration (no schema change). DO-block probe at the bottom
-- proves org isolation cannot loosen, mirroring 0015/0021.
-- ─────────────────────────────────────────────────────────────────────

-- ───── contacts: DROP + CREATE 4 policies ────────────────────────────
DROP POLICY IF EXISTS "contacts_select" ON "contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "contacts_insert" ON "contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "contacts_update" ON "contacts";--> statement-breakpoint
DROP POLICY IF EXISTS "contacts_delete" ON "contacts";--> statement-breakpoint

CREATE POLICY "contacts_select" ON "contacts"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_view_all_events', true) = 'true'
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
    AND current_setting('app.current_view_all_events', true) = 'true'
  );--> statement-breakpoint

CREATE POLICY "contacts_update" ON "contacts"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_view_all_events', true) = 'true'
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_view_all_events', true) = 'true'
  );--> statement-breakpoint

CREATE POLICY "contacts_delete" ON "contacts"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_view_all_events', true) = 'true'
  );--> statement-breakpoint

-- ───── projects: DROP + CREATE 4 policies ────────────────────────────
DROP POLICY IF EXISTS "projects_select" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_insert" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_update" ON "projects";--> statement-breakpoint
DROP POLICY IF EXISTS "projects_delete" ON "projects";--> statement-breakpoint

CREATE POLICY "projects_select" ON "projects"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_view_all_events', true) = 'true'
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
    AND current_setting('app.current_view_all_events', true) = 'true'
  );--> statement-breakpoint

CREATE POLICY "projects_update" ON "projects"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_view_all_events', true) = 'true'
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_view_all_events', true) = 'true'
  );--> statement-breakpoint

CREATE POLICY "projects_delete" ON "projects"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_view_all_events', true) = 'true'
  );--> statement-breakpoint

-- ───── tasks: DROP + CREATE 4 policies (assignee carve-out preserved) ─
DROP POLICY IF EXISTS "tasks_select" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_insert" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_update" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_delete" ON "tasks";--> statement-breakpoint

CREATE POLICY "tasks_select" ON "tasks"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_view_all_events', true) = 'true'
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
    AND current_setting('app.current_view_all_events', true) = 'true'
  );--> statement-breakpoint

CREATE POLICY "tasks_update" ON "tasks"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_view_all_events', true) = 'true'
      OR "tasks"."assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')
    )
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_view_all_events', true) = 'true'
      OR "tasks"."assignee_user_id" = NULLIF(current_setting('app.current_user_id', true), '')
    )
  );--> statement-breakpoint

CREATE POLICY "tasks_delete" ON "tasks"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_view_all_events', true) = 'true'
  );--> statement-breakpoint

-- ───── CROSS-ORG ISOLATION PROBE (belt; the integration suite is suspenders) ─
-- Forge a view_all_events='true' session in org B and confirm it still
-- cannot see org A's contact — i.e. the re-key did not let the new
-- visibility flag override the org-isolation OUTER clamp. Runs as the
-- NOBYPASSRLS app role so RLS actually applies.
DO $$
DECLARE
  v_org_a TEXT := 'rekey_probe_org_a';
  v_org_b TEXT := 'rekey_probe_org_b';
  v_contact_a TEXT := 'rekey_probe_contact_a';
  v_visible_count INT;
BEGIN
  INSERT INTO organization (id, name, slug, created_at)
    VALUES (v_org_a, 'Rekey Probe A', 'rekey-probe-a', NOW()),
           (v_org_b, 'Rekey Probe B', 'rekey-probe-b', NOW());

  SET LOCAL ROLE app_authenticated;

  -- Insert a contact in org A (as a sees-all owner of org A).
  PERFORM set_config('app.current_org', v_org_a, true);
  PERFORM set_config('app.current_role', 'owner', true);
  PERFORM set_config('app.current_user_id', '', true);
  PERFORM set_config('app.current_view_all_events', 'true', true);
  INSERT INTO contacts (id, organization_id, first_name, last_name)
    VALUES (v_contact_a, v_org_a, 'Probe', 'A');

  -- Probe from org B WITH view_all_events = true. The outer org clamp must
  -- still return 0 rows for org A's contact.
  PERFORM set_config('app.current_org', v_org_b, true);
  PERFORM set_config('app.current_view_all_events', 'true', true);
  SELECT count(*) INTO v_visible_count FROM contacts WHERE id = v_contact_a;

  IF v_visible_count <> 0 THEN
    RAISE EXCEPTION
      'RLS REKEY PROBE FAILED: view_all_events=true in org B saw % row(s) of org A. The re-key loosened org isolation.',
      v_visible_count;
  END IF;

  RESET ROLE;
  PERFORM set_config('app.current_org', v_org_a, true);
  PERFORM set_config('app.current_view_all_events', 'true', true);
  DELETE FROM contacts WHERE id = v_contact_a;
  DELETE FROM organization WHERE id IN (v_org_a, v_org_b);
  PERFORM set_config('app.current_org', '', true);
  PERFORM set_config('app.current_role', '', true);
  PERFORM set_config('app.current_user_id', '', true);
  PERFORM set_config('app.current_view_all_events', '', true);

  RAISE NOTICE 'RLS re-key probe OK: org isolation preserved under app.current_view_all_events.';
END $$;
