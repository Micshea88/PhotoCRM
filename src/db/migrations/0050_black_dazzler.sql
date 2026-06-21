ALTER TABLE "contact_notes" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD COLUMN "opportunity_id" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "opportunity_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "opportunity_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD COLUMN "opportunity_id" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "opportunity_id" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_log_org_project_idx" ON "call_log" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "meetings_org_project_idx" ON "meetings" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "sms_messages_org_project_idx" ON "sms_messages" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "email_log_org_project_idx" ON "email_log" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "email_log_org_thread_idx" ON "email_log" USING btree ("organization_id","thread_id");