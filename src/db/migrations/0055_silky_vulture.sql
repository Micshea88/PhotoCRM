CREATE TABLE "email_delivery_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email_log_id" text NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"bounce_class" text,
	"detail" jsonb,
	"provider_event_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_delivery_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_events" ADD CONSTRAINT "email_delivery_events_email_log_id_email_log_id_fk" FOREIGN KEY ("email_log_id") REFERENCES "public"."email_log"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_events_org_provider_event_uidx" ON "email_delivery_events" USING btree ("organization_id","provider_event_id") WHERE "email_delivery_events"."provider_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_delivery_events_org_log_occurred_idx" ON "email_delivery_events" USING btree ("organization_id","email_log_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "email_delivery_events_org_isolation" ON "email_delivery_events" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "email_delivery_events" FORCE ROW LEVEL SECURITY;