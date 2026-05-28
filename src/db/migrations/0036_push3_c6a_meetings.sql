-- Push 3 (C6a) — meetings table. See src/modules/meetings/schema.ts.

CREATE TABLE IF NOT EXISTS "meetings" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "contact_id" text NOT NULL,
  "subject" text,
  "notes" text,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone,
  "location" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "updated_by" text,
  "deleted_at" timestamp with time zone,
  "deleted_by" text
);
--> statement-breakpoint

ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_created_by_user_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_updated_by_user_id_fk"
  FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_deleted_by_user_id_fk"
  FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "meetings_org_contact_starts_idx"
  ON "meetings" ("organization_id", "contact_id", "starts_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_org_starts_idx"
  ON "meetings" ("organization_id", "deleted_at", "starts_at" DESC);
--> statement-breakpoint

-- RLS: standard FOR ALL policy gating org-scoped tables.
ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "meetings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "meetings_org_isolation" ON "meetings"
  FOR ALL
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));
