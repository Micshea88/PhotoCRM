-- Custom SQL migration file, put your code below! --
-- ─────────────────────────────────────────────────────────────────────
-- 0063_payment_installments_role_gate_fail_closed.sql (T2.4)
--
-- Close the fail-OPEN hole in the payment_installments financial-role gate.
-- BEFORE (0016): `IN ('owner','admin','accountant','')` — a role-UNSET
-- context (NULL -> COALESCE -> '') matched the trailing '' and PASSED the gate.
-- AFTER: drop the trailing '' -> an unset role evaluates FALSE -> DENIED
-- (fail-closed). All other clauses unchanged. Production paths (orgAction,
-- withOrgContext, system 'admin') always set a real role; this removes the
-- silent reliance on the '' escape hatch.
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
