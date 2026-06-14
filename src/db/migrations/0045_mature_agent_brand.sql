CREATE TABLE "rc_sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"rc_call_id" text,
	"telephony_session_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rc_sync_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "rc_call_id" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "rc_last_modified_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "disposition_source" text DEFAULT 'heuristic' NOT NULL;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "rc_result" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "rc_recording_url" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "rc_recording_id" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "transcript_status" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "ai_notes" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "ai_notes_original" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "ai_notes_status" text;--> statement-breakpoint
ALTER TABLE "rc_sync_jobs" ADD CONSTRAINT "rc_sync_jobs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rc_sync_jobs_status_scheduled_idx" ON "rc_sync_jobs" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "rc_sync_jobs_org_rc_call_idx" ON "rc_sync_jobs" USING btree ("organization_id","rc_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_log_org_rc_call_id_uidx" ON "call_log" USING btree ("organization_id","rc_call_id") WHERE "call_log"."rc_call_id" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "rc_sync_jobs_org_isolation" ON "rc_sync_jobs" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
-- AGENTS.md rule 10a: drizzle-kit emits ENABLE but not FORCE; FORCE is what
-- makes RLS apply to the table owner. This is the one permitted hand-edit.
ALTER TABLE "rc_sync_jobs" FORCE ROW LEVEL SECURITY;