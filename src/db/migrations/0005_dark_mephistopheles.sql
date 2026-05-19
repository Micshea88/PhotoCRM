CREATE TABLE "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"record_type" text NOT NULL,
	"name" text NOT NULL,
	"field_type" text NOT NULL,
	"options" jsonb,
	"folder" text,
	"order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"formula" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_org_record_name_uidx" ON "custom_field_definitions" USING btree ("organization_id","record_type","name") WHERE "custom_field_definitions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "custom_field_definitions_org_record_order_idx" ON "custom_field_definitions" USING btree ("organization_id","record_type","deleted_at","order");--> statement-breakpoint

-- ROW-LEVEL SECURITY (RLS) -----------------------------------------------
-- Same pattern as terminology_map (migration 0004): policy ships in the
-- creating migration. USING is reused as WITH CHECK for INSERT/UPDATE,
-- which rejects cross-org writes. Unset app.current_org → NULL → no rows.
ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "custom_field_definitions_org_isolation" ON "custom_field_definitions"
  USING ("organization_id" = current_setting('app.current_org', true));