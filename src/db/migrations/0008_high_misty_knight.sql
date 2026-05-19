CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"company_id" text,
	"primary_email" text,
	"secondary_email" text,
	"primary_phone" text,
	"secondary_phone" text,
	"mailing_address" jsonb,
	"dob" date,
	"anniversary_date" date,
	"instagram_handle" text,
	"instagram_user_id" text,
	"facebook_url" text,
	"website" text,
	"lead_source" text,
	"source_detail" text,
	"referred_by_contact_id" text,
	"contact_type" text,
	"lifecycle_status" text,
	"tags" text[],
	"owner_user_id" text,
	"notes" text,
	"internal_notes" text,
	"custom_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_referred_by_contact_id_contacts_id_fk" FOREIGN KEY ("referred_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_org_deleted_created_idx" ON "contacts" USING btree ("organization_id","deleted_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contacts_org_type_deleted_idx" ON "contacts" USING btree ("organization_id","contact_type","deleted_at");--> statement-breakpoint
CREATE INDEX "contacts_org_company_deleted_idx" ON "contacts" USING btree ("organization_id","company_id","deleted_at");--> statement-breakpoint
CREATE INDEX "contacts_tags_gin_idx" ON "contacts" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "contacts_org_email_idx" ON "contacts" USING btree ("organization_id","primary_email");--> statement-breakpoint

-- ROW-LEVEL SECURITY -----------------------------------------------------
-- Org isolation only in V1. Phase 4 invoices module is the natural place
-- to add an assignment-scoped policy (photographers/contractors/editors
-- can only see contacts on events they're assigned to) — that requires
-- project_photographers to exist, which is a later Phase 2 module.
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "contacts_org_isolation" ON "contacts"
  USING ("organization_id" = current_setting('app.current_org', true));