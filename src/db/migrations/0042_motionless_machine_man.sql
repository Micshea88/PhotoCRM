CREATE TABLE "telephony_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"external_user_id" text NOT NULL,
	"webhook_subscription_id" text,
	"validation_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "telephony_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telephony_connections" ADD CONSTRAINT "telephony_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telephony_connections" ADD CONSTRAINT "telephony_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telephony_connections" ADD CONSTRAINT "telephony_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telephony_connections" ADD CONSTRAINT "telephony_connections_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telephony_connections" ADD CONSTRAINT "telephony_connections_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telephony_connections_org_user_idx" ON "telephony_connections" USING btree ("organization_id","user_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telephony_connections_org_user_provider_live_uidx" ON "telephony_connections" USING btree ("organization_id","user_id","provider") WHERE "telephony_connections"."deleted_at" IS NULL;--> statement-breakpoint
CREATE POLICY "telephony_connections_org_isolation" ON "telephony_connections" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org', true)) WITH CHECK (organization_id = current_setting('app.current_org', true));--> statement-breakpoint
-- FALLBACK convention (see AGENTS.md hard rule 10a): drizzle-kit emits
-- ENABLE ROW LEVEL SECURITY for tables with `.enableRLS()`, but does NOT
-- emit FORCE — and FORCE is what makes RLS apply to the table owner.
-- Every org table in this repo is FORCE. Manually appended here after
-- the auto-generated CREATE POLICY above; the snapshot is left untouched
-- (drizzle-kit doesn't model FORCE in its snapshot, so this append
-- doesn't cause a generate-time delta).
ALTER TABLE "telephony_connections" FORCE ROW LEVEL SECURITY;