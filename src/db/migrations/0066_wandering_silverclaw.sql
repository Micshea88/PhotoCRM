DROP INDEX "background_jobs_idempotency_uidx";--> statement-breakpoint
ALTER TABLE "background_jobs" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_idempotency_uidx" ON "background_jobs" USING btree ("type","idempotency_key") WHERE idempotency_key IS NOT NULL;