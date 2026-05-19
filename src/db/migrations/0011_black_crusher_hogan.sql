CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"contact_id" text,
	"pipeline_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"value_cents" integer,
	"probability_bps" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_user_id" text,
	"expected_close_date" date,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_org_pipeline_stage_idx" ON "opportunities" USING btree ("organization_id","pipeline_id","stage_id","deleted_at");--> statement-breakpoint
CREATE INDEX "opportunities_org_status_deleted_idx" ON "opportunities" USING btree ("organization_id","status","deleted_at");--> statement-breakpoint
CREATE INDEX "opportunities_org_project_deleted_idx" ON "opportunities" USING btree ("organization_id","project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "opportunities_org_owner_deleted_idx" ON "opportunities" USING btree ("organization_id","owner_user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "opportunities_stage_changed_idx" ON "opportunities" USING btree ("stage_id","stage_changed_at");--> statement-breakpoint

-- ROW-LEVEL SECURITY -----------------------------------------------------
-- Single org-isolation policy. Phase 4 may add role-gated reads for
-- non-owners (the forecasting reports are financial-visible only) but
-- that lives with the invoices financial-RLS commit.
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "opportunities_org_isolation" ON "opportunities"
  USING ("organization_id" = current_setting('app.current_org', true));