-- ============================================================================
-- 0026 — Push 2c: rename ordered_view_ids → pinned_view_ids, add
-- default_view_id + contact_page_size to user_object_view_prefs.
-- ============================================================================
-- Semantic shift: pinned_view_ids represents the user's EXPLICIT pinned
-- tab list (max 6 per object_type, enforced at the action layer).
-- ordered_view_ids did the same job for tab ordering but ALWAYS
-- excluded the system "All Contacts" default — that row was rendered
-- separately by the tab strip. Push 2c unifies the model: All Contacts
-- is just another pinnable tab.
--
-- Backfill plan:
--   1. Copy ordered_view_ids → pinned_view_ids (1-to-1 rename semantic).
--   2. For object_type='contact' prefs, prepend the org's All Contacts
--      row id so existing users keep the same tab strip they had
--      before — All Contacts as the leftmost tab + their custom views
--      after. Skipped if the All Contacts row is already in the list
--      (defensive idempotency).
--   3. Drop ordered_view_ids.
-- ============================================================================

ALTER TABLE "user_object_view_prefs" ADD COLUMN "pinned_view_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user_object_view_prefs" ADD COLUMN "default_view_id" text;--> statement-breakpoint
ALTER TABLE "user_object_view_prefs" ADD COLUMN "contact_page_size" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_object_view_prefs" ADD CONSTRAINT "user_object_view_prefs_default_view_id_saved_views_id_fk" FOREIGN KEY ("default_view_id") REFERENCES "public"."saved_views"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- (1) Rename semantic — copy data 1-to-1.
UPDATE "user_object_view_prefs" SET "pinned_view_ids" = "ordered_view_ids";--> statement-breakpoint

-- (2) Prepend All Contacts to contact prefs so existing users don't
--     lose the leftmost-tab affordance on rollout. NOT EXISTS guard
--     makes this safe to re-run.
UPDATE "user_object_view_prefs" uop
SET "pinned_view_ids" = ARRAY[ac.id] || uop."pinned_view_ids"
FROM "saved_views" ac
WHERE ac."organization_id" = uop."organization_id"
  AND ac."object_type"     = 'contact'
  AND ac."is_default"      = true
  AND ac."owner_user_id"   IS NULL
  AND ac."deleted_at"      IS NULL
  AND uop."object_type"    = 'contact'
  AND NOT (ac."id" = ANY(uop."pinned_view_ids"));
--> statement-breakpoint

-- (3) Drop the legacy column.
ALTER TABLE "user_object_view_prefs" DROP COLUMN "ordered_view_ids";
