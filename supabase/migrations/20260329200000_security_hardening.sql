-- ============================================================
-- SECURITY HARDENING — 2026-03-29
-- Fixes: SEC-016 (RLS on 3 tables), SEC-020 (anon RPC access),
--        SEC-032 (optimization_reports open policy)
--
-- Context: All affected tables are only accessed by authenticated
-- users (post-login). No anon access paths exist in the app.
-- Edge functions use service_role (bypasses RLS automatically).
-- watchdog-pickd uses service_role (bypasses RLS automatically).
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. ENABLE RLS on unprotected tables
-- ────────────────────────────────────────────────────────────

-- customers: 186 records with email/phone exposed to anon
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select_authenticated"
  ON public.customers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "customers_insert_authenticated"
  ON public.customers FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "customers_update_authenticated"
  ON public.customers FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "customers_delete_admin"
  ON public.customers FOR DELETE
  TO authenticated
  USING (is_admin());

-- order_groups: only used by picking session (authenticated)
ALTER TABLE public.order_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_groups_select_authenticated"
  ON public.order_groups FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "order_groups_insert_authenticated"
  ON public.order_groups FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "order_groups_update_authenticated"
  ON public.order_groups FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "order_groups_delete_authenticated"
  ON public.order_groups FOR DELETE
  TO authenticated
  USING (true);

-- pdf_import_log: not used by app, only by watchdog (service_role)
ALTER TABLE public.pdf_import_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pdf_import_log_select_authenticated"
  ON public.pdf_import_log FOR SELECT
  TO authenticated
  USING (true);

-- Writes only via service_role (watchdog) — no authenticated write policy needed


-- ────────────────────────────────────────────────────────────
-- 2. REVOKE EXECUTE from anon on ALL public functions,
--    then re-grant only the ones anon actually needs.
--    Also prevent future functions from auto-granting to anon.
-- ────────────────────────────────────────────────────────────

-- 2a. Revoke EXECUTE from PUBLIC (PostgreSQL default) and anon on ALL functions.
--     supabase_admin auto-grants to anon, and PG grants to PUBLIC by default.
--     We must revoke from both to fully block anon access.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- 2b. Re-grant to authenticated and service_role (needed for app + edge functions)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- 2c. Re-grant only what anon needs (used in RLS policy evaluation)
GRANT EXECUTE ON FUNCTION public.current_user_id() TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_manager() TO anon;

-- NOTE: supabase_admin default privileges cannot be altered (permission denied).
-- Future migrations that CREATE FUNCTION will auto-grant to anon.
-- Each new function migration must include:
--   REVOKE EXECUTE ON FUNCTION public.<new_function> FROM PUBLIC, anon;


-- ────────────────────────────────────────────────────────────
-- 3. FIX open policy on optimization_reports
--    "Public full access reports" allows anon to read/write/delete
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Public full access reports" ON public.optimization_reports;

CREATE POLICY "optimization_reports_all_authenticated"
  ON public.optimization_reports FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
