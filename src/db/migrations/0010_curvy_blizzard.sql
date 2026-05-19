CREATE TABLE "project_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "project_photographers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"confirmation_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "project_sub_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"event_type" text NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"event_date" date,
	"venue" text,
	"photographer_user_id" text,
	"gallery_delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"project_type" text,
	"lifecycle_status" text,
	"primary_date" date,
	"start_datetime" timestamp with time zone,
	"end_datetime" timestamp with time zone,
	"hours_of_coverage" integer,
	"photographer_count" integer,
	"primary_venue_name" text,
	"primary_venue_address" jsonb,
	"primary_venue_coordinates" jsonb,
	"ceremony_venue" jsonb,
	"reception_venue" jsonb,
	"venue_notes" text,
	"package_name" text,
	"package_base_price_cents" integer,
	"line_items" jsonb,
	"subtotal_cents" integer,
	"discount_type" text,
	"discount_value" integer,
	"tax_rate_bps" integer,
	"tax_sign" text,
	"tax_amount_cents" integer,
	"total_value_cents" integer,
	"anniversary_date" date,
	"sun_data" jsonb,
	"lead_source" text,
	"referred_by_contact_id" text,
	"project_notes" text,
	"internal_notes" text,
	"custom_fields" jsonb,
	"template_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photographers" ADD CONSTRAINT "project_photographers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photographers" ADD CONSTRAINT "project_photographers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photographers" ADD CONSTRAINT "project_photographers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photographers" ADD CONSTRAINT "project_photographers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photographers" ADD CONSTRAINT "project_photographers_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sub_events" ADD CONSTRAINT "project_sub_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sub_events" ADD CONSTRAINT "project_sub_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sub_events" ADD CONSTRAINT "project_sub_events_photographer_user_id_user_id_fk" FOREIGN KEY ("photographer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sub_events" ADD CONSTRAINT "project_sub_events_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sub_events" ADD CONSTRAINT "project_sub_events_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_referred_by_contact_id_contacts_id_fk" FOREIGN KEY ("referred_by_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_contacts_project_role_idx" ON "project_contacts" USING btree ("project_id","role");--> statement-breakpoint
CREATE INDEX "project_contacts_org_contact_idx" ON "project_contacts" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "project_photographers_project_idx" ON "project_photographers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_photographers_user_idx" ON "project_photographers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_photographers_org_user_idx" ON "project_photographers" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "project_sub_events_project_idx" ON "project_sub_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_sub_events_org_date_idx" ON "project_sub_events" USING btree ("organization_id","event_date");--> statement-breakpoint
CREATE INDEX "projects_org_deleted_created_idx" ON "projects" USING btree ("organization_id","deleted_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "projects_org_lifecycle_deleted_idx" ON "projects" USING btree ("organization_id","lifecycle_status","deleted_at");--> statement-breakpoint
CREATE INDEX "projects_org_primary_date_idx" ON "projects" USING btree ("organization_id","primary_date","deleted_at");--> statement-breakpoint
CREATE INDEX "projects_org_type_deleted_idx" ON "projects" USING btree ("organization_id","project_type","deleted_at");--> statement-breakpoint

-- ROW-LEVEL SECURITY -----------------------------------------------------
-- Org isolation for all 4 tables. The assignment-scoped overlay
-- (photographer/contractor/editor sees only their assigned projects + the
-- contacts on those projects) is DEFERRED to the invoices module commit
-- per scope discipline — do not pull it forward here.
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "projects_org_isolation" ON "projects"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "project_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "project_contacts_org_isolation" ON "project_contacts"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "project_photographers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_photographers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "project_photographers_org_isolation" ON "project_photographers"
  USING ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "project_sub_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_sub_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "project_sub_events_org_isolation" ON "project_sub_events"
  USING ("organization_id" = current_setting('app.current_org', true));