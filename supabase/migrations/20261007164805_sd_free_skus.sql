-- ============================================================================
-- Five free 01- numbers to offer when a unit is marked S/D (Rafael, 7 Oct
-- 2026: «quisiera proponer 5 sku libres según la data de pickd y as400 cuando
-- se pasa a Mark as S/D»).
--
-- Free = an 01-NNNN (AS400 gives that number only to S/D) that PickD holds no
-- unit of, AS400 showed with nothing on hand, on order or on PO when the
-- watchdog read it, no open order names, and that has a recorded way out (a
-- sold bike, not a placeholder). Oldest exit first: the number gone longest
-- is the one least likely to come back. Taking one archives its sold bike
-- (split_unit → archive_sd_unit, idea-257); AS400 still describes that bike
-- until someone updates it there.
-- A number PickD never saw is not offered: whether AS400 uses it is unknown.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sd_free_skus(p_limit integer DEFAULT 5)
 RETURNS TABLE (sku text, last_out timestamptz, as400_description text, as400_read_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH c AS (
    SELECT m.sku, m.as400_description, m.as400_read_at, m.as400_snapshot,
           (SELECT max(l.created_at) FROM public.inventory_logs l
             WHERE l.sku = m.sku AND l.quantity_change < 0 AND l.sd_unit_id IS NULL) AS last_out
      FROM public.sku_metadata m
     WHERE m.sku ~ '^01-[0-9]{4}$'
       AND m.as400_absent_at IS NULL
       AND m.as400_snapshot IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.sku = m.sku AND i.quantity > 0)
       AND NOT EXISTS (
         SELECT 1 FROM public.picking_lists p
          WHERE p.status NOT IN ('completed', 'cancelled')
            AND p.items @> jsonb_build_array(jsonb_build_object('sku', m.sku)))
  )
  SELECT c.sku, c.last_out, c.as400_description, c.as400_read_at
    FROM c
   WHERE c.last_out IS NOT NULL
     AND COALESCE((SELECT sum(v::int) FROM jsonb_each_text(c.as400_snapshot -> 'on_hand') AS x(k, v)), 0) = 0
     AND COALESCE((SELECT sum(v::int) FROM jsonb_each_text(c.as400_snapshot -> 'on_order') AS x(k, v)), 0) = 0
     AND COALESCE((SELECT sum(v::int) FROM jsonb_each_text(c.as400_snapshot -> 'open_po') AS x(k, v)), 0) = 0
   ORDER BY c.last_out, c.sku
   LIMIT GREATEST(COALESCE(p_limit, 5), 1);
$function$;
REVOKE ALL ON FUNCTION public.sd_free_skus(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.sd_free_skus(integer) TO authenticated, service_role;
