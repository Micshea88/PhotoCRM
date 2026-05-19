CREATE TABLE "workflow_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"trigger_event_type" text NOT NULL,
	"trigger_event_id" text NOT NULL,
	"trigger_payload" jsonb,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_step_no" integer,
	"step_results" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"sequence_no" integer NOT NULL,
	"action_type" text NOT NULL,
	"action_config" jsonb,
	"branch_condition" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"trigger_config" jsonb,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"custom_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_executions_idempotency_uidx" ON "workflow_executions" USING btree ("organization_id","workflow_id","idempotency_key") WHERE "workflow_executions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workflow_executions_org_status_started_idx" ON "workflow_executions" USING btree ("organization_id","status","started_at");--> statement-breakpoint
CREATE INDEX "workflow_executions_org_workflow_status_idx" ON "workflow_executions" USING btree ("organization_id","workflow_id","status","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_steps_workflow_seq_uidx" ON "workflow_steps" USING btree ("workflow_id","sequence_no");--> statement-breakpoint
CREATE INDEX "workflow_steps_org_idx" ON "workflow_steps" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_org_name_uidx" ON "workflows" USING btree ("organization_id","name") WHERE "workflows"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workflows_org_trigger_enabled_idx" ON "workflows" USING btree ("organization_id","trigger_type","enabled","deleted_at");--> statement-breakpoint
CREATE INDEX "workflows_org_deleted_idx" ON "workflows" USING btree ("organization_id","deleted_at");--> statement-breakpoint

-- ─── RLS: standard org isolation on all 3 tables ──────────────────────
-- Workflow definitions are owner/admin/manager-only via the existing
-- action-layer `hasPermission('manage_workflows')` check (see
-- src/modules/rbac/queries.ts). No new role gate at the RLS layer —
-- standard single org-isolation per workflows/README.md.
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "workflows_org_isolation" ON "workflows"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "workflow_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "workflow_steps_org_isolation" ON "workflow_steps"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "workflow_executions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_executions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "workflow_executions_org_isolation" ON "workflow_executions"
  USING ("organization_id" = current_setting('app.current_org', true));