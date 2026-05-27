CREATE TABLE "user_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_preferences_user_org_key_uidx" ON "user_preferences" USING btree ("user_id","organization_id","key") WHERE "user_preferences"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_preferences_user_key_global_uidx" ON "user_preferences" USING btree ("user_id","key") WHERE "user_preferences"."organization_id" IS NULL;--> statement-breakpoint
CREATE INDEX "user_preferences_user_org_idx" ON "user_preferences" USING btree ("user_id","organization_id");--> statement-breakpoint

-- ============================================================================
-- Push 3 C2 — RLS on user_preferences
-- ============================================================================
-- This table is user-scoped (not org-scoped). Policies key on the
-- `app.current_user_id` GUC that orgAction/authAction set alongside
-- `app.current_org`. The GUC is also set by every queries.ts caller
-- via `withOrgContext()` → org-context.ts.
--
-- Cross-user reads/writes are blocked at the DB layer. The action
-- layer also filters explicitly on user_id for query-plan clarity;
-- RLS is defense-in-depth.
-- ============================================================================

ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "user_preferences_select" ON "user_preferences"
  FOR SELECT
  USING (
    "user_id" = current_setting('app.current_user_id', true)
  );--> statement-breakpoint

CREATE POLICY "user_preferences_insert" ON "user_preferences"
  FOR INSERT
  WITH CHECK (
    "user_id" = current_setting('app.current_user_id', true)
  );--> statement-breakpoint

CREATE POLICY "user_preferences_update" ON "user_preferences"
  FOR UPDATE
  USING (
    "user_id" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    "user_id" = current_setting('app.current_user_id', true)
  );--> statement-breakpoint

CREATE POLICY "user_preferences_delete" ON "user_preferences"
  FOR DELETE
  USING (
    "user_id" = current_setting('app.current_user_id', true)
  );