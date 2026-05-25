ALTER TABLE "user" DROP CONSTRAINT "user_last_active_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "last_active_organization_id";