-- Push 3 (C4) — pre-write dedup hard block.
--
-- Adds two partial unique indexes on contacts to enforce uniqueness of
-- normalized primary_email and primary_phone within each organization,
-- ignoring soft-deleted rows. This is the DB-layer safety net behind
-- the app-layer pre-flight check in src/modules/contacts/dedup-preflight.ts.
--
-- Per memory #22 + roadmap §"Pre-write dedup (Push 3 C4)":
--   - Hard block (no override). The action-layer check throws a
--     structured DedupConflict result; the form opens DedupBlockModal.
--   - Soft-deleted rows allowed to keep their values (recycle pattern).
--   - Secondary email/phone have NO DB constraint — same secondary can
--     legitimately appear across people. The action-layer check
--     queries against primary AND secondary for completeness.
--   - Companies main_phone has NO uniqueness constraint (carve-out
--     locked in roadmap — two companies can share a switchboard).
--
-- Pre-flight cleanup (Mike-confirmed default K + L):
-- Before adding the unique constraints, find and soft-delete any
-- existing dupes (keep oldest by created_at). Idempotent: a second run
-- finds zero dupes since the indexes are already in place.

-- ─── Cleanup: contacts duplicate primary_email (per org) ────────────
WITH dupes AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, LOWER(primary_email)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM contacts
  WHERE deleted_at IS NULL
    AND primary_email IS NOT NULL
    AND TRIM(primary_email) <> ''
)
UPDATE contacts
SET
  deleted_at = NOW(),
  deleted_by = NULL,
  updated_at = NOW()
WHERE id IN (SELECT id FROM dupes WHERE rn > 1);
--> statement-breakpoint

-- ─── Cleanup: contacts duplicate primary_phone (per org) ────────────
WITH dupes AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, REGEXP_REPLACE(primary_phone, '\D', '', 'g')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM contacts
  WHERE deleted_at IS NULL
    AND primary_phone IS NOT NULL
    AND TRIM(primary_phone) <> ''
    AND REGEXP_REPLACE(primary_phone, '\D', '', 'g') <> ''
)
UPDATE contacts
SET
  deleted_at = NOW(),
  deleted_by = NULL,
  updated_at = NOW()
WHERE id IN (SELECT id FROM dupes WHERE rn > 1);
--> statement-breakpoint

-- ─── Partial unique indexes ─────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_org_lower_email_uidx"
  ON "contacts" ("organization_id", LOWER("primary_email"))
  WHERE "deleted_at" IS NULL AND "primary_email" IS NOT NULL AND TRIM("primary_email") <> '';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_org_normalized_phone_uidx"
  ON "contacts" ("organization_id", REGEXP_REPLACE("primary_phone", '\D', '', 'g'))
  WHERE "deleted_at" IS NULL
    AND "primary_phone" IS NOT NULL
    AND REGEXP_REPLACE("primary_phone", '\D', '', 'g') <> '';
