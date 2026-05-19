CREATE TABLE "pipeline_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"name" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"probability" integer,
	"color" text,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_pipeline_name_uidx" ON "pipeline_stages" USING btree ("pipeline_id","name") WHERE "pipeline_stages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pipeline_stages_pipeline_deleted_order_idx" ON "pipeline_stages" USING btree ("pipeline_id","deleted_at","order");--> statement-breakpoint
CREATE INDEX "pipeline_stages_org_deleted_idx" ON "pipeline_stages" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_org_name_uidx" ON "pipelines" USING btree ("organization_id","name") WHERE "pipelines"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pipelines_org_type_deleted_idx" ON "pipelines" USING btree ("organization_id","type","deleted_at");--> statement-breakpoint
CREATE INDEX "pipelines_org_deleted_order_idx" ON "pipelines" USING btree ("organization_id","deleted_at","display_order");--> statement-breakpoint

-- ROW-LEVEL SECURITY -----------------------------------------------------
-- Single org-isolation policy on both tables. Any org member can read AND
-- write pipelines + stages — they're configurable per-org and managers
-- need to tune them without admin intervention. Phase 4 may add a
-- manager-and-above write gate if config drift becomes a problem; the
-- (org, role) policy pattern is already proven by the rbac module.
ALTER TABLE "pipelines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pipelines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "pipelines_org_isolation" ON "pipelines"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "pipeline_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pipeline_stages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "pipeline_stages_org_isolation" ON "pipeline_stages"
  USING ("organization_id" = current_setting('app.current_org', true));