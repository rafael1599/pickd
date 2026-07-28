-- DS-Pallet blocks: curated no-mover list + per-block settings.
--
-- Backs docs/prds/warehouse-ds-pallet-blocks.md. Two new tables:
--
--   warehouse_no_movers      the curated list that decides WHO lives in the
--                            managed blocks. Replaces the ranking-weight
--                            heuristic as the entry criterion (RF-001..006).
--   warehouse_block_settings the criteria the manager can change from the UI:
--                            recency window, minimum units per pallet, and how
--                            many positions each row actually has (RF-002b/d,
--                            RF-010, RF-011b).
--
-- Additive only: nothing is dropped or renamed, so staging and production can
-- share the database while the frontend rolls out.

-- ── Curated no-mover list ────────────────────────────────────────────────────
-- One row per SKU. The primary key enforces RF-004 by construction: a SKU
-- cannot belong to two blocks at once.
CREATE TABLE IF NOT EXISTS public.warehouse_no_movers (
  sku text PRIMARY KEY,
  warehouse text NOT NULL DEFAULT 'LUDLOW',
  block_id text NOT NULL CHECK (block_id IN ('A', 'B')),
  -- Snapshot of why it was classified this way, for auditing a decision months later.
  last_shipped_at timestamptz,
  qty_at_decision integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE INDEX IF NOT EXISTS idx_warehouse_no_movers_block
  ON public.warehouse_no_movers (block_id);

-- ── Per-block settings ───────────────────────────────────────────────────────
-- positions_per_row exists because the floor is being re-labelled by hand from
-- ~6 double slots to ~12 individual ones. The planner reads this instead of
-- assuming a letter range, so the map follows the floor without a deploy.
CREATE TABLE IF NOT EXISTS public.warehouse_block_settings (
  block_id text PRIMARY KEY CHECK (block_id IN ('A', 'B')),
  warehouse text NOT NULL DEFAULT 'LUDLOW',
  recency_days integer NOT NULL DEFAULT 30 CHECK (recency_days > 0),
  min_units integer NOT NULL DEFAULT 20 CHECK (min_units > 0 AND min_units <= 25),
  positions_per_row integer NOT NULL DEFAULT 10 CHECK (positions_per_row BETWEEN 1 AND 26),
  reserve_last_position boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

INSERT INTO public.warehouse_block_settings (block_id) VALUES ('A'), ('B')
  ON CONFLICT (block_id) DO NOTHING;

-- ── plan_version on the existing plan table ──────────────────────────────────
-- Plans written by the tower/line model are structurally incompatible. They are
-- discarded rather than migrated: the first recalculation reassigns nearly
-- everything anyway (only a handful of no-movers keep their cell).
ALTER TABLE public.warehouse_overstock_plans
  ADD COLUMN IF NOT EXISTS plan_version integer NOT NULL DEFAULT 1;

-- Pull First lives here; the planner already computes it but the previous
-- implementation dropped it on save.
ALTER TABLE public.warehouse_overstock_plans
  ADD COLUMN IF NOT EXISTS pull_first jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.warehouse_overstock_plans
  ADD COLUMN IF NOT EXISTS block_id text;

-- ── updated_at triggers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_warehouse_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_warehouse_no_movers_touch ON public.warehouse_no_movers;
CREATE TRIGGER trg_zz_warehouse_no_movers_touch
  BEFORE UPDATE ON public.warehouse_no_movers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_warehouse_touch_updated_at();

DROP TRIGGER IF EXISTS trg_zz_warehouse_block_settings_touch ON public.warehouse_block_settings;
CREATE TRIGGER trg_zz_warehouse_block_settings_touch
  BEFORE UPDATE ON public.warehouse_block_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_warehouse_touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Same posture as warehouse_overstock_plans: the map has a public route, and
-- these tables hold no sensitive data.
ALTER TABLE public.warehouse_no_movers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_block_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all users to read warehouse no movers" ON public.warehouse_no_movers;
CREATE POLICY "Allow all users to read warehouse no movers"
  ON public.warehouse_no_movers
  FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Allow all users to write warehouse no movers" ON public.warehouse_no_movers;
CREATE POLICY "Allow all users to write warehouse no movers"
  ON public.warehouse_no_movers
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all users to read warehouse block settings" ON public.warehouse_block_settings;
CREATE POLICY "Allow all users to read warehouse block settings"
  ON public.warehouse_block_settings
  FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Allow all users to write warehouse block settings" ON public.warehouse_block_settings;
CREATE POLICY "Allow all users to write warehouse block settings"
  ON public.warehouse_block_settings
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_no_movers TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_block_settings TO authenticated, anon;

-- ── Mover / no-mover suggestion helper ───────────────────────────────────────
-- Powers RF-002: classify by shipment recency, not order count. Validated
-- against a manual classification — order count does not separate the two
-- classes, last shipped date does.
--
-- Returns every SKU with active stock in the given rows, with the movement
-- data the classification screen needs. Alias-aware via get_sku_movement_stats,
-- so a renamed SKU doesn't read as "never shipped".
CREATE OR REPLACE FUNCTION public.get_block_classification_candidates(
  p_rows text[],
  p_recency_days integer DEFAULT 30
)
RETURNS TABLE(
  sku text,
  total_qty numeric,
  location text,
  sublocation text[],
  orders_completed bigint,
  last_shipped timestamptz,
  is_mover boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH stock AS (
    SELECT i.sku, sum(i.quantity) AS total_qty
    FROM public.inventory i
    WHERE i.is_active
      AND i.quantity > 0
      AND i.location = ANY(p_rows)
    GROUP BY i.sku
  ),
  -- The cell holding most of the SKU's units — that's the one worth anchoring
  -- to, and the one the manager needs to see in the list.
  main_cell AS (
    SELECT DISTINCT ON (i.sku) i.sku, i.location, i.sublocation
    FROM public.inventory i
    WHERE i.is_active
      AND i.quantity > 0
      AND i.location = ANY(p_rows)
    ORDER BY i.sku, i.quantity DESC
  )
  SELECT s.sku,
         s.total_qty,
         c.location,
         c.sublocation,
         m.orders_completed,
         m.last_shipped,
         (m.last_shipped IS NOT NULL
           AND m.last_shipped >= now() - make_interval(days => p_recency_days)) AS is_mover
  FROM stock s
  JOIN main_cell c ON c.sku = s.sku
  CROSS JOIN LATERAL public.get_sku_movement_stats(s.sku, now() - interval '12 months') m
  ORDER BY m.last_shipped DESC NULLS LAST, s.total_qty DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_block_classification_candidates(text[], integer) TO authenticated, anon;
