CREATE TABLE "ai_workflow_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requester_user_id" text,
	"prompt" text NOT NULL,
	"model_name" text NOT NULL,
	"model_tokens_used" integer,
	"raw_model_output" jsonb,
	"validation_result" jsonb,
	"validated_draft" jsonb,
	"rendered_prose" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"refusal_reason" text,
	"resulting_workflow_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "ai_workflow_drafts" ADD CONSTRAINT "ai_workflow_drafts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_workflow_drafts" ADD CONSTRAINT "ai_workflow_drafts_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_workflow_drafts" ADD CONSTRAINT "ai_workflow_drafts_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_workflow_drafts_org_user_created_idx" ON "ai_workflow_drafts" USING btree ("organization_id","requester_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_workflow_drafts_org_status_created_idx" ON "ai_workflow_drafts" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_workflow_drafts_org_deleted_idx" ON "ai_workflow_drafts" USING btree ("organization_id","deleted_at");--> statement-breakpoint

-- Standard single org-isolation RLS. The AI-write back-channel does
-- NOT bypass orgAction; this table is org-scoped like every other
-- product table. The `manage_workflows` permission check is at the
-- action layer (matches Module 15 workflows table).
ALTER TABLE "ai_workflow_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_workflow_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_workflow_drafts_org_isolation" ON "ai_workflow_drafts"
  USING ("organization_id" = current_setting('app.current_org', true));