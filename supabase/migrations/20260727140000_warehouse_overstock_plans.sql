-- Shared, persistent overstock plan layout for /warehouse-map.
-- Prevents expensive client-side recalculation on every page load across devices.

CREATE TABLE IF NOT EXISTS public.warehouse_overstock_plans (
  id text PRIMARY KEY,
  warehouse text NOT NULL DEFAULT 'LUDLOW',
  plan_data jsonb NOT NULL,
  ranking_weights jsonb NOT NULL,
  effectively_excluded_skus text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION public.trg_warehouse_overstock_plans_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_warehouse_overstock_plans_touch ON public.warehouse_overstock_plans;
CREATE TRIGGER trg_zz_warehouse_overstock_plans_touch
  BEFORE UPDATE ON public.warehouse_overstock_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_warehouse_overstock_plans_touch_updated_at();

ALTER TABLE public.warehouse_overstock_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all users to read warehouse overstock plans" ON public.warehouse_overstock_plans;
CREATE POLICY "Allow all users to read warehouse overstock plans"
  ON public.warehouse_overstock_plans
  FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Allow all users to insert/update warehouse overstock plans" ON public.warehouse_overstock_plans;
CREATE POLICY "Allow all users to insert/update warehouse overstock plans"
  ON public.warehouse_overstock_plans
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_overstock_plans TO authenticated, anon;
