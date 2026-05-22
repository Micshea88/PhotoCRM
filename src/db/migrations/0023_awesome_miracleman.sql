CREATE TABLE "org_lead_source_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_name" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "archived_by" text;--> statement-breakpoint
ALTER TABLE "org_lead_source_overrides" ADD CONSTRAINT "org_lead_source_overrides_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_lead_source_overrides" ADD CONSTRAINT "org_lead_source_overrides_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_lead_source_overrides_org_name_uidx" ON "org_lead_source_overrides" USING btree ("organization_id","source_name");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_archived_by_user_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_org_archived_deleted_idx" ON "contacts" USING btree ("organization_id","archived_at","deleted_at");--> statement-breakpoint

-- ─── ROW-LEVEL SECURITY ────────────────────────────────────────────────
-- org_lead_source_overrides: standard org-isolation. Every row carries
-- organization_id; the policy gates both SELECT and the write path on
-- the current_setting('app.current_org') match. No assignment-scoped
-- overlay needed — these are studio-wide settings, not per-record
-- permissions.

ALTER TABLE "org_lead_source_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_lead_source_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_lead_source_overrides_org_isolation" ON "org_lead_source_overrides"
  FOR ALL
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));
