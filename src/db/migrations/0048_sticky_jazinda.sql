ALTER TABLE "tasks" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "contact_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_org_contact_deleted_idx" ON "tasks" USING btree ("organization_id","contact_id","deleted_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_or_contact_chk" CHECK ("tasks"."project_id" IS NOT NULL OR "tasks"."contact_id" IS NOT NULL);