CREATE INDEX "companies_custom_fields_gin_idx" ON "companies" USING gin ("custom_fields");--> statement-breakpoint
CREATE INDEX "contacts_custom_fields_gin_idx" ON "contacts" USING gin ("custom_fields");--> statement-breakpoint
CREATE INDEX "projects_custom_fields_gin_idx" ON "projects" USING gin ("custom_fields");--> statement-breakpoint
CREATE INDEX "opportunities_custom_fields_gin_idx" ON "opportunities" USING gin ("custom_fields");