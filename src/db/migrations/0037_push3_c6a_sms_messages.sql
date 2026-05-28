-- Push 3 (C6a) — sms_messages placeholder. See
-- src/modules/sms-messages/schema.ts. Provider integration lands in
-- V1.5; for V1 the activity feed reads an empty result set when no
-- rows exist.

CREATE TABLE IF NOT EXISTS "sms_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "contact_id" text NOT NULL,
  "direction" text NOT NULL,
  "body" text NOT NULL,
  "sent_at" timestamp with time zone NOT NULL,
  "provider_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_by_user_id" text,
  "deleted_at" timestamp with time zone,
  "deleted_by" text
);
--> statement-breakpoint

ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_sent_by_user_id_user_id_fk"
  FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_deleted_by_user_id_fk"
  FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sms_messages_org_contact_sent_idx"
  ON "sms_messages" ("organization_id", "contact_id", "sent_at" DESC);
--> statement-breakpoint

ALTER TABLE "sms_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sms_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sms_messages_org_isolation" ON "sms_messages"
  FOR ALL
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));
