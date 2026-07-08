-- ─────────────────────────────────────────────────────────────────────
-- 0063_payment_installments_role_gate_fail_closed.sql
--
-- Close the fail-OPEN hole in the payment_installments financial-role gate.
--
-- BEFORE (migration 0016): the role IN-list included a trailing empty
-- string — `IN ('owner','admin','accountant','')` — so a context with
-- app.current_role UNSET (NULL → COALESCE → '') would evaluate
-- `'' IN (…,'')` = TRUE and PASS the financial gate. A role-unset
-- request context could therefore read or write financial rows, defeating
-- the access-control intent.
--
-- AFTER: drop the trailing '' → `IN ('owner','admin','accountant')`.
-- An unset role evaluates `'' IN ('owner','admin','accountant')` = FALSE
-- → the gate DENIES (fail-closed). Production code paths (orgAction,
-- withOrgContext) always set a real role value; the '' case should never
-- occur in prod, but this migration removes any silent reliance on it.
--
-- Policies replaced: payment_installments_{select,insert,update,delete}.
-- All other clauses (organization_id = current_setting('app.current_org', true),
-- USING/WITH CHECK structure) are preserved byte-for-byte from 0016.
--
-- Policy-only migration (no schema change). Snapshot-neutral — these
-- policies are SQL-only and are not tracked by the drizzle snapshot.
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "payment_installments_select" ON "payment_installments";--> statement-breakpoint
DROP POLICY IF EXISTS "payment_installments_insert" ON "payment_installments";--> statement-breakpoint
DROP POLICY IF EXISTS "payment_installments_update" ON "payment_installments";--> statement-breakpoint
DROP POLICY IF EXISTS "payment_installments_delete" ON "payment_installments";--> statement-breakpoint

CREATE POLICY "payment_installments_select" ON "payment_installments"
  FOR SELECT
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant')
  );--> statement-breakpoint

CREATE POLICY "payment_installments_insert" ON "payment_installments"
  FOR INSERT
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant')
  );--> statement-breakpoint

CREATE POLICY "payment_installments_update" ON "payment_installments"
  FOR UPDATE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant')
  )
  WITH CHECK (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant')
  );--> statement-breakpoint

CREATE POLICY "payment_installments_delete" ON "payment_installments"
  FOR DELETE
  USING (
    "organization_id" = current_setting('app.current_org', true)
    AND COALESCE(current_setting('app.current_role', true), '') IN ('owner','admin','accountant')
  );
