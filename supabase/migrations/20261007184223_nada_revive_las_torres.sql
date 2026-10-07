-- ============================================================================
-- Nada revive las torres ni las lines (7 oct 2026, idea-254)
--
-- Rafael: «limpia el código de torres y lines, revisa que en la base de datos
-- tampoco quede nada que reviva algo relacionado». Tras la limpieza a loose
-- (20261007165830) quedaban tres puertas por las que volverían:
--   · deshacer desde History un movimiento viejo restaura su snapshot_before,
--     con las torres de entonces;
--   · un teléfono con un build viejo todavía tiene el ⋯ «Quick Stack
--     Adjustment» que suma torres y lines;
--   · cualquier otro escritor de `distribution`.
-- Un solo guardián las cierra todas: pallets_only() deja en una bici adulta
-- sólo BASE / TOP / LINE_PALLET (un PALLET viejo pasa a line pallet o a la
-- regla 18/12), a una parte no le deja cajas (regla 11) y a una bici de niño la
-- deja como esté (regla 10). El trigger corre después del que arma las cajas
-- al crear la fila y antes del de cuadros.
-- deduct_from_groups deja de nombrar PALLET y OTHER.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pallets_only(p_sku text, p_dist jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bike boolean;
BEGIN
  IF p_dist IS NULL OR jsonb_typeof(p_dist) <> 'array' OR jsonb_array_length(p_dist) = 0 THEN
    RETURN p_dist;
  END IF;
  IF public.is_small_bike(p_sku) THEN
    RETURN p_dist;
  END IF;
  SELECT is_bike INTO v_bike FROM public.sku_metadata WHERE sku = p_sku;
  IF v_bike IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(g)
    FROM (
      SELECT e AS g FROM jsonb_array_elements(p_dist) e
       WHERE e->>'type' IN ('BASE', 'TOP', 'LINE_PALLET')
      UNION ALL
      SELECT e || jsonb_build_object('type', 'LINE_PALLET') FROM jsonb_array_elements(p_dist) e
       WHERE e->>'type' = 'PALLET' AND (e->>'units_each')::int BETWEEN 1 AND 12
      UNION ALL
      SELECT p || jsonb_build_object('count', (p->>'count')::int * (e->>'count')::int)
               || CASE WHEN e ? 'square' THEN jsonb_build_object('square', e->'square') ELSE '{}'::jsonb END
        FROM jsonb_array_elements(p_dist) e,
             jsonb_array_elements(public.pallets_for((e->>'units_each')::int)) p
       WHERE e->>'type' = 'PALLET' AND (e->>'units_each')::int > 12
    ) x
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.keep_inventory_pallets_only()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.distribution IS DISTINCT FROM OLD.distribution
     OR NEW.sku IS DISTINCT FROM OLD.sku THEN
    NEW.distribution := public.pallets_only(NEW.sku, NEW.distribution);
  END IF;
  RETURN NEW;
END;
$function$;

-- Name order matters: after tr_inventory_default_distribution (builds a new
-- row's boxes), before trg_zz_inventory_sync_location and trg_zzz_inventory_squares.
DROP TRIGGER IF EXISTS trg_zy_inventory_pallets_only ON public.inventory;
CREATE TRIGGER trg_zy_inventory_pallets_only
  BEFORE INSERT OR UPDATE OF distribution, sku ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.keep_inventory_pallets_only();

CREATE OR REPLACE FUNCTION public.deduct_from_groups(p_groups jsonb, p_qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    v_pending INTEGER := p_qty;
    v_type TEXT;
    -- Pallets top first; then a kids bike's lines and towers (7 Oct 2026: PALLET and OTHER are gone).
    v_types TEXT[] := ARRAY['TOP', 'BASE', 'LINE_PALLET', 'LINE', 'TOWER'];
    v_entry JSONB;
    v_count INTEGER;
    v_units_each INTEGER;
    v_full_remove INTEGER;
    v_residual INTEGER;
    v_result JSONB := '[]'::JSONB;
BEGIN
    IF p_groups IS NULL OR jsonb_array_length(p_groups) = 0 OR p_qty <= 0 THEN
        RETURN COALESCE(p_groups, '[]'::jsonb);
    END IF;

    FOREACH v_type IN ARRAY v_types
    LOOP
        FOR v_entry IN
            SELECT e.value
            FROM jsonb_array_elements(p_groups) AS e(value)
            WHERE e.value->>'type' = v_type
            ORDER BY (e.value->>'units_each')::INTEGER ASC,
                     COALESCE(e.value->>'square', '') DESC
        LOOP
            v_count := (v_entry->>'count')::INTEGER;
            v_units_each := (v_entry->>'units_each')::INTEGER;

            IF v_pending <= 0 OR v_count <= 0 OR v_units_each <= 0 THEN
                v_result := v_result || jsonb_build_array(v_entry);
                CONTINUE;
            END IF;

            v_full_remove := LEAST(floor(v_pending::NUMERIC / v_units_each)::INTEGER, v_count);
            v_count := v_count - v_full_remove;
            v_pending := v_pending - (v_full_remove * v_units_each);

            IF v_pending > 0 AND v_count > 0 THEN
                v_count := v_count - 1;
                v_residual := v_units_each - v_pending;
                v_pending := 0;
                IF v_residual > 0 THEN
                    v_result := v_result || jsonb_build_array(
                        v_entry || jsonb_build_object('count', 1, 'units_each', v_residual)
                    );
                END IF;
            END IF;

            IF v_count > 0 THEN
                v_result := v_result || jsonb_build_array(v_entry || jsonb_build_object('count', v_count));
            END IF;
        END LOOP;
    END LOOP;

    -- A type outside the four would be dropped by the loop: keep it.
    v_result := v_result || COALESCE((
        SELECT jsonb_agg(e) FROM jsonb_array_elements(p_groups) e
        WHERE NOT (e->>'type' = ANY(v_types))
    ), '[]'::jsonb);

    RETURN v_result;
END;
$function$;

COMMIT;
