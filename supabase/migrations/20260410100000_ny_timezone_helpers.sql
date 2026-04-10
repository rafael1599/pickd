-- ============================================================================
-- NY Timezone — single source of truth
--
-- This migration introduces two helper functions that all date logic in the
-- system MUST use when reasoning about "what day is it" or "what are the
-- bounds of day X". They live in Postgres so they are reachable from SQL,
-- RPCs, RLS, generated columns, and the client (via RPC), and so DST is
-- handled natively.
--
-- Why this matters:
--   - Activity reports, daily snapshots, and the upcoming daily report
--     persistence layer all need to know "what does Apr 10 mean as a NY day".
--   - Today, that logic is duplicated in JS (cliente + edge function) and
--     UTC-based in Postgres (CURRENT_DATE). The duplication has caused at
--     least one latent bug: in EST the daily-snapshot cron captures inventory
--     state 1 hour before NY midnight, and the snapshot date drifts by one
--     across DST transitions.
--
-- Rule for the team:
--   - Anywhere in the codebase that needs "today's NY date", call
--     current_ny_date() (in SQL) or getCurrentNYDate() (in TS).
--   - Anywhere that needs "the UTC bounds of NY day X", call
--     ny_day_bounds(x) / getNYDayBounds(x). Never construct
--     `${date}T00:00:00.000Z` by hand again.
-- ============================================================================

-- ─── 1. current_ny_date() ────────────────────────────────────────────────────
-- Returns the current calendar date in America/New_York. Marked STABLE
-- because it depends on now() but is consistent within a transaction.

CREATE OR REPLACE FUNCTION public.current_ny_date()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'America/New_York')::date
$$;

COMMENT ON FUNCTION public.current_ny_date() IS
  'Returns the current calendar date in America/New_York. Single source of truth for "what day is it" across the system. Use this instead of CURRENT_DATE (which is UTC).';

GRANT EXECUTE ON FUNCTION public.current_ny_date() TO anon, authenticated;

-- ─── 2. ny_day_bounds(date) ──────────────────────────────────────────────────
-- For a NY calendar date X, returns the UTC timestamp bounds of that day:
--   starts_at = X 00:00:00.000000 NY → corresponding UTC instant
--   ends_at   = X 23:59:59.999999 NY → corresponding UTC instant
--
-- Marked IMMUTABLE so it can be used in indexes, generated columns, and
-- CHECK constraints. Postgres handles DST automatically via the timezone
-- conversion.
--
-- Usage example:
--   SELECT * FROM task_state_changes
--   WHERE changed_at BETWEEN (SELECT starts_at FROM ny_day_bounds('2026-04-10'))
--                        AND (SELECT ends_at   FROM ny_day_bounds('2026-04-10'));

CREATE OR REPLACE FUNCTION public.ny_day_bounds(p_ny_date date)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (p_ny_date::timestamp AT TIME ZONE 'America/New_York') AS starts_at,
    (((p_ny_date + 1)::timestamp AT TIME ZONE 'America/New_York') - interval '1 microsecond') AS ends_at
$$;

COMMENT ON FUNCTION public.ny_day_bounds(date) IS
  'For a NY calendar date, returns (starts_at, ends_at) as UTC timestamps. Handles DST automatically. Use this instead of building "${date}T00:00:00.000Z" strings in client code.';

GRANT EXECUTE ON FUNCTION public.ny_day_bounds(date) TO anon, authenticated;

-- ─── 3. Fix create_daily_snapshot default ────────────────────────────────────
-- The existing RPC defaulted to CURRENT_DATE (UTC), which would cause the
-- snapshot to be tagged with the wrong date if invoked manually without
-- passing a parameter. Today the cron always passes an explicit date computed
-- in JS, so this default is latent — but as we centralize tz logic in DB, the
-- default should be NY-correct too.
--
-- The new default is `current_ny_date() - 1`, which represents "the NY day
-- that just closed". The cron should run AFTER NY midnight so that
-- current_ny_date() already returns the new day, and the - 1 gives us the
-- day we want to snapshot.
--
-- Existing callers that pass an explicit p_snapshot_date are unaffected.

CREATE OR REPLACE FUNCTION public.create_daily_snapshot(
  p_snapshot_date date DEFAULT (public.current_ny_date() - 1)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM daily_inventory_snapshots
  WHERE snapshot_date = p_snapshot_date;

  INSERT INTO daily_inventory_snapshots
    (snapshot_date, warehouse, location, sku, quantity, location_id, sku_note)
  SELECT
    p_snapshot_date,
    warehouse,
    location,
    sku,
    quantity,
    location_id,
    item_name
  FROM inventory
  WHERE is_active = TRUE AND quantity > 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',       true,
    'snapshot_date', p_snapshot_date,
    'items_saved',   v_count,
    'created_at',    NOW()
  );
END;
$function$;

COMMENT ON FUNCTION public.create_daily_snapshot(date) IS
  'Creates a snapshot of current inventory for the specified date. Idempotent (overwrites existing snapshot). Default p_snapshot_date is current_ny_date() - 1, i.e. the NY day that just closed — intended to be called by the nightly cron after NY midnight.';
