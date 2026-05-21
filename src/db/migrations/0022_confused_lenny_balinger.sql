CREATE TABLE "contact_company_associations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"company_id" text NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "contact_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "call_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text,
	"user_id" text,
	"direction" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer,
	"notes" text,
	"recording_file_id" text,
	"source" text NOT NULL,
	"external_id" text,
	"external_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "faq_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"category" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contact_company_associations" ADD CONSTRAINT "contact_company_associations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_associations" ADD CONSTRAINT "contact_company_associations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_associations" ADD CONSTRAINT "contact_company_associations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_associations" ADD CONSTRAINT "contact_company_associations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_recording_file_id_files_id_fk" FOREIGN KEY ("recording_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_company_assoc_uidx" ON "contact_company_associations" USING btree ("organization_id","contact_id","company_id",COALESCE("role", ''));--> statement-breakpoint
CREATE INDEX "contact_company_assoc_org_contact_idx" ON "contact_company_associations" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_company_assoc_org_company_idx" ON "contact_company_associations" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "contact_notes_org_contact_deleted_idx" ON "contact_notes" USING btree ("organization_id","contact_id","deleted_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "call_log_org_contact_started_idx" ON "call_log" USING btree ("organization_id","contact_id","deleted_at","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "call_log_org_started_idx" ON "call_log" USING btree ("organization_id","deleted_at","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "call_log_org_source_external_uidx" ON "call_log" USING btree ("organization_id","source","external_id") WHERE "call_log"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "faq_entries_category_order_idx" ON "faq_entries" USING btree ("category","display_order","deleted_at");--> statement-breakpoint

-- ─── ROW-LEVEL SECURITY ────────────────────────────────────────────────
-- Org-isolation on the three contact-related tables. Queries that read
-- through contacts (notes / call_log / associations) naturally inherit
-- the assignment-scoped overlay on contacts because the queries.ts
-- layer filters by contact_id and contact_id is gated by contacts RLS.

ALTER TABLE "contact_company_associations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_company_associations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "contact_company_associations_org_isolation" ON "contact_company_associations"
  FOR ALL
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "contact_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "contact_notes_org_isolation" ON "contact_notes"
  FOR ALL
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "call_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "call_log_org_isolation" ON "call_log"
  FOR ALL
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));

-- faq_entries is INTENTIONALLY not RLS-enabled. Global product
-- documentation table (no organization_id column). Edit access is
-- gated at the application layer.

-- ─── FAQ SEED ──────────────────────────────────────────────────────────
-- Starter FAQ entries. The product name is intentionally generic ("this
-- CRM" / "the app") since the user has indicated "PhotoCRM" is a
-- placeholder name. Idempotent via ON CONFLICT DO NOTHING on the id
-- column — re-running this migration on a populated DB is a no-op.

INSERT INTO "faq_entries" ("id", "question", "answer", "category", "display_order") VALUES
  ('faq_intro_what_is', 'What is this CRM?',
   'This is a customer relationship and project management application built for studios. You can track contacts, events, opportunities, tasks, and the work that flows between them. It is designed to keep the day-to-day operations of your studio in one place.',
   'Getting started', 10),
  ('faq_intro_create_studio', 'How do I create a studio?',
   'After signing up, you are prompted to create a studio (organization). The studio is your workspace — all your contacts, events, and team members belong to it. Pick a name and a URL slug, and you are in.',
   'Getting started', 20),
  ('faq_intro_invite_team', 'How do I invite a team member?',
   'Open Settings from the user menu in the top-right, then click Members. Enter the team member''s email and select a role, then send the invite. They will get an email with a link to accept.',
   'Getting started', 30),
  ('faq_contacts_add', 'How do I add a contact?',
   'Open Contacts from the left sidebar and click "New contact." Fill in at least a first and last name; everything else is optional. You can link the contact to a company, add notes, and tag them. Save when done.',
   'Contacts', 10),
  ('faq_contacts_log_call', 'How do I log a phone call?',
   'Open the contact''s detail page, then click "Log Call." Pick the date, direction (incoming, outgoing, or missed), duration, and any notes. Optionally upload an audio recording. The call lands in the contact''s activity feed.',
   'Contacts', 20),
  ('faq_contacts_notes', 'How do I add a note to a contact?',
   'Open the contact''s detail page, then click "Add Note." Type the note and save. Notes are timestamped and show up in the contact''s activity feed under the "Notes" filter.',
   'Contacts', 30),
  ('faq_contacts_trash', 'Where do deleted contacts go?',
   'Deleting a contact moves it to the trash, not permanent deletion. From the Contacts list, open the "⋮" menu in the top-right and choose "Trash" to see deleted contacts. You can restore them individually or in bulk. After 90 days the system permanently purges them.',
   'Contacts', 40),
  ('faq_contacts_companies', 'A contact works at multiple companies. How do I track that?',
   'Open the contact''s detail page and go to the Companies tab. The primary company is shown at the top. Below it, click "Add another company" to link additional companies. You can optionally label each association with a role (e.g., "Owner", "Billing Contact").',
   'Contacts', 50)
ON CONFLICT (id) DO NOTHING;