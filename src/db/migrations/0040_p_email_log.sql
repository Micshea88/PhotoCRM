CREATE TABLE "email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text,
	"user_id" text,
	"direction" text NOT NULL,
	"subject" text,
	"body" text,
	"sent_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"external_metadata" jsonb,
	"attachments" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "email_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_log_org_contact_sent_idx" ON "email_log" USING btree ("organization_id","contact_id","deleted_at","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_log_org_sent_idx" ON "email_log" USING btree ("organization_id","deleted_at","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "email_log_org_source_external_uidx" ON "email_log" USING btree ("organization_id","source","external_id") WHERE "email_log"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "email_log_org_isolation" ON "email_log" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
-- FALLBACK convention (see AGENTS.md → "Migrations + RLS"): drizzle-kit
-- emits ENABLE ROW LEVEL SECURITY for tables with `.enableRLS()`, but
-- does NOT emit FORCE — and FORCE is what makes RLS apply to the table
-- owner. Every org table in this repo is FORCE. Manually appended here
-- after the auto-generated CREATE POLICY above; the snapshot is left
-- untouched (drizzle-kit doesn't model FORCE in its snapshot, so this
-- append doesn't cause a generate-time delta).
ALTER TABLE "email_log" FORCE ROW LEVEL SECURITY;