-- SKU rename history awareness
--
-- inventory.service.ts records SKU renames by writing inventory_logs rows with
-- action_type='EDIT' and previous_sku=<old name>. Until now, no query joined
-- this back: looking up a renamed SKU's history showed only events since the
-- rename, hiding all historical DEDUCTs/MOVES under the old name.
--
-- Repro: SKU 03-3768BLD (renamed from 03-3768BL on 2026-05-12) had 8 DEDUCTs
-- under the old name + 10 completed picking_lists. Querying by the new name
-- returned only the EDIT row. Same for 03-4070BL (was 03-4070BK) and the
-- other 3 renames in the system.
--
-- This migration exposes two helpers:
--   resolve_sku_chain(sku)       — returns array of ALL historical SKU names
--                                  (current + every old name walked recursively
--                                  via previous_sku)
--   get_inventory_logs_for_sku(sku, limit) — alias-aware log fetch in a single
--                                  RPC call. Replaces .from('inventory_logs')
--                                  .eq('sku', sku) callsites that should
--                                  include history under old names.

CREATE OR REPLACE FUNCTION public.resolve_sku_chain(p_sku text)
RETURNS text[]
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_chain text[];
  v_current text;
  v_prev text;
  v_safety int := 0;
BEGIN
  IF p_sku IS NULL OR p_sku = '' THEN
    RETURN ARRAY[]::text[];
  END IF;

  v_current := p_sku;
  v_chain := ARRAY[v_current];

  -- Walk backwards: at each step find the most recent EDIT log that says
  -- "this SKU used to be called X". Add X to the chain and repeat from X.
  -- Stops when there's no more previous_sku, when we'd loop, or after 50 hops.
  LOOP
    SELECT previous_sku INTO v_prev
    FROM public.inventory_logs
    WHERE sku = v_current
      AND previous_sku IS NOT NULL
      AND previous_sku <> ''
      AND previous_sku <> sku
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_prev IS NULL THEN EXIT; END IF;
    IF v_prev = ANY(v_chain) THEN EXIT; END IF;  -- cycle guard

    v_chain := v_chain || v_prev;
    v_current := v_prev;
    v_safety := v_safety + 1;
    EXIT WHEN v_safety > 50;
  END LOOP;

  RETURN v_chain;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_sku_chain(text)
  TO anon, authenticated, service_role;


-- Alias-aware log fetcher. Mirrors the previous client-side query
--   .from('inventory_logs').select('*').eq('sku', sku)
--     .order('created_at', { ascending: false }).limit(N)
-- but expands the filter to the full rename chain.
CREATE OR REPLACE FUNCTION public.get_inventory_logs_for_sku(
  p_sku text,
  p_limit int DEFAULT 50
)
RETURNS SETOF public.inventory_logs
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT *
  FROM public.inventory_logs
  WHERE sku = ANY(public.resolve_sku_chain(p_sku))
  ORDER BY created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 1);
$function$;

GRANT EXECUTE ON FUNCTION public.get_inventory_logs_for_sku(text, int)
  TO anon, authenticated, service_role;
