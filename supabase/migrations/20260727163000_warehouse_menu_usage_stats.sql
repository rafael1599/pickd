-- Create table for tracking team-wide global menu item usage
CREATE TABLE IF NOT EXISTS public.warehouse_menu_usage_stats (
  menu_item_id text PRIMARY KEY,
  use_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.warehouse_menu_usage_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to warehouse_menu_usage_stats"
  ON public.warehouse_menu_usage_stats FOR SELECT
  USING (true);

CREATE POLICY "Allow insert/update to warehouse_menu_usage_stats"
  ON public.warehouse_menu_usage_stats FOR ALL
  USING (true)
  WITH CHECK (true);

-- Atomic RPC function to increment menu usage count
CREATE OR REPLACE FUNCTION public.increment_menu_usage(item_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.warehouse_menu_usage_stats (menu_item_id, use_count, updated_at)
  VALUES (item_id, 1, now())
  ON CONFLICT (menu_item_id)
  DO UPDATE SET
    use_count = public.warehouse_menu_usage_stats.use_count + 1,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_menu_usage(text) TO anon, authenticated, service_role;
