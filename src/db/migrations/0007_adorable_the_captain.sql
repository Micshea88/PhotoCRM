CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"main_phone" text,
	"instagram_handle" text,
	"category" text,
	"custom_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_org_name_uidx" ON "companies" USING btree ("organization_id","name") WHERE "companies"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "companies_org_deleted_created_idx" ON "companies" USING btree ("organization_id","deleted_at","created_at" DESC NULLS LAST);--> statement-breakpoint

-- ROW-LEVEL SECURITY -----------------------------------------------------
-- Single-policy org isolation. Companies are shared lightweight references;
-- any org member can read and write (no role gate). Phase 4 may add a
-- writes-by-managers-and-above restriction if it becomes a real concern.
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "companies_org_isolation" ON "companies"
  USING ("organization_id" = current_setting('app.current_org', true));