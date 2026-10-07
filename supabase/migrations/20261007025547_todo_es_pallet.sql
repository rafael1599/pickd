-- Todo es pallet (idea-254, F1 + F2; docs/prds/ds-pallet-model.md).
--
-- Rafael, 6 oct 2026: «ya no existen lines por sí solas… no hay torres, sólo
-- pallets». Base = 18 en el piso, top = 12 encima de una base, DS = las dos
-- (30); line pallet = 1–12 en el piso.
--
-- 1. `is_small_bike(sku)`: las bicis de niño son la excepción («los usuarios
--    las arman como les parezca»). Copia de `isSmallBikeSku`
--    (src/utils/bikeDetection.ts): si cambia una, cambiar la otra.
-- 2. `calculate_bike_distribution`: lo que nace nuevo nace en pallets — DS de
--    30, y el resto 19–29 DS incompleta, 13–18 base, 1–12 line pallet. Una de
--    niño sigue con torres de 30 y líneas de 5. Copia de `palletsFor`
--    (src/utils/distributionCalculator.ts).
-- 3. `deduct_from_groups`: se recoge del top primero, después la base, después
--    la line pallet; un top que llega a 0 desaparece y la DS queda base. Los
--    tipos viejos siguen detrás, como antes.
-- 4. `plan_square_picks` dice además cuántas de cada paso salen de un top
--    (`top`): Double Check pinta de otro color la línea que necesita plataforma.
--
-- Aditiva: funciones nuevas o con la misma firma; las filas de hoy no se
-- tocan (eso es F4, con su ensayo y el ok de Rafael).

CREATE OR REPLACE FUNCTION public.is_small_bike(p_sku text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT upper(trim(COALESCE(p_sku, ''))) LIKE '07-%'
      OR EXISTS (
        SELECT 1 FROM sku_metadata m
        WHERE m.sku = p_sku
          AND (
            COALESCE(m.model, '') ~* '^\s*JUV\y'
            OR COALESCE(m.as400_description, '') ~* '^\s*JUV\y'
            OR (COALESCE(m.model, '') || ' ' || COALESCE(m.as400_description, ''))
                 ~* '\yTAXI\s*(10X)?(16|20|24)\y'
            OR (COALESCE(m.model, '') || ' ' || COALESCE(m.as400_description, ''))
                 ~* '\y(STARLITE|MISS\s*DAISY|CRITTER|HOT\s*ROD|CAPRI|LASER)\y'
            OR (COALESCE(m.model, '') || ' ' || COALESCE(m.as400_description, ''))
                 ~* '\yXR?\.\d{2}\y'
          )
      );
$function$;

CREATE OR REPLACE FUNCTION public.calculate_bike_distribution(p_sku text, p_qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_is_bike BOOLEAN;
  v_result JSONB := '[]'::JSONB;
  v_ds INTEGER;
  v_r INTEGER;
  v_full_lines INTEGER;
BEGIN
  SELECT is_bike INTO v_is_bike FROM public.sku_metadata WHERE sku = p_sku;
  IF v_is_bike IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN '[]'::JSONB;
  END IF;

  -- Kids bikes: the old towers of 30 and lines of 5, a start the floor edits.
  IF public.is_small_bike(p_sku) THEN
    v_ds := floor(p_qty / 30);
    v_r := p_qty - v_ds * 30;
    IF v_ds > 0 THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object('type', 'TOWER', 'count', v_ds, 'units_each', 30));
    END IF;
    v_full_lines := floor(v_r / 5);
    IF v_full_lines > 0 THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object('type', 'LINE', 'count', v_full_lines, 'units_each', 5));
      v_r := v_r - v_full_lines * 5;
    END IF;
    IF v_r > 0 THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object('type', 'LINE', 'count', 1, 'units_each', v_r));
    END IF;
    RETURN v_result;
  END IF;

  v_ds := floor(p_qty / 30);
  v_r := p_qty - v_ds * 30;

  IF v_r BETWEEN 13 AND 18 THEN
    IF v_ds > 0 THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object('type', 'BASE', 'count', v_ds, 'units_each', 18));
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object('type', 'BASE', 'count', 1, 'units_each', v_r));
  ELSIF v_ds + (CASE WHEN v_r >= 19 THEN 1 ELSE 0 END) > 0 THEN
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'type', 'BASE', 'count', v_ds + (CASE WHEN v_r >= 19 THEN 1 ELSE 0 END), 'units_each', 18));
  END IF;
  IF v_ds > 0 THEN
    v_result := v_result || jsonb_build_array(jsonb_build_object('type', 'TOP', 'count', v_ds, 'units_each', 12));
  END IF;
  IF v_r >= 19 THEN
    v_result := v_result || jsonb_build_array(jsonb_build_object('type', 'TOP', 'count', 1, 'units_each', v_r - 18));
  END IF;
  IF v_r BETWEEN 1 AND 12 THEN
    v_result := v_result || jsonb_build_array(jsonb_build_object('type', 'LINE_PALLET', 'count', 1, 'units_each', v_r));
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.deduct_from_groups(p_groups jsonb, p_qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    v_pending INTEGER := p_qty;
    v_type TEXT;
    v_types TEXT[] := ARRAY['TOP', 'BASE', 'LINE_PALLET', 'PALLET', 'LINE', 'TOWER', 'OTHER'];
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

CREATE OR REPLACE FUNCTION public.plan_square_picks(
  p_location text,
  p_distribution jsonb,
  p_sublocation text[],
  p_qty integer
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_loc text := upper(trim(COALESCE(p_location, '')));
  v_drawn boolean;
  v_known boolean;
  v_left jsonb := '{}'::jsonb;   -- letter -> units (null = unknown)
  v_tops jsonb := '{}'::jsonb;   -- letter -> units on a top (idea-254)
  v_top_all int := 0;            -- units on tops when the squares are unknown
  v_from_top int;
  v_need int := p_qty;
  v_plan jsonb := '[]'::jsonb;
  v_pick record;
  v_take int;
  v_fast_count int;
  v_why text;
  v_neighbour text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 OR v_loc NOT LIKE 'ROW%' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_drawn := EXISTS (SELECT 1 FROM row_squares WHERE location = v_loc);

  v_known := p_distribution IS NOT NULL
    AND jsonb_typeof(p_distribution) = 'array'
    AND jsonb_array_length(p_distribution) > 0
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_distribution) e
      WHERE NOT (e ? 'square') OR (e->>'square') !~ '^[A-Z]$'
    );

  SELECT COALESCE(sum(GREATEST((e->>'count')::int, 0) * GREATEST((e->>'units_each')::int, 0)), 0)
    INTO v_top_all
  FROM jsonb_array_elements(COALESCE(p_distribution, '[]'::jsonb)) e
  WHERE e->>'type' = 'TOP';

  IF v_known THEN
    SELECT COALESCE(jsonb_object_agg(sq, units), '{}'::jsonb) INTO v_tops
    FROM (
      SELECT e->>'square' AS sq,
             sum(GREATEST((e->>'count')::int, 0) * GREATEST((e->>'units_each')::int, 0)) AS units
      FROM jsonb_array_elements(p_distribution) e
      WHERE e->>'type' = 'TOP'
      GROUP BY 1
    ) t;
    SELECT COALESCE(jsonb_object_agg(sq, units), '{}'::jsonb) INTO v_left
    FROM (
      SELECT e->>'square' AS sq,
             sum(GREATEST((e->>'count')::int, 0) * GREATEST((e->>'units_each')::int, 0)) AS units
      FROM jsonb_array_elements(p_distribution) e
      GROUP BY 1
    ) s
    WHERE units > 0;
  ELSE
    SELECT COALESCE(jsonb_object_agg(l, NULL), '{}'::jsonb) INTO v_left
    FROM (SELECT DISTINCT upper(l) AS l FROM unnest(COALESCE(p_sublocation, '{}')) l
          WHERE upper(l) ~ '^[A-Z]$') x;
  END IF;

  WHILE v_need > 0 AND v_left <> '{}'::jsonb LOOP
    SELECT c.key AS letter,
           CASE WHEN jsonb_typeof(c.value) = 'number' THEN (c.value)::text::int END AS units,
           COALESCE(rs.is_fast, false) AS fast,
           EXISTS (
             SELECT 1 FROM row_squares n
             WHERE n.location = v_loc AND n.is_fast
               AND abs(ascii(n.letter) - ascii(c.key)) = 1
           ) AS nxt
      INTO v_pick
    FROM jsonb_each(v_left) c
    LEFT JOIN row_squares rs ON rs.location = v_loc AND rs.letter = c.key
    ORDER BY
      CASE WHEN v_drawn THEN 0 ELSE ascii(c.key) END,
      COALESCE(rs.is_fast, false) DESC,
      (COALESCE(rs.is_fast, false) OR EXISTS (
         SELECT 1 FROM row_squares n
         WHERE n.location = v_loc AND n.is_fast
           AND abs(ascii(n.letter) - ascii(c.key)) = 1)) DESC,
      CASE WHEN jsonb_typeof(c.value) = 'number' THEN (c.value)::text::int END ASC NULLS LAST,
      c.key DESC
    LIMIT 1;

    v_take := CASE WHEN v_pick.units IS NULL THEN v_need ELSE LEAST(v_pick.units, v_need) END;

    IF NOT v_drawn THEN
      v_why := 'A first';
    ELSIF v_pick.fast THEN
      SELECT count(*) INTO v_fast_count
      FROM jsonb_each(v_left) c
      JOIN row_squares rs ON rs.location = v_loc AND rs.letter = c.key AND rs.is_fast;
      v_why := CASE WHEN v_fast_count > 1 AND v_pick.units IS NOT NULL THEN 'fewest' ELSE 'open' END;
    ELSIF v_pick.nxt THEN
      SELECT n.letter INTO v_neighbour FROM row_squares n
      WHERE n.location = v_loc AND n.is_fast AND abs(ascii(n.letter) - ascii(v_pick.letter)) = 1
      ORDER BY n.letter LIMIT 1;
      v_why := 'next to ' || v_neighbour;
    ELSE
      v_why := 'buried';
    END IF;

    -- A pick takes from the top first (idea-254): how many of these come off one.
    IF v_known THEN
      v_from_top := LEAST(v_take, COALESCE((v_tops->>v_pick.letter)::int, 0));
    ELSE
      v_from_top := LEAST(v_take, v_top_all);
      v_top_all := v_top_all - v_from_top;
    END IF;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'square', v_pick.letter, 'take', v_take, 'why', v_why, 'top', v_from_top));
    v_need := v_need - v_take;
    v_left := v_left - v_pick.letter;
  END LOOP;

  RETURN v_plan;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.is_small_bike(text) TO authenticated, service_role;
