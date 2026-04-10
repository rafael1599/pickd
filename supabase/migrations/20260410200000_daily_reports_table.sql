-- Migration: daily_reports table (Activity Report Phase 2 — idea-052)
--
-- Persists daily activity report snapshots with split computed/manual columns.
--   - data_computed is written ONLY by the nightly cron via SECURITY DEFINER RPC
--   - data_manual is written ONLY by admins via the save RPC (via SECURITY INVOKER + RLS)
-- The two columns are merged at read time on the client.
--
-- Plan: ~/.claude/plans/activity-report-fase-2-snapshots.md
-- Depends on: 20260410100000_ny_timezone_helpers.sql (current_ny_date, ny_day_bounds)
-- Depends on: is_admin() in 20260307221638_remote_schema.sql:504

BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_reports (
  report_date    date PRIMARY KEY,
  data_computed  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  data_manual    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        REFERENCES public.profiles(id),
  updated_by     uuid        REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.daily_reports IS
  'Daily activity report snapshots. data_computed is written only by the nightly cron via SECURITY DEFINER RPC; data_manual is written only by admins via the save_daily_report_manual RPC. Merged at read time on the client.';

COMMENT ON COLUMN public.daily_reports.data_computed IS
  'Auto-computed: warehouse_totals, accuracy, correction_count, users, schema_version. Owned by cron — never write from client.';

COMMENT ON COLUMN public.daily_reports.data_manual IS
  'Manually edited: win_of_the_day, pickd_updates, routine_checklist, user_notes, schema_version. Owned by admins — never write from cron.';

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

-- ----- RLS policies (sin excepciones de role en triggers; todo el control de acceso vive aquí) -----

DROP POLICY IF EXISTS "daily_reports_select_authenticated" ON public.daily_reports;
CREATE POLICY "daily_reports_select_authenticated"
  ON public.daily_reports FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "daily_reports_insert_admin_today" ON public.daily_reports;
CREATE POLICY "daily_reports_insert_admin_today"
  ON public.daily_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    AND report_date = public.current_ny_date()
  );

DROP POLICY IF EXISTS "daily_reports_update_admin_today" ON public.daily_reports;
CREATE POLICY "daily_reports_update_admin_today"
  ON public.daily_reports FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    AND report_date = public.current_ny_date()
  )
  WITH CHECK (
    public.is_admin()
    AND report_date = public.current_ny_date()
  );

-- No DELETE policy. Daily reports are immutable history; never deleted from the client.

-- ----- Trigger: invariante universal "no future writes" (sin lógica de role) -----
--
-- The trigger enforces a single business invariant: never write to a future date.
-- It does NOT know about roles. RLS handles "users can only edit today" — this trigger
-- only catches the impossible case. The cron uses SECURITY DEFINER (bypasses RLS) and
-- writes "yesterday", which satisfies the invariant.

CREATE OR REPLACE FUNCTION public.daily_reports_no_future_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.report_date > public.current_ny_date() THEN
    RAISE EXCEPTION 'daily_reports cannot be written for future date % (current NY date is %)',
      NEW.report_date, public.current_ny_date()
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_reports_no_future ON public.daily_reports;
CREATE TRIGGER trg_daily_reports_no_future
  BEFORE INSERT OR UPDATE ON public.daily_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.daily_reports_no_future_writes();

-- ----- Trigger: keep updated_at fresh on UPDATE -----

CREATE OR REPLACE FUNCTION public.daily_reports_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_reports_touch_updated_at ON public.daily_reports;
CREATE TRIGGER trg_daily_reports_touch_updated_at
  BEFORE UPDATE ON public.daily_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.daily_reports_touch_updated_at();

COMMIT;
