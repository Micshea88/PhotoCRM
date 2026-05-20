ALTER TABLE "ai_assistant_messages" ADD COLUMN "write_proposal_action" text;--> statement-breakpoint
ALTER TABLE "ai_assistant_messages" ADD COLUMN "write_proposal_input" jsonb;--> statement-breakpoint
ALTER TABLE "ai_assistant_messages" ADD COLUMN "write_proposal_status" text;--> statement-breakpoint
ALTER TABLE "ai_assistant_messages" ADD COLUMN "resulting_resource_type" text;--> statement-breakpoint
ALTER TABLE "ai_assistant_messages" ADD COLUMN "resulting_resource_id" text;