CREATE TABLE "member_permission_override" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"permission_key" text NOT NULL,
	"granted" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_permission_override" ADD CONSTRAINT "member_permission_override_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission_override" ADD CONSTRAINT "member_permission_override_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_role" ADD CONSTRAINT "member_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_role" ADD CONSTRAINT "member_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_permission_override_uidx" ON "member_permission_override" USING btree ("organization_id","user_id","permission_key");--> statement-breakpoint
CREATE INDEX "member_permission_override_org_user_idx" ON "member_permission_override" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_role_org_user_uidx" ON "member_role" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_role_org_idx" ON "member_role" USING btree ("organization_id");--> statement-breakpoint

-- ROW-LEVEL SECURITY -----------------------------------------------------
-- Two-policy pattern per Implementation Guide §3 rule 4: one permissive
-- SELECT policy for any member of the org (so a photographer can see who
-- the admins are), plus a permissive FOR ALL policy with an admin-role
-- gate in both USING and WITH CHECK. Postgres permissive policies combine
-- with OR — non-admins satisfy the SELECT policy but not the write policy,
-- so reads work and writes fail. WITH CHECK rejects cross-role INSERTs
-- with a "row-level security" error; cross-role UPDATE/DELETE silently
-- affect zero rows (Postgres policy semantics — there's no "wrong role"
-- error for those, the rows just aren't visible to write).

ALTER TABLE "member_role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_role" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "member_role_org_select" ON "member_role"
  FOR SELECT
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint
CREATE POLICY "member_role_admin_write" ON "member_role"
  FOR ALL
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_role', true) IN ('owner', 'admin')
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_role', true) IN ('owner', 'admin')
  );--> statement-breakpoint

ALTER TABLE "member_permission_override" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_permission_override" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "member_permission_override_org_select" ON "member_permission_override"
  FOR SELECT
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint
CREATE POLICY "member_permission_override_admin_write" ON "member_permission_override"
  FOR ALL
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_role', true) IN ('owner', 'admin')
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND current_setting('app.current_role', true) IN ('owner', 'admin')
  );