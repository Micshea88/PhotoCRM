ALTER TABLE "contacts" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "ai_last_regen_attempt_at" timestamp with time zone;