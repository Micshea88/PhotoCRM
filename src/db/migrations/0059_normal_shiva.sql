ALTER TABLE "email_connections" ADD COLUMN "grant_id_hash" text;--> statement-breakpoint
CREATE INDEX "email_connections_grant_id_hash_idx" ON "email_connections" USING btree ("grant_id_hash");