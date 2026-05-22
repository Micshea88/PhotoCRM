-- ============================================================================
-- Push 2b — universal saved-views engine evolved for contact list-view CRUD
-- ============================================================================
-- 1) Add new columns to saved_views (visibility, shared_with_user_ids,
--    column_config). All start nullable / with defaults so existing rows
--    parse into the new shape.
-- 2) Backfill — flip `shared bool` into `visibility text` and convert the
--    `visible_columns jsonb` array of strings into the new `column_config`
--    jsonb-of-objects shape (`{id, visible, width, order}`).
-- 3) Drop legacy `shared` and `visible_columns` columns.
-- 4) Replace the org-isolation-only RLS policy with separate SELECT /
--    INSERT / UPDATE / DELETE policies that enforce 3-tier visibility at
--    the database layer using current_setting('app.current_user_id').
-- 5) Create user_object_view_prefs (per-user tab order + last-viewed) with
--    own-row RLS.
-- ============================================================================

-- ─── 1. user_object_view_prefs: TABLE + FKs + INDEX ─────────────────────────
CREATE TABLE "user_object_view_prefs" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"object_type" text NOT NULL,
	"ordered_view_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_viewed_view_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ─── 2. saved_views: ADD new columns (additive — old rows still parseable) ──
ALTER TABLE "saved_views" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "shared_with_user_ids" text[];--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "column_config" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

-- ─── 3. BACKFILL — shared bool → visibility text ────────────────────────────
-- shared = true  → visibility = 'org'        (existing org-wide views)
-- shared = false → visibility = 'private'    (existing user-private views)
UPDATE "saved_views" SET "visibility" = 'org' WHERE "shared" = true;--> statement-breakpoint
UPDATE "saved_views" SET "visibility" = 'private' WHERE "shared" = false;--> statement-breakpoint

-- ─── 4. BACKFILL — visible_columns text[] (jsonb) → column_config jsonb[obj]─
-- Old: ["firstName", "lastName", "primaryEmail", ...]
-- New: [{id, visible:true, width:null, order:i}, ...]
UPDATE "saved_views"
SET "column_config" = COALESCE(
  (
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', elem.value,
               'visible', true,
               'width', NULL::int,
               'order', (elem.ord - 1)::int
             )
             ORDER BY elem.ord
           )
    FROM jsonb_array_elements_text("visible_columns") WITH ORDINALITY AS elem(value, ord)
  ),
  '[]'::jsonb
)
WHERE "visible_columns" IS NOT NULL
  AND jsonb_typeof("visible_columns") = 'array';
--> statement-breakpoint

-- ─── 5. DROP legacy columns ─────────────────────────────────────────────────
ALTER TABLE "saved_views" DROP COLUMN "shared";--> statement-breakpoint
ALTER TABLE "saved_views" DROP COLUMN "visible_columns";--> statement-breakpoint

-- ─── 6. CHECK constraint on visibility values ───────────────────────────────
ALTER TABLE "saved_views"
  ADD CONSTRAINT "saved_views_visibility_check"
  CHECK ("visibility" IN ('private', 'shared_users', 'org'));
--> statement-breakpoint

-- ─── 7. user_object_view_prefs: FKs + composite-PK-shaped unique index ─────
ALTER TABLE "user_object_view_prefs" ADD CONSTRAINT "user_object_view_prefs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_object_view_prefs" ADD CONSTRAINT "user_object_view_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_object_view_prefs" ADD CONSTRAINT "user_object_view_prefs_last_viewed_view_id_saved_views_id_fk" FOREIGN KEY ("last_viewed_view_id") REFERENCES "public"."saved_views"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_object_view_prefs_pk" ON "user_object_view_prefs" USING btree ("organization_id","user_id","object_type");--> statement-breakpoint

-- ─── 8. New saved_views index on (org, visibility) ──────────────────────────
CREATE INDEX "saved_views_org_visibility_idx" ON "saved_views" USING btree ("organization_id","visibility");--> statement-breakpoint

-- ─── 9. RLS OVERHAUL — saved_views ──────────────────────────────────────────
-- Replace the single org-isolation policy with separate SELECT/INSERT/
-- UPDATE/DELETE policies that enforce 3-tier visibility at the database
-- layer. `app.current_user_id` is the GUC; safe-action + runWithOrgContext
-- set it on every authenticated mutation/query path (see migration 0021
-- for the same GUC used by assignment-scoped RLS).
--
-- SELECT visibility:
--   • own views (owner_user_id = current_user)
--   • org-wide (visibility = 'org')
--   • shared-with-me (visibility = 'shared_users' AND current_user IN
--     shared_with_user_ids)
--   • system defaults (is_default = true AND owner_user_id IS NULL)
--     — these stay universally visible (the "All Contacts" tab)
--
-- INSERT/UPDATE/DELETE:
--   • mutations gated to own views (owner_user_id = current_user)
--   • carve-out: INSERT allows null-owner system defaults from the seed
--     path (owner_user_id IS NULL AND is_default = true). UPDATE/DELETE
--     have no such carve-out — system defaults are immutable.

DROP POLICY IF EXISTS "saved_views_org_isolation" ON "saved_views";--> statement-breakpoint

CREATE POLICY "saved_views_select" ON "saved_views"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      "owner_user_id" = current_setting('app.current_user_id', true)
      OR "visibility" = 'org'
      OR (
        "visibility" = 'shared_users'
        AND "shared_with_user_ids" IS NOT NULL
        AND current_setting('app.current_user_id', true) = ANY("shared_with_user_ids")
      )
      OR ("is_default" = true AND "owner_user_id" IS NULL)
    )
  );
--> statement-breakpoint

CREATE POLICY "saved_views_insert" ON "saved_views"
  FOR INSERT
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND (
      "owner_user_id" = current_setting('app.current_user_id', true)
      OR ("owner_user_id" IS NULL AND "is_default" = true)
    )
  );
--> statement-breakpoint

CREATE POLICY "saved_views_update" ON "saved_views"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND "owner_user_id" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND "owner_user_id" = current_setting('app.current_user_id', true)
  );
--> statement-breakpoint

CREATE POLICY "saved_views_delete" ON "saved_views"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND "owner_user_id" = current_setting('app.current_user_id', true)
  );
--> statement-breakpoint

-- ─── 10. RLS — user_object_view_prefs (own row only) ────────────────────────
ALTER TABLE "user_object_view_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_object_view_prefs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "user_object_view_prefs_select" ON "user_object_view_prefs"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND "user_id" = current_setting('app.current_user_id', true)
  );
--> statement-breakpoint

CREATE POLICY "user_object_view_prefs_insert" ON "user_object_view_prefs"
  FOR INSERT
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND "user_id" = current_setting('app.current_user_id', true)
  );
--> statement-breakpoint

CREATE POLICY "user_object_view_prefs_update" ON "user_object_view_prefs"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND "user_id" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND "user_id" = current_setting('app.current_user_id', true)
  );
--> statement-breakpoint

CREATE POLICY "user_object_view_prefs_delete" ON "user_object_view_prefs"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND "user_id" = current_setting('app.current_user_id', true)
  );
