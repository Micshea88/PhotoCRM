CREATE TABLE "email_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"implementation" text NOT NULL,
	"provider" text NOT NULL,
	"source_value" text NOT NULL,
	"email" text NOT NULL,
	"grant_id" text NOT NULL,
	"scopes" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"webhook_subscription_id" text,
	"webhook_secret" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "email_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_connections" ADD CONSTRAINT "email_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_connections" ADD CONSTRAINT "email_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_connections" ADD CONSTRAINT "email_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_connections" ADD CONSTRAINT "email_connections_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_connections" ADD CONSTRAINT "email_connections_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_connections_org_user_idx" ON "email_connections" USING btree ("organization_id","user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "email_connections_org_email_idx" ON "email_connections" USING btree ("organization_id","email","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_connections_org_user_provider_live_uidx" ON "email_connections" USING btree ("organization_id","user_id","provider") WHERE "email_connections"."deleted_at" IS NULL;--> statement-breakpoint
CREATE POLICY "email_connections_org_isolation" ON "email_connections" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "email_connections" FORCE ROW LEVEL SECURITY;