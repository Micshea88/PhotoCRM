-- Push 3 (C6b) — ai_usage_log table. See src/modules/contacts/ai/ai-usage-schema.ts.

CREATE TABLE IF NOT EXISTS "ai_usage_log" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "feature" text NOT NULL,
  "model" text NOT NULL,
  "contact_id" text,
  "tokens_used" integer,
  "ok" text NOT NULL,
  "error_message" text,
  "triggered_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "ai_usage_log"
  ADD CONSTRAINT "ai_usage_log_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ai_usage_log"
  ADD CONSTRAINT "ai_usage_log_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "ai_usage_log"
  ADD CONSTRAINT "ai_usage_log_triggered_by_user_id_user_id_fk"
  FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_usage_log_org_created_idx"
  ON "ai_usage_log" ("organization_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_log_org_feature_created_idx"
  ON "ai_usage_log" ("organization_id", "feature", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_log_org_contact_idx"
  ON "ai_usage_log" ("organization_id", "contact_id");
--> statement-breakpoint

ALTER TABLE "ai_usage_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_usage_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ai_usage_log_org_isolation" ON "ai_usage_log"
  FOR ALL
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));
