ALTER TABLE "email_log" ADD COLUMN "delivery_status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "bounce_reason" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "open_human_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "open_bot_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "open_unknown_count" integer DEFAULT 0 NOT NULL;