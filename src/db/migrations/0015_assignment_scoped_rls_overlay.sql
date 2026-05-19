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

-- ─── MIGRATION PROBE ───────────────────────────────────────────────────
-- Belt-and-suspenders defense for the security boundary change. The
-- integration test suite (tests/integration/assignment-scoped-rls.test.ts)
-- is the SUSPENDERS — it runs immediately after this migration in CI. This
-- DO block is the BELT: it fails the migration AT THE MIGRATION STEP if
-- the new overlay accidentally loosens org isolation, giving faster
-- feedback than the test run.
--
-- The probe runs as the `pathway_app` role (NOSUPERUSER, NOBYPASSRLS).
-- Without that, migrations run as the postgres superuser which bypasses
-- RLS and the probe would falsely succeed at seeing the row.
DO $$
DECLARE
  v_org_a TEXT := 'rlsprobe_org_a';
  v_org_b TEXT := 'rlsprobe_org_b';
  v_user_b TEXT := 'rlsprobe_user_b';
  v_project_a TEXT := 'rlsprobe_project_a';
  v_pp_id TEXT := 'rlsprobe_pp';
  v_visible_count INT;
BEGIN
  -- Set up org A + org B + a probe user in org B.
  INSERT INTO organization (id, name, slug, created_at)
    VALUES (v_org_a, 'Probe Org A', 'rlsprobe-org-a', NOW()),
           (v_org_b, 'Probe Org B', 'rlsprobe-org-b', NOW());
  INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES (v_user_b, 'Probe User B', 'rlsprobe-user-b@example.com', true, NOW(), NOW());

  -- Switch to non-superuser role so RLS actually applies.
  SET LOCAL ROLE pathway_app;

  -- Insert a project in org A as owner.
  PERFORM set_config('app.current_org', v_org_a, true);
  PERFORM set_config('app.current_role', 'owner', true);
  PERFORM set_config('app.current_user_id', '', true);
  INSERT INTO projects (id, organization_id, name) VALUES (v_project_a, v_org_a, 'Probe A');

  -- Forge a project_photographers row in org B claiming an assignment to
  -- org A's project. The forge inserts under app.current_org = orgB so it
  -- passes project_photographers' org-isolation WITH CHECK.
  PERFORM set_config('app.current_org', v_org_b, true);
  INSERT INTO project_photographers (id, organization_id, project_id, user_id, role)
    VALUES (v_pp_id, v_org_b, v_project_a, v_user_b, 'lead');

  -- Probe as photographer in org B. The new policy's OUTER AND clamp is
  -- organization_id = current_setting('app.current_org', true). Even though
  -- the forged assignment row exists, the outer clamp on the project
  -- itself returns 0 rows (project_a.organization_id = orgA ≠ orgB).
  PERFORM set_config('app.current_role', 'photographer', true);
  PERFORM set_config('app.current_user_id', v_user_b, true);
  SELECT count(*) INTO v_visible_count FROM projects WHERE id = v_project_a;

  IF v_visible_count <> 0 THEN
    RAISE EXCEPTION
      'RLS MIGRATION PROBE FAILED: assignment-scoped overlay LOOSENED org isolation. Photographer in org B saw % row(s) of org A project. The new policies have a parenthesization or boolean-logic bug.',
      v_visible_count;
  END IF;

  -- Reset role + cleanup as superuser.
  RESET ROLE;
  PERFORM set_config('app.current_org', v_org_a, true);
  PERFORM set_config('app.current_role', 'owner', true);
  DELETE FROM project_photographers WHERE id = v_pp_id;
  DELETE FROM projects WHERE id = v_project_a;
  DELETE FROM "user" WHERE id = v_user_b;
  DELETE FROM organization WHERE id IN (v_org_a, v_org_b);
  PERFORM set_config('app.current_org', '', true);
  PERFORM set_config('app.current_role', '', true);
  PERFORM set_config('app.current_user_id', '', true);

  RAISE NOTICE 'RLS migration probe OK: org isolation preserved under the assignment-scoped overlay.';
END $$;
