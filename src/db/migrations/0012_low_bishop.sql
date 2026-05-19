CREATE TABLE "project_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"task_id" text NOT NULL,
	"label" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"assignee_user_id" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"task_id" text NOT NULL,
	"blocked_by_task_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"project_stage_id" text,
	"title" text NOT NULL,
	"description" text,
	"assignee_user_id" text,
	"assignee_role" text,
	"due_date" date,
	"status" text DEFAULT 'not_started' NOT NULL,
	"priority" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_from_template_item_id" text,
	"due_date_overridden" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"custom_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_by_task_id_tasks_id_fk" FOREIGN KEY ("blocked_by_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_stage_id_project_stages_id_fk" FOREIGN KEY ("project_stage_id") REFERENCES "public"."project_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_stages_project_name_uidx" ON "project_stages" USING btree ("project_id","name") WHERE "project_stages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "project_stages_project_order_idx" ON "project_stages" USING btree ("project_id","deleted_at","order");--> statement-breakpoint
CREATE INDEX "project_stages_org_deleted_idx" ON "project_stages" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE INDEX "task_checklist_items_task_order_idx" ON "task_checklist_items" USING btree ("task_id","order");--> statement-breakpoint
CREATE INDEX "task_checklist_items_org_idx" ON "task_checklist_items" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_dependencies_task_blocker_uidx" ON "task_dependencies" USING btree ("task_id","blocked_by_task_id");--> statement-breakpoint
CREATE INDEX "task_dependencies_blocked_by_idx" ON "task_dependencies" USING btree ("blocked_by_task_id");--> statement-breakpoint
CREATE INDEX "task_dependencies_org_idx" ON "task_dependencies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tasks_org_project_deleted_idx" ON "tasks" USING btree ("organization_id","project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "tasks_project_stage_order_idx" ON "tasks" USING btree ("project_id","project_stage_id","deleted_at","order");--> statement-breakpoint
CREATE INDEX "tasks_org_assignee_status_idx" ON "tasks" USING btree ("organization_id","assignee_user_id","status","deleted_at");--> statement-breakpoint
CREATE INDEX "tasks_org_due_date_idx" ON "tasks" USING btree ("organization_id","due_date","deleted_at");--> statement-breakpoint
CREATE INDEX "tasks_org_status_idx" ON "tasks" USING btree ("organization_id","status","deleted_at");--> statement-breakpoint

-- ROW-LEVEL SECURITY -----------------------------------------------------
-- Single org-isolation policy on all 4 tables. The assignment-scoped
-- overlay (photographer/contractor/editor only sees their assigned
-- tasks) lands with the invoices financial-RLS commit alongside the
-- projects/contacts overlay — same scope-discipline note.
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tasks_org_isolation" ON "tasks"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "task_dependencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_dependencies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "task_dependencies_org_isolation" ON "task_dependencies"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "task_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_checklist_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "task_checklist_items_org_isolation" ON "task_checklist_items"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "project_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_stages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "project_stages_org_isolation" ON "project_stages"
  USING ("organization_id" = current_setting('app.current_org', true));