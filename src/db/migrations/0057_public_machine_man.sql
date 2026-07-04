ALTER TABLE "email_connections" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_connections" ADD COLUMN "expired_reason" text;