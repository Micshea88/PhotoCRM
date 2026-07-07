ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_share_link_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_share_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_scan_diagnostics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_log_org_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
CREATE POLICY "items_org_isolation" ON "items" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
CREATE POLICY "files_org_isolation" ON "files" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
CREATE POLICY "file_share_link_events_org_isolation" ON "file_share_link_events" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
CREATE POLICY "file_share_links_org_isolation" ON "file_share_links" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
CREATE POLICY "org_preferences_org_isolation" ON "org_preferences" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
CREATE POLICY "file_scan_diagnostics_org_isolation" ON "file_scan_diagnostics" AS PERMISSIVE FOR ALL TO public USING (org_id = current_setting('app.current_org', true)) WITH CHECK (org_id = current_setting('app.current_org', true));--> statement-breakpoint
-- FORCE RLS hand-appended per AGENTS.md §10a (drizzle-kit emits ENABLE, not
-- FORCE). FORCE is what makes the policy apply to the BYPASSRLS table owner
-- once the runtime SET LOCAL ROLE app_authenticated drops into a non-bypass role.
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_share_link_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_share_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_scan_diagnostics" FORCE ROW LEVEL SECURITY;