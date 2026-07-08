CREATE TABLE "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean NOT NULL,
	"email" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"tier" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_path" text,
	"contact_id" text,
	"payload" jsonb,
	"source_module" text NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"scheduled_for" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_type_uidx" ON "notification_preferences" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "notifications_org_recipient_read_created_idx" ON "notifications" USING btree ("organization_id","recipient_user_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_org_contact_created_idx" ON "notifications" USING btree ("organization_id","contact_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_org_recipient_category_created_idx" ON "notifications" USING btree ("organization_id","recipient_user_id","category","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_scheduled_for_idx" ON "notifications" USING btree ("scheduled_for") WHERE "notifications"."scheduled_for" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "notification_preferences_user_isolation" ON "notification_preferences" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true) AND user_id = current_setting('app.current_user_id', true)) WITH CHECK (organization_id = current_setting('app.current_org', true) AND user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "notifications_read_write" ON "notifications" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true) AND recipient_user_id = current_setting('app.current_user_id', true)) WITH CHECK (organization_id = current_setting('app.current_org', true) AND recipient_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "notifications_insert" ON "notifications" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = current_setting('app.current_org', true));
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;