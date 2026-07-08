ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
-- FORCE RLS hand-appended per AGENTS.md §10a — drizzle-kit emits ENABLE, not FORCE.
-- FORCE is what makes the policy apply to the BYPASSRLS table owner (e.g. neondb_owner
-- in prod) once SET LOCAL ROLE app_authenticated drops into a non-bypass role.
ALTER TABLE "user_preferences" FORCE ROW LEVEL SECURITY;
