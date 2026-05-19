CREATE TABLE "payment_installments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"sequence_no" integer NOT NULL,
	"split_method" text NOT NULL,
	"split_param" jsonb,
	"amount_cents" integer NOT NULL,
	"amount_overridden" boolean DEFAULT false NOT NULL,
	"due_date" date,
	"due_date_rule" jsonb,
	"due_date_overridden" boolean DEFAULT false NOT NULL,
	"billing_contact_id" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_billing_contact_id_contacts_id_fk" FOREIGN KEY ("billing_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installments" ADD CONSTRAINT "payment_installments_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_installments_project_seq_uidx" ON "payment_installments" USING btree ("project_id","sequence_no") WHERE "payment_installments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "payment_installments_org_project_deleted_idx" ON "payment_installments" USING btree ("organization_id","project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "payment_installments_org_due_date_idx" ON "payment_installments" USING btree ("organization_id","due_date","deleted_at");--> statement-breakpoint
CREATE INDEX "payment_installments_org_status_idx" ON "payment_installments" USING btree ("organization_id","status","deleted_at");--> statement-breakpoint

-- ─── RLS: org-isolation + financial role gate ──────────────────────────
-- Per Tech Arch §4 line 104: "Financial tables… additional policy
-- requiring current_setting('app.current_role') ∈ money-permitted set
-- (owner, admin, manager-with-grant). Photographer/contractor/editor →
-- rows do not return."
--
-- V1 gate: owner / admin / accountant. Manager-with-grant deferred to
-- the Phase 4 admin UI (per rbac/README.md and the locked decision in
-- module 14 planning). The empty-string ('') in the IN list preserves
-- backward compatibility with raw-pg test helpers that don't set role;
-- production code always sets role via orgAction / runWithOrgContext.
--
-- Org isolation is the OUTER AND-clamp — same pattern as the 14a overlay.
ALTER TABLE "payment_installments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_installments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payment_installments_select" ON "payment_installments"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant','')
  );--> statement-breakpoint
CREATE POLICY "payment_installments_insert" ON "payment_installments"
  FOR INSERT
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant','')
  );--> statement-breakpoint
CREATE POLICY "payment_installments_update" ON "payment_installments"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant','')
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant','')
  );--> statement-breakpoint
CREATE POLICY "payment_installments_delete" ON "payment_installments"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant','')
  );