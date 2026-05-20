CREATE TABLE "ai_assistant_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text,
	"role" text NOT NULL,
	"content" text,
	"retriever_call_name" text,
	"retriever_result_summary" text,
	"raw_model_output" jsonb,
	"validation_result" jsonb,
	"model_name" text,
	"model_tokens_used" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_assistant_messages" ADD CONSTRAINT "ai_assistant_messages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_assistant_messages" ADD CONSTRAINT "ai_assistant_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_assistant_messages_org_conv_created_idx" ON "ai_assistant_messages" USING btree ("organization_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_assistant_messages_org_user_created_idx" ON "ai_assistant_messages" USING btree ("organization_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_assistant_messages_org_role_created_idx" ON "ai_assistant_messages" USING btree ("organization_id","role","created_at");--> statement-breakpoint

-- Standard single org-isolation RLS. Module 17 ("AI Assistant") is
-- a TOOL the human drives, NOT an autonomous actor — same locked
-- principle as the workflow builder (rule AI1 in docs/PIVOTS_LEDGER.md).
-- The `use_ai_assistant` permission check is at the action layer
-- (see src/modules/rbac/types.ts).
ALTER TABLE "ai_assistant_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_assistant_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_assistant_messages_org_isolation" ON "ai_assistant_messages"
  USING ("organization_id" = current_setting('app.current_org', true));