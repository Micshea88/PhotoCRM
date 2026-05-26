ALTER TABLE "companies" ADD COLUMN "merged_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "merged_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
CREATE INDEX "audit_log_org_resource_created_idx" ON "audit_log" USING btree ("organization_id","resource_type","resource_id","created_at" DESC NULLS LAST);