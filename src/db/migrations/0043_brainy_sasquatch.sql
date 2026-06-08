ALTER TABLE "telephony_connections" ADD COLUMN "sip_info_cached" text;--> statement-breakpoint
ALTER TABLE "telephony_connections" ADD COLUMN "sip_info_cached_at" timestamp with time zone;