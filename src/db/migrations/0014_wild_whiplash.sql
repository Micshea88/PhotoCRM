CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"object_type" text NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text,
	"shared" boolean DEFAULT false NOT NULL,
	"filters" jsonb,
	"sort" jsonb,
	"visible_columns" jsonb,
	"grouping" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"custom_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_org_owner_object_name_uidx" ON "saved_views" USING btree ("organization_id","owner_user_id","object_type","name") WHERE "saved_views"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "saved_views_org_object_deleted_idx" ON "saved_views" USING btree ("organization_id","object_type","deleted_at");--> statement-breakpoint
CREATE INDEX "saved_views_org_owner_deleted_idx" ON "saved_views" USING btree ("organization_id","owner_user_id","deleted_at");--> statement-breakpoint

-- ROW-LEVEL SECURITY -----------------------------------------------------
-- Org isolation only. Owner-vs-shared visibility is enforced at the
-- queries.ts layer (we don't push the current user id into the RLS
-- session settings in V1). See README.
ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_views" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "saved_views_org_isolation" ON "saved_views"
  USING ("organization_id" = current_setting('app.current_org', true));