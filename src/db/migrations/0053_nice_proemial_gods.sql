CREATE TABLE "file_scan_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" text,
	"step" text NOT NULL,
	"status" text,
	"duration_ms" integer,
	"request_id" text,
	"file_size_bytes" integer,
	"filename" text,
	"error_message" text,
	"response_payload" jsonb,
	"metadata" jsonb,
	"org_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_scan_diagnostics" ADD CONSTRAINT "file_scan_diagnostics_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_scan_diagnostics_created_idx" ON "file_scan_diagnostics" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "file_scan_diagnostics_file_idx" ON "file_scan_diagnostics" USING btree ("file_id");