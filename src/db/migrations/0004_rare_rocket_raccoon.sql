CREATE TABLE "terminology_map" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"object_key" text NOT NULL,
	"label_singular" text NOT NULL,
	"label_plural" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "terminology_map" ADD CONSTRAINT "terminology_map_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "terminology_map_org_object_uidx" ON "terminology_map" USING btree ("organization_id","object_key");--> statement-breakpoint
CREATE INDEX "terminology_map_org_idx" ON "terminology_map" USING btree ("organization_id");--> statement-breakpoint

-- ROW-LEVEL SECURITY (RLS) -----------------------------------------------
-- Per Implementation Guide §3: every org-scoped table's policy ships in the
-- creating migration. FORCE so even the table owner is subject to the policy.
-- USING is reused as WITH CHECK for INSERT/UPDATE, so writes that don't set
-- app.current_org are rejected — the policy enforces both visibility and
-- write-side org binding. current_setting(..., true) returns NULL when unset;
-- NULL = anything is NULL (not true), so rows are invisible without context.
ALTER TABLE "terminology_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "terminology_map" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "terminology_map_org_isolation" ON "terminology_map"
  USING ("organization_id" = current_setting('app.current_org', true));