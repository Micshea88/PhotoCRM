-- ============================================================================
-- 0025 — Backfill the "All Contacts" default saved_views row.
-- ============================================================================
-- Two paths, idempotent, defensive against all three branches:
--
--   (1) INSERT missing rows  — for organizations created before commit
--       ec1ad85 (2026-05-21) which added the "All Contacts" entry to
--       seedDefaultSavedViewsForOrg. Those orgs went through the BA
--       afterCreateOrganization hook when the seed only contained "Team
--       This Week" (task) → no contact default exists.
--
--   (2) UPDATE rows with empty column_config — for orgs where the row
--       does exist but column_config is NULL or '[]'::jsonb. Migration
--       0024's backfill only converted rows whose `visible_columns`
--       jsonb was a populated array; rows with NULL/missing
--       `visible_columns` got the schema default (`'[]'::jsonb`) and
--       stayed that way.
--
-- Rows that ALREADY have a non-empty column_config are LEFT ALONE —
-- user-customized defaults must not be reset.
--
-- Idempotency: WHERE NOT EXISTS (insert) + column_config IS NULL/empty
-- guard (update) means re-running this migration has the same end state
-- as running it once.
--
-- RLS workaround: the saved_views UPDATE policy is owner-only and the
-- system-default row has NULL owner_user_id — no user can satisfy the
-- policy. We temporarily flip the table to `NO FORCE ROW LEVEL
-- SECURITY` so the table-owner role (which the migration runner uses)
-- bypasses RLS for the two statements, then restore `FORCE` inside the
-- same transaction. Drizzle wraps each migration in a transaction, so
-- if the migration fails the FORCE state rolls back atomically.
-- ============================================================================

ALTER TABLE "saved_views" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- (1) INSERT missing rows.
INSERT INTO "saved_views" (
  "id", "organization_id", "object_type", "name", "owner_user_id",
  "visibility", "filters", "sort", "column_config", "grouping", "is_default"
)
SELECT
  'sv_' || md5(o.id || 'all_contacts'),
  o.id,
  'contact',
  'All Contacts',
  NULL,
  'org',
  '[]'::jsonb,
  '{"field":"lastName","direction":"asc"}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('id', 'displayLabel',    'visible', true, 'order', 0, 'width', NULL),
    jsonb_build_object('id', 'primaryEmail',    'visible', true, 'order', 1, 'width', NULL),
    jsonb_build_object('id', 'primaryPhone',    'visible', true, 'order', 2, 'width', NULL),
    jsonb_build_object('id', 'contactType',     'visible', true, 'order', 3, 'width', NULL),
    jsonb_build_object('id', 'lifecycleStatus', 'visible', true, 'order', 4, 'width', NULL),
    jsonb_build_object('id', 'tags',            'visible', true, 'order', 5, 'width', NULL)
  ),
  NULL,
  true
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "saved_views" sv
  WHERE sv.organization_id = o.id
    AND sv.object_type     = 'contact'
    AND sv.name            = 'All Contacts'
    AND sv.is_default      = true
    AND sv.owner_user_id   IS NULL
    AND sv.deleted_at      IS NULL
);--> statement-breakpoint

-- (2) UPDATE existing rows with empty/null column_config.
UPDATE "saved_views"
SET "column_config" = jsonb_build_array(
  jsonb_build_object('id', 'displayLabel',    'visible', true, 'order', 0, 'width', NULL),
  jsonb_build_object('id', 'primaryEmail',    'visible', true, 'order', 1, 'width', NULL),
  jsonb_build_object('id', 'primaryPhone',    'visible', true, 'order', 2, 'width', NULL),
  jsonb_build_object('id', 'contactType',     'visible', true, 'order', 3, 'width', NULL),
  jsonb_build_object('id', 'lifecycleStatus', 'visible', true, 'order', 4, 'width', NULL),
  jsonb_build_object('id', 'tags',            'visible', true, 'order', 5, 'width', NULL)
)
WHERE "object_type"    = 'contact'
  AND "name"           = 'All Contacts'
  AND "is_default"     = true
  AND "owner_user_id"  IS NULL
  AND "deleted_at"     IS NULL
  AND ("column_config" IS NULL OR "column_config" = '[]'::jsonb);
--> statement-breakpoint

ALTER TABLE "saved_views" FORCE ROW LEVEL SECURITY;
