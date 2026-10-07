-- ============================================================================
-- Todo lo que no es pallet queda loose (7 oct 2026, idea-254)
--
-- Rafael: «quiero dejar en loose todas las distribuciones que no son pallets en
-- el warehouse, ya no se está usando towers ni se va a usar ese concepto…
-- ojo no quitar la sublocation, solo la distribución». Decidido con él:
--   · se quedan BASE / TOP / LINE_PALLET; TOWER, LINE y OTHER salen (sus
--     unidades quedan loose: la cantidad no cambia);
--   · el PALLET viejo pasa a LINE_PALLET (≤ 12) o a la regla 18/12 (> 12);
--   · las bicis de niño no se tocan (regla 10: el piso las arma como quiere);
--   · las partes quedan sin cajas (regla 11).
-- Respaldo de cada fila en inventory_distribution_cleanup (para devolverla:
-- UPDATE inventory SET distribution = distribution_before WHERE id = inventory_id).
--
-- Dos triggers cambian para que la limpieza no se deshaga ni se lleve letras:
--   · set_default_inventory_distribution sólo arma cajas al CREAR una fila en
--     un ROW (antes, una fila sin cajas se rearmaba sola en el siguiente
--     cambio de cantidad, y una parte recibía una «torre» de toda su cantidad);
--   · keep_inventory_squares: con unidades loose la fila conserva sus letras
--     (antes una fila F,G con cajas sólo en F se quedaba en {F}).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_distribution_cleanup (
  inventory_id        bigint      NOT NULL,
  sku                 text        NOT NULL,
  location            text,
  quantity            integer,
  sublocation         text[],
  distribution_before jsonb       NOT NULL,
  distribution_after  jsonb       NOT NULL,
  cleaned_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_distribution_cleanup ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.inventory_distribution_cleanup IS
  'Cajas que no eran pallets, quitadas el 7 oct 2026 (20261007165830). Para devolver una: UPDATE inventory SET distribution = distribution_before WHERE id = inventory_id.';

-- The pallet rule on a number (copy of palletsFor in src/utils/distributionCalculator.ts;
-- if one changes, change the other).
CREATE OR REPLACE FUNCTION public.pallets_for(p_qty integer)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $f$
  WITH k AS (SELECT floor(p_qty / 30)::int AS ds, (p_qty - floor(p_qty / 30)::int * 30) AS r)
  SELECT CASE WHEN p_qty IS NULL OR p_qty <= 0 THEN '[]'::jsonb ELSE
    COALESCE((SELECT jsonb_agg(g) FROM (
      SELECT jsonb_build_object('type','BASE','count',ds,'units_each',18) g FROM k WHERE ds > 0 AND r BETWEEN 13 AND 18
      UNION ALL SELECT jsonb_build_object('type','BASE','count',1,'units_each',r) FROM k WHERE r BETWEEN 13 AND 18
      UNION ALL SELECT jsonb_build_object('type','BASE','count',ds + CASE WHEN r >= 19 THEN 1 ELSE 0 END,'units_each',18)
                FROM k WHERE NOT (r BETWEEN 13 AND 18) AND ds + CASE WHEN r >= 19 THEN 1 ELSE 0 END > 0
      UNION ALL SELECT jsonb_build_object('type','TOP','count',ds,'units_each',12) FROM k WHERE ds > 0
      UNION ALL SELECT jsonb_build_object('type','TOP','count',1,'units_each',r - 18) FROM k WHERE r >= 19
      UNION ALL SELECT jsonb_build_object('type','LINE_PALLET','count',1,'units_each',r) FROM k WHERE r BETWEEN 1 AND 12
    ) s), '[]'::jsonb) END
$f$;

CREATE OR REPLACE FUNCTION public.set_default_inventory_distribution()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_smart_dist JSONB;
BEGIN
  -- Only a new row in a ROW is born with boxes (the 18/12 rule; kids their
  -- towers). A row that loses its boxes stays loose; parts and places that
  -- are not a ROW carry none (idea-254 rules 10–11, 7 Oct 2026).
  IF TG_OP = 'INSERT'
     AND (NEW.distribution IS NULL OR NEW.distribution = '[]'::jsonb)
     AND NEW.quantity > 0
     AND NEW.location ILIKE 'ROW%' THEN
    v_smart_dist := public.calculate_bike_distribution(NEW.sku, NEW.quantity);
    IF v_smart_dist IS NOT NULL THEN
      NEW.distribution := v_smart_dist;
    END IF;
  END IF;
  IF NEW.distribution IS NULL THEN
    NEW.distribution := '[]'::jsonb;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.keep_inventory_squares()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old text[];
  v_new text[];
  v_groups jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_sq text;
  v_pos int;
  v_all boolean := true;
  v_letters text[];
BEGIN
  IF NEW.distribution IS NULL OR jsonb_typeof(NEW.distribution) <> 'array'
     OR jsonb_array_length(NEW.distribution) = 0 THEN
    RETURN NEW;
  END IF;

  -- Outside a ROW there are no squares.
  IF NEW.location IS NULL OR NEW.location NOT ILIKE 'ROW%' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.distribution) e WHERE e ? 'square') THEN
      SELECT jsonb_agg(e - 'square') INTO NEW.distribution
      FROM jsonb_array_elements(NEW.distribution) e;
    END IF;
    RETURN NEW;
  END IF;

  -- Only the letters changed: the groups follow their letter. Letters in both
  -- lists stay; the ones that left map, in order, to the ones that arrived
  -- (F,G → G,H is F → H: G never moved). Unequal counts: a group whose letter
  -- left keeps no square.
  IF TG_OP = 'UPDATE'
     AND NEW.distribution IS NOT DISTINCT FROM OLD.distribution
     AND NEW.sublocation IS DISTINCT FROM OLD.sublocation
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.distribution) e WHERE e ? 'square') THEN
    SELECT array_agg(DISTINCT s ORDER BY s) INTO v_old
      FROM unnest(COALESCE(OLD.sublocation, '{}')) s
     WHERE NOT (s = ANY(COALESCE(NEW.sublocation, '{}')));
    SELECT array_agg(DISTINCT s ORDER BY s) INTO v_new
      FROM unnest(COALESCE(NEW.sublocation, '{}')) s
     WHERE NOT (s = ANY(COALESCE(OLD.sublocation, '{}')));

    FOR v_entry IN SELECT e FROM jsonb_array_elements(NEW.distribution) e
    LOOP
      v_sq := v_entry->>'square';
      IF v_sq IS NOT NULL AND NOT (v_sq = ANY(COALESCE(NEW.sublocation, '{}'))) THEN
        v_pos := array_position(v_old, v_sq);
        IF v_pos IS NOT NULL AND cardinality(v_old) = cardinality(v_new) THEN
          v_entry := v_entry || jsonb_build_object('square', v_new[v_pos]);
        ELSE
          v_entry := v_entry - 'square';
        END IF;
      END IF;
      v_groups := v_groups || jsonb_build_array(v_entry);
    END LOOP;
    NEW.distribution := v_groups;
    RETURN NEW;
  END IF;

  -- Every group has its square: the row's letters are those squares.
  SELECT bool_and(e ? 'square' AND (e->>'square') ~ '^[A-Z]$'),
         array_agg(DISTINCT e->>'square' ORDER BY e->>'square')
    INTO v_all, v_letters
  FROM jsonb_array_elements(NEW.distribution) e;

  -- Units no box covers (loose, 7 Oct 2026) stand somewhere we don't know:
  -- the row keeps its letters and adds the boxes' ones. Only when the boxes
  -- cover every unit are the letters exactly the boxes' squares.
  IF v_all THEN
    IF COALESCE(NEW.quantity, 0) > (
         SELECT COALESCE(sum(GREATEST((e->>'count')::int, 0) * GREATEST((e->>'units_each')::int, 0)), 0)
         FROM jsonb_array_elements(NEW.distribution) e) THEN
      SELECT array_agg(DISTINCT s ORDER BY s) INTO NEW.sublocation
        FROM unnest(COALESCE(NEW.sublocation, '{}') || v_letters) s;
    ELSE
      NEW.sublocation := v_letters;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

WITH src AS (
  SELECT i.id, i.sku, i.location, i.quantity, i.sublocation, i.distribution AS before
  FROM public.inventory i
  WHERE jsonb_typeof(i.distribution) = 'array'
    AND jsonb_array_length(i.distribution) > 0
    AND NOT public.is_small_bike(i.sku)
), built AS (
  SELECT s.*,
    COALESCE((
      SELECT jsonb_agg(g)
      FROM (
        SELECT e AS g FROM jsonb_array_elements(s.before) e
         WHERE e->>'type' IN ('BASE', 'TOP', 'LINE_PALLET')
        UNION ALL
        SELECT e || jsonb_build_object('type', 'LINE_PALLET') FROM jsonb_array_elements(s.before) e
         WHERE e->>'type' = 'PALLET' AND (e->>'units_each')::int BETWEEN 1 AND 12
        UNION ALL
        SELECT p || jsonb_build_object('count', (p->>'count')::int * (e->>'count')::int)
                 || CASE WHEN e ? 'square' THEN jsonb_build_object('square', e->'square') ELSE '{}'::jsonb END
          FROM jsonb_array_elements(s.before) e,
               jsonb_array_elements(public.pallets_for((e->>'units_each')::int)) p
         WHERE e->>'type' = 'PALLET' AND (e->>'units_each')::int > 12
      ) x
    ), '[]'::jsonb) AS after
  FROM src s
), saved AS (
  INSERT INTO public.inventory_distribution_cleanup
    (inventory_id, sku, location, quantity, sublocation, distribution_before, distribution_after)
  SELECT id, sku, location, quantity, sublocation, before, after
  FROM built WHERE after IS DISTINCT FROM before
  RETURNING inventory_id, distribution_after
)
UPDATE public.inventory i SET distribution = s.distribution_after
  FROM saved s WHERE i.id = s.inventory_id;

COMMIT;
