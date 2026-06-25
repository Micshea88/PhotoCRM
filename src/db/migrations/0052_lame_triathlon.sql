CREATE TABLE "file_share_link_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"share_link_id" text NOT NULL,
	"event_type" text NOT NULL,
	"recipient_email" text,
	"actor_user_id" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"file_id" text NOT NULL,
	"token" text NOT NULL,
	"passcode_hash" text,
	"passcode_plaintext" text,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version_id" text,
	"content_hash" text,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"failed_passcode_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "file_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "org_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"default_share_link_expiration" text DEFAULT '1 month' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "tracking_pixel_id" text;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "first_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "last_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_share_link_events" ADD CONSTRAINT "file_share_link_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_share_link_events" ADD CONSTRAINT "file_share_link_events_share_link_id_file_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."file_share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_share_link_events" ADD CONSTRAINT "file_share_link_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_share_links" ADD CONSTRAINT "file_share_links_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_share_links" ADD CONSTRAINT "file_share_links_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_share_links" ADD CONSTRAINT "file_share_links_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_share_links" ADD CONSTRAINT "file_share_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_preferences" ADD CONSTRAINT "org_preferences_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_share_link_events_link_idx" ON "file_share_link_events" USING btree ("share_link_id","occurred_at");--> statement-breakpoint
CREATE INDEX "file_share_links_org_file_idx" ON "file_share_links" USING btree ("organization_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_preferences_org_uidx" ON "org_preferences" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_tracking_pixel_id_unique" UNIQUE("tracking_pixel_id");