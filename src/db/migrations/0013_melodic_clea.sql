CREATE TABLE "project_template_task_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_template_id" text NOT NULL,
	"stage_name" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"relative_offset_days" integer NOT NULL,
	"assignee_role" text,
	"blocked_by_template_item_id" text,
	"checklist_items" jsonb,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "project_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"project_type" text NOT NULL,
	"package_defaults" jsonb,
	"payment_schedule_defaults" jsonb,
	"default_workflow_ids" text[],
	"questionnaire_id" text,
	"contract_template_id" text,
	"custom_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "project_template_task_items" ADD CONSTRAINT "project_template_task_items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_task_items" ADD CONSTRAINT "project_template_task_items_project_template_id_project_templates_id_fk" FOREIGN KEY ("project_template_id") REFERENCES "public"."project_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_task_items" ADD CONSTRAINT "project_template_task_items_blocked_by_template_item_id_project_template_task_items_id_fk" FOREIGN KEY ("blocked_by_template_item_id") REFERENCES "public"."project_template_task_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_task_items" ADD CONSTRAINT "project_template_task_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_task_items" ADD CONSTRAINT "project_template_task_items_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_template_task_items_template_order_idx" ON "project_template_task_items" USING btree ("project_template_id","order");--> statement-breakpoint
CREATE INDEX "project_template_task_items_org_idx" ON "project_template_task_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_templates_org_deleted_idx" ON "project_templates" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE INDEX "project_templates_org_type_deleted_idx" ON "project_templates" USING btree ("organization_id","project_type","deleted_at");--> statement-breakpoint

-- ROW-LEVEL SECURITY -----------------------------------------------------
-- Single org-isolation policy. Phase 4 may add a manager-and-above write
-- gate (templates are admin config); for V1 any org member can manage.
ALTER TABLE "project_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "project_templates_org_isolation" ON "project_templates"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "project_template_task_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_template_task_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "project_template_task_items_org_isolation" ON "project_template_task_items"
  USING ("organization_id" = current_setting('app.current_org', true));