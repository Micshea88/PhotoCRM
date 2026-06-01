-- ============================================================================
-- 0041 — CRITICAL RLS HOTFIX: introduce app_authenticated (NOBYPASSRLS).
-- ============================================================================
--
-- Background
-- ----------
-- The runtime connection role in production is Neon's owner role
-- (`neondb_owner`), which has rolbypassrls=true. Per Postgres RLS docs:
-- "Superusers and roles with the BYPASSRLS attribute always bypass RLS."
-- So although every org-scoped table has FORCE ROW LEVEL SECURITY plus
-- an `organization_id = current_setting('app.current_org', true)`
-- policy, the policies were silently inert in prod: a user in org A
-- could read every row in org B.
--
-- Confirmed live by Mike: a user in Shanzy Studio org saw all 12
-- contacts belonging to K&K Photography org.
--
-- Fix shape
-- ---------
-- Create a dedicated NOBYPASSRLS role (`app_authenticated`), grant it
-- exactly the privileges the app needs on `public` schema objects, and
-- have the runtime `SET LOCAL ROLE app_authenticated` at the start of
-- every request's transaction — both the READ path (withOrgContext)
-- and the WRITE path (orgAction). Once the role switch is in place,
-- RLS becomes load-bearing for real and the policies that have always
-- been there finally enforce.
--
-- Migrator is unaffected
-- ----------------------
-- This migration runs as the DDL role: postgres (dev, superuser) or
-- neondb_owner (prod, db owner). Both keep their bypass attribute.
-- CREATE ROLE + GRANT runs inside the migrator's transaction; the
-- runtime never opens a session as app_authenticated (NOLOGIN). The
-- runtime opens its session as the existing connection role (pathway_app
-- in dev, neondb_owner in prod) and SET LOCAL ROLE-s into the
-- non-bypass role for the duration of each request.
--
-- Idempotent
-- ----------
-- CREATE ROLE is wrapped in a DO block with an EXISTS guard so this
-- migration can be applied to any environment where the role may or
-- may not pre-exist.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated NOBYPASSRLS NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint

-- Schema-level privileges. Without USAGE on the schema, even a SELECT
-- on a table is denied with "permission denied for schema public."
GRANT USAGE ON SCHEMA public TO app_authenticated;
--> statement-breakpoint

-- CRUD on every existing public table. The RLS policies do the
-- per-row org isolation; the GRANT enables the role to address the
-- table at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_authenticated;
--> statement-breakpoint

-- Sequences: dev currently has zero in public (text PKs everywhere),
-- but grant USAGE/SELECT defensively so any future serial column
-- doesn't lock the app out.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_authenticated;
--> statement-breakpoint

-- Future-proof: any new table or sequence created by the migrator
-- role (the current_user running THIS migration — postgres locally,
-- neondb_owner in prod) auto-grants the same CRUD/USAGE to
-- app_authenticated. Without this, every new module would have to
-- re-grant manually and a missed grant = silent runtime lock-out.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_authenticated;
--> statement-breakpoint

-- Grant app_authenticated membership to whichever connection role
-- exists in this environment. The connection role must be a member
-- of app_authenticated for `SET LOCAL ROLE app_authenticated` to
-- succeed.
--
-- - dev: pathway_app (the existing NOBYPASS runtime role from
--        scripts/postgres-init.sh) — already NOBYPASS, but the role
--        switch is still required so the same code path runs in
--        both environments.
-- - prod: neondb_owner (Neon's owner role, BYPASSRLS — the role
--         whose bypass is the entire reason this hotfix exists).
--
-- Idempotent via IF EXISTS so the migration doesn't trip on
-- environments that have one role but not the other.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pathway_app') THEN
    GRANT app_authenticated TO pathway_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neondb_owner') THEN
    GRANT app_authenticated TO neondb_owner;
  END IF;
END $$;
