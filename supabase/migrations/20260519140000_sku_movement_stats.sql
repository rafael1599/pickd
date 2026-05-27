-- Rename-aware analytics for SKU movement.
--
-- Companion to 20260519120000_sku_alias_chain.sql, which fixed the History
-- sheet. This migration extends the same alias-chain logic to aggregate
-- queries used in consolidation / slotting analytics.
--
-- Problem: when computing "orders shipped per SKU" or "units shipped per SKU",
-- a naive query that filters picking_lists.items by literal sku misses every
-- order placed under a previous name. SKU 03-3768BLD (renamed from 03-3768BL
-- on 2026-05-12) appeared as "never shipped" in our consolidation list, when
-- in reality it had 10 completed orders / 13 units under the old name.
--
-- Helpers added:
--   get_sku_movement_stats(p_sku, p_since)
--     → single SKU. Returns alias chain, orders count, units shipped, first
--       and last shipped dates. Optional p_since filters by updated_at.
--   get_sku_movement_stats_batch(p_skus[], p_since)
--     → array version. Useful for analyzing a consolidation candidate list
--       in one round-trip.

CREATE OR REPLACE FUNCTION public.get_sku_movement_stats(
  p_sku text,
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE(
  sku text,
  alias_chain text[],
  orders_completed bigint,
  units_shipped numeric,
  first_shipped timestamptz,
  last_shipped timestamptz
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_chain text[];
BEGIN
  v_chain := public.resolve_sku_chain(p_sku);

  RETURN QUERY
  WITH matches AS (
    SELECT pl.id,
           pl.updated_at,
           (it->>'pickingQty')::numeric AS qty
    FROM public.picking_lists pl,
         jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it
    WHERE pl.status = 'completed'
      AND (it->>'sku') = ANY(v_chain)
      AND (p_since IS NULL OR pl.updated_at >= p_since)
  )
  SELECT
    p_sku AS sku,
    v_chain AS alias_chain,
    count(DISTINCT id)::bigint AS orders_completed,
    COALESCE(sum(qty), 0) AS units_shipped,
    min(updated_at) AS first_shipped,
    max(updated_at) AS last_shipped
  FROM matches;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_sku_movement_stats(text, timestamptz)
  TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_sku_movement_stats_batch(
  p_skus text[],
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE(
  sku text,
  alias_chain text[],
  orders_completed bigint,
  units_shipped numeric,
  first_shipped timestamptz,
  last_shipped timestamptz
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.*
  FROM unnest(p_skus) AS input(sku)
  CROSS JOIN LATERAL public.get_sku_movement_stats(input.sku, p_since) AS s;
$function$;

GRANT EXECUTE ON FUNCTION public.get_sku_movement_stats_batch(text[], timestamptz)
  TO anon, authenticated, service_role;
