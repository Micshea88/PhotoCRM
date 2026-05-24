-- Push 2c.6.4 (Part 3) — invitation_extended_role table.
--
-- Persists the 4-internal-role pick (Admin/Manager/User/Accountant)
-- alongside Better Auth's invitation row, which only carries the 3
-- BA roles. The afterAcceptInvitation hook reads this on accept,
-- seeds member_role with the stored extended role, and the cascade
-- on invitation deletion cleans the row up automatically.
--
-- RLS overlay mirrors member_role (0006): org-isolation SELECT plus
-- admin/owner-only write gate via the app.current_role GUC.

CREATE TABLE "invitation_extended_role" (
	"invitation_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"extended_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "invitation_extended_role" ADD CONSTRAINT "invitation_extended_role_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_extended_role" ADD CONSTRAINT "invitation_extended_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_extended_role" ADD CONSTRAINT "invitation_extended_role_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_extended_role_org_idx" ON "invitation_extended_role" USING btree ("organization_id");--> statement-breakpoint

-- ─── RLS — same pattern as member_role (0006) ──────────────────────────────
ALTER TABLE "invitation_extended_role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_extended_role" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "invitation_extended_role_org_select" ON "invitation_extended_role"
  FOR SELECT
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

CREATE POLICY "invitation_extended_role_admin_write" ON "invitation_extended_role"
  FOR ALL
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_role', true) IN ('owner', 'admin')
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_role', true) IN ('owner', 'admin')
  );