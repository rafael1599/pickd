-- ============================================================================
-- A pool of never-used 01- numbers that AS400 says it does not have (Rafael,
-- 7 Oct 2026): «deberíamos tener al menos 30 que sí pickd ha verificado a
-- través del watchdog en el AS400 que no están… siempre es mejor ofrecer
-- opciones que nunca se han usado como sku para S/D que los que ya se han
-- usado».
--
-- PickD picks the candidates (01-NNNN it has never seen anywhere: catalog,
-- logs as sku or previous_sku), the watchdog asks AS400 STOCK INQUIRY one by
-- one in its gaps (tier `sd_probes`) and writes the verdict here. Never in
-- sku_metadata: a number nobody registered is not a catalog row.
--
-- A verdict «absent» is trusted for 14 days and then asked again: AS400 is
-- where S/D numbers are created, and somebody may have taken one there.
-- Which numbers first: the holes below the highest 01- PickD knows, from the
-- top down (the recent era of S/D numbering), then the ones above it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sd_sku_probes (
  sku               text PRIMARY KEY CHECK (sku ~ '^01-[0-9]{4}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  checked_at        timestamptz,
  verdict           text CHECK (verdict IN ('absent', 'present')),
  as400_description text
);
COMMENT ON TABLE public.sd_sku_probes IS
  'Never-used 01- numbers asked of AS400 by the watchdog (tier sd_probes). absent = free to offer for an S/D; re-asked after 14 days.';
ALTER TABLE public.sd_sku_probes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sd_sku_probes_read ON public.sd_sku_probes;
CREATE POLICY sd_sku_probes_read ON public.sd_sku_probes FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.sd_sku_probes TO authenticated;

-- What the watchdog should ask next. Tops the pool up first, so that the
-- verified-free plus the not-yet-asked never fall under p_target + 10.
CREATE OR REPLACE FUNCTION public.sd_probe_queue(p_target integer DEFAULT 30, p_limit integer DEFAULT 20)
 RETURNS TABLE (sku text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_have int;
  v_top int;
  v_n int;
  v_used int[];
BEGIN
  -- A probe whose number got used since (registered, renamed into) leaves.
  DELETE FROM public.sd_sku_probes p
   WHERE EXISTS (SELECT 1 FROM public.sku_metadata m WHERE m.sku = p.sku);

  SELECT count(*) INTO v_have FROM public.sd_sku_probes
   WHERE verdict IS NULL OR (verdict = 'absent' AND checked_at > now() - interval '14 days');

  IF v_have < COALESCE(p_target, 30) + 10 THEN
    SELECT max(substring(m.sku from '^01-([0-9]{4})')::int) INTO v_top
      FROM public.sku_metadata m
     WHERE m.sku ~ '^01-[0-9]{4}$' AND substring(m.sku from '^01-([0-9]{4})')::int < 1000;
    v_top := COALESCE(v_top, 600);
    -- Every 01- number PickD has seen, in any spelling it ever had
    -- (01-288 = 01-0288): catalog, archived units, logs as sku or previous_sku.
    SELECT array_agg(DISTINCT n) INTO v_used FROM (
      SELECT substring(m.sku from '^01-?0*([0-9]{1,4})[A-Z]*$')::int AS n
        FROM public.sku_metadata m WHERE m.sku ~ '^01-?[0-9]{1,4}[A-Z]*$'
      UNION SELECT substring(u.sku from '^01-?0*([0-9]{1,4})[A-Z]*$')::int
        FROM public.sd_units u WHERE u.sku ~ '^01-?[0-9]{1,4}[A-Z]*$'
      UNION SELECT substring(l.sku from '^01-?0*([0-9]{1,4})[A-Z]*$')::int
        FROM public.inventory_logs l WHERE l.sku ~ '^01-?[0-9]{1,4}[A-Z]*$'
      UNION SELECT substring(l.previous_sku from '^01-?0*([0-9]{1,4})[A-Z]*$')::int
        FROM public.inventory_logs l WHERE l.previous_sku ~ '^01-?[0-9]{1,4}[A-Z]*$'
    ) x;
    FOR v_n IN
      SELECT g FROM (
        SELECT g, 0 AS band, -g AS ord FROM generate_series(1, v_top) g
        UNION ALL
        SELECT g, 1, g FROM generate_series(v_top + 1, 9999) g
      ) c
      ORDER BY band, ord
    LOOP
      EXIT WHEN v_have >= COALESCE(p_target, 30) + 10;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.sd_sku_probes q WHERE q.sku = '01-' || lpad(v_n::text, 4, '0'));
      CONTINUE WHEN v_n = ANY (COALESCE(v_used, '{}'));
      INSERT INTO public.sd_sku_probes (sku) VALUES ('01-' || lpad(v_n::text, 4, '0'));
      v_have := v_have + 1;
    END LOOP;
  END IF;

  RETURN QUERY
    SELECT p.sku FROM public.sd_sku_probes p
     WHERE p.verdict IS NULL
        OR (p.verdict = 'absent' AND p.checked_at <= now() - interval '14 days')
     ORDER BY p.checked_at NULLS FIRST, p.created_at, p.sku
     LIMIT GREATEST(COALESCE(p_limit, 20), 1);
END;
$function$;
REVOKE ALL ON FUNCTION public.sd_probe_queue(integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.sd_probe_queue(integer, integer) TO service_role;

-- The proposal now leads with never-used numbers AS400 confirmed it does not
-- have; the reused ones (a sold S/D's number) only fill what is left.
DROP FUNCTION IF EXISTS public.sd_free_skus(integer);
CREATE OR REPLACE FUNCTION public.sd_free_skus(p_limit integer DEFAULT 5)
 RETURNS TABLE (sku text, kind text, last_out timestamptz, as400_description text, as400_read_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH fresh AS (
    SELECT p.sku, 'never_used'::text AS kind, NULL::timestamptz AS last_out,
           NULL::text AS as400_description, p.checked_at AS as400_read_at, 0 AS band
      FROM public.sd_sku_probes p
     WHERE p.verdict = 'absent'
       AND p.checked_at > now() - interval '14 days'
       AND NOT EXISTS (SELECT 1 FROM public.sku_metadata m WHERE m.sku = p.sku)
  ),
  c AS (
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
  ),
  reused AS (
    SELECT c.sku, 'reused'::text, c.last_out, c.as400_description, c.as400_read_at, 1
      FROM c
     WHERE c.last_out IS NOT NULL
       AND COALESCE((SELECT sum(v::int) FROM jsonb_each_text(c.as400_snapshot -> 'on_hand') AS x(k, v)), 0) = 0
       AND COALESCE((SELECT sum(v::int) FROM jsonb_each_text(c.as400_snapshot -> 'on_order') AS x(k, v)), 0) = 0
       AND COALESCE((SELECT sum(v::int) FROM jsonb_each_text(c.as400_snapshot -> 'open_po') AS x(k, v)), 0) = 0
  )
  SELECT sku, kind, last_out, as400_description, as400_read_at
    FROM (SELECT * FROM fresh UNION ALL SELECT * FROM reused) a
   ORDER BY band, CASE WHEN band = 0 THEN sku END, last_out, sku
   LIMIT GREATEST(COALESCE(p_limit, 5), 1);
$function$;
REVOKE ALL ON FUNCTION public.sd_free_skus(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.sd_free_skus(integer) TO authenticated, service_role;
