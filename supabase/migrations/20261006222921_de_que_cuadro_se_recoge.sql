-- De qué cuadro de un ROW se recoge (idea-253, P2;
-- docs/prds/stock-card-edit-and-pick-square.md §4.B).
--
-- Rafael, 6 oct 2026: «DCV tendría que mandar a recoger de la sublocation más
-- accesible», «la sublocation que es accesible y tiene la cantidad más baja
-- gana», y de la regla del 18 sep (la letra más alta): «no se reemplaza, se
-- complementa y ahora ya no es ley». El orden, para cada unidad que falta:
--   1. un cuadro accesible (el `isFast` del motor del mapa);
--   2. entre los accesibles, el de menos unidades;
--   3. desempate: la letra más alta (la regla del 18 sep);
--   4. si todos están enterrados: el que está al lado de uno accesible, luego
--      menos unidades, luego la letra más alta;
--   5. dentro del cuadro, la línea abierta antes que la torre llena;
--   6. si no alcanza, se vacía y se sigue con la misma regla (J 4 + A 2).
-- Sin la cantidad por cuadro (grupos sin `square`) el paso 2 se salta y se
-- toma todo del primero. Una fila que el mapa no dibuja (Bay 1, ROW 41+, que
-- no está medida) empieza por la A y sigue por la letra más baja.
--
-- Una sola regla para todas las pantallas: `plan_square_picks` decide,
-- `adjust_distribution` descuenta con ella y Double Check pide el mismo plan
-- (`plan_square_picks_batch`) para imprimir la letra. La geometría es la del
-- motor del mapa (`calculateLayout` con el estado por defecto de cada zona),
-- copiada a `row_squares`; un test (`rowSquares.test.ts`) falla si el motor y
-- esta copia dejan de coincidir. Aditiva: tabla nueva, funciones nuevas, y
-- `adjust_distribution` con la misma firma.

CREATE TABLE IF NOT EXISTS public.row_squares (
  location text NOT NULL,
  letter text NOT NULL CHECK (letter ~ '^[A-Z]$'),
  is_fast boolean NOT NULL,
  PRIMARY KEY (location, letter)
);

COMMENT ON TABLE public.row_squares IS
  'Cada cuadro dibujado de un ROW (LUDLOW, Bay 2 y Bay 3) y si es accesible (isFast del motor del mapa). Copia del motor: regenerar al cambiar el mapa (idea-253).';

ALTER TABLE public.row_squares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS row_squares_read ON public.row_squares;
CREATE POLICY row_squares_read ON public.row_squares FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.row_squares TO authenticated, service_role;

DELETE FROM public.row_squares;
INSERT INTO public.row_squares (location, letter, is_fast) VALUES
  ('ROW 1','A',true), ('ROW 1','B',true), ('ROW 1','C',true), ('ROW 1','D',true), ('ROW 1','E',true), ('ROW 1','F',true),
  ('ROW 1','G',true), ('ROW 1','H',true), ('ROW 2','A',true), ('ROW 2','B',true), ('ROW 2','C',true), ('ROW 2','D',true),
  ('ROW 2','E',true), ('ROW 2','F',true), ('ROW 2','G',true), ('ROW 2','H',true), ('ROW 3','A',true), ('ROW 3','B',true),
  ('ROW 3','C',true), ('ROW 3','D',true), ('ROW 3','E',true), ('ROW 3','F',true), ('ROW 3','G',true), ('ROW 3','H',true),
  ('ROW 4','A',true), ('ROW 4','B',true), ('ROW 4','C',true), ('ROW 4','D',true), ('ROW 4','E',true), ('ROW 4','F',true),
  ('ROW 4','G',true), ('ROW 4','H',true), ('ROW 5','A',true), ('ROW 5','B',true), ('ROW 5','C',true), ('ROW 5','D',true),
  ('ROW 5','E',true), ('ROW 5','F',true), ('ROW 5','G',true), ('ROW 5','H',true), ('ROW 6','A',true), ('ROW 6','B',true),
  ('ROW 6','C',true), ('ROW 6','D',true), ('ROW 6','E',true), ('ROW 6','F',true), ('ROW 6','G',true), ('ROW 6','H',true),
  ('ROW 7','A',true), ('ROW 7','B',true), ('ROW 7','C',true), ('ROW 7','D',true), ('ROW 7','E',true), ('ROW 7','F',true),
  ('ROW 7','G',true), ('ROW 7','H',true), ('ROW 8','A',true), ('ROW 8','B',true), ('ROW 8','C',true), ('ROW 8','D',true),
  ('ROW 8','E',true), ('ROW 8','F',true), ('ROW 8','G',true), ('ROW 8','H',true), ('ROW 9','A',true), ('ROW 9','B',true),
  ('ROW 9','C',true), ('ROW 9','D',true), ('ROW 9','E',true), ('ROW 9','F',true), ('ROW 9','G',true), ('ROW 9','H',true),
  ('ROW 10','A',true), ('ROW 10','B',true), ('ROW 10','C',true), ('ROW 10','D',true), ('ROW 10','E',true), ('ROW 10','F',true),
  ('ROW 10','G',true), ('ROW 10','H',true), ('ROW 11','A',true), ('ROW 11','B',true), ('ROW 11','C',true), ('ROW 11','D',true),
  ('ROW 11','E',true), ('ROW 11','F',true), ('ROW 11','G',true), ('ROW 11','H',true), ('ROW 12','A',true), ('ROW 12','B',true),
  ('ROW 12','C',true), ('ROW 12','D',true), ('ROW 12','E',true), ('ROW 12','F',true), ('ROW 12','G',true), ('ROW 12','H',true),
  ('ROW 13','A',true), ('ROW 13','B',true), ('ROW 13','C',true), ('ROW 13','D',true), ('ROW 13','E',true), ('ROW 13','F',true),
  ('ROW 13','G',true), ('ROW 13','H',true), ('ROW 14','A',true), ('ROW 14','B',false), ('ROW 14','C',false), ('ROW 14','D',false),
  ('ROW 14','E',false), ('ROW 14','F',false), ('ROW 14','G',false), ('ROW 14','H',true), ('ROW 15','A',true), ('ROW 15','B',true),
  ('ROW 15','C',true), ('ROW 15','D',true), ('ROW 15','E',true), ('ROW 15','F',true), ('ROW 15','G',true), ('ROW 15','H',true),
  ('ROW 16','A',true), ('ROW 16','B',true), ('ROW 16','C',true), ('ROW 16','D',true), ('ROW 16','E',true), ('ROW 16','F',true),
  ('ROW 16','G',true), ('ROW 16','H',true), ('ROW 17','A',true), ('ROW 17','B',true), ('ROW 17','C',true), ('ROW 17','D',true),
  ('ROW 17','E',true), ('ROW 17','F',true), ('ROW 17','G',true), ('ROW 17','H',true), ('ROW 18','A',true), ('ROW 18','B',true),
  ('ROW 18','C',true), ('ROW 18','D',true), ('ROW 18','E',true), ('ROW 18','F',true), ('ROW 18','G',true), ('ROW 18','H',true),
  ('ROW 18','I',true), ('ROW 18','J',true), ('ROW 18','K',true), ('ROW 19','A',true), ('ROW 19','B',true), ('ROW 19','C',true),
  ('ROW 19','D',true), ('ROW 19','E',true), ('ROW 19','F',true), ('ROW 19','G',true), ('ROW 19','H',true), ('ROW 19','I',true),
  ('ROW 19','J',true), ('ROW 19','K',true), ('ROW 20','A',true), ('ROW 20','B',true), ('ROW 20','C',true), ('ROW 20','D',true),
  ('ROW 20','E',true), ('ROW 20','F',true), ('ROW 20','G',true), ('ROW 20','H',true), ('ROW 20','I',true), ('ROW 20','J',true),
  ('ROW 20','K',true), ('ROW 21','A',true), ('ROW 21','B',false), ('ROW 21','C',false), ('ROW 21','D',false), ('ROW 21','E',false),
  ('ROW 21','F',false), ('ROW 21','G',false), ('ROW 21','H',false), ('ROW 21','I',false), ('ROW 21','J',false), ('ROW 21','K',true),
  ('ROW 22','A',true), ('ROW 22','B',true), ('ROW 22','C',true), ('ROW 22','D',true), ('ROW 22','E',true), ('ROW 22','F',true),
  ('ROW 22','G',true), ('ROW 22','H',true), ('ROW 22','I',true), ('ROW 22','J',true), ('ROW 22','K',true), ('ROW 23','A',true),
  ('ROW 23','B',true), ('ROW 23','C',true), ('ROW 23','D',true), ('ROW 23','E',true), ('ROW 23','F',true), ('ROW 23','G',true),
  ('ROW 23','H',true), ('ROW 23','I',true), ('ROW 23','J',true), ('ROW 23','K',true), ('ROW 24','A',true), ('ROW 24','B',false),
  ('ROW 24','C',false), ('ROW 24','D',false), ('ROW 24','E',false), ('ROW 24','F',false), ('ROW 24','G',false), ('ROW 24','H',false),
  ('ROW 24','I',false), ('ROW 24','J',false), ('ROW 24','K',true), ('ROW 25','A',true), ('ROW 25','B',true), ('ROW 25','C',true),
  ('ROW 25','D',true), ('ROW 25','E',true), ('ROW 25','F',true), ('ROW 25','G',true), ('ROW 25','H',true), ('ROW 25','I',true),
  ('ROW 25','J',true), ('ROW 25','K',true), ('ROW 26','A',true), ('ROW 26','B',true), ('ROW 26','C',true), ('ROW 26','D',true),
  ('ROW 26','E',true), ('ROW 26','F',true), ('ROW 26','G',true), ('ROW 26','H',true), ('ROW 26','I',true), ('ROW 26','J',true),
  ('ROW 26','K',true), ('ROW 27','A',true), ('ROW 27','B',false), ('ROW 27','C',false), ('ROW 27','D',false), ('ROW 27','E',false),
  ('ROW 27','F',false), ('ROW 27','G',false), ('ROW 27','H',false), ('ROW 27','I',false), ('ROW 27','J',false), ('ROW 27','K',true),
  ('ROW 28','A',true), ('ROW 28','B',false), ('ROW 28','C',false), ('ROW 28','D',false), ('ROW 28','E',false), ('ROW 28','F',false),
  ('ROW 28','G',false), ('ROW 28','H',false), ('ROW 28','I',false), ('ROW 28','J',false), ('ROW 28','K',true), ('ROW 29','A',true),
  ('ROW 29','B',true), ('ROW 29','C',true), ('ROW 29','D',true), ('ROW 29','E',true), ('ROW 29','F',true), ('ROW 29','G',true),
  ('ROW 29','H',true), ('ROW 29','I',true), ('ROW 29','J',true), ('ROW 29','K',true), ('ROW 30','A',true), ('ROW 30','B',true),
  ('ROW 30','C',true), ('ROW 30','D',true), ('ROW 30','E',true), ('ROW 30','F',true), ('ROW 30','G',true), ('ROW 30','H',true),
  ('ROW 30','I',true), ('ROW 30','J',true), ('ROW 30','K',true), ('ROW 31','A',true), ('ROW 31','B',false), ('ROW 31','C',false),
  ('ROW 31','D',false), ('ROW 31','E',false), ('ROW 31','F',false), ('ROW 31','G',false), ('ROW 31','H',false), ('ROW 31','I',false),
  ('ROW 31','J',false), ('ROW 31','K',true), ('ROW 32','A',true), ('ROW 32','B',false), ('ROW 32','C',false), ('ROW 32','D',false),
  ('ROW 32','E',false), ('ROW 32','F',false), ('ROW 32','G',false), ('ROW 32','H',false), ('ROW 32','I',false), ('ROW 32','J',false),
  ('ROW 32','K',true), ('ROW 33','A',true), ('ROW 33','B',true), ('ROW 33','C',true), ('ROW 33','D',true), ('ROW 33','E',true),
  ('ROW 33','F',true), ('ROW 33','G',true), ('ROW 33','H',true), ('ROW 33','I',true), ('ROW 33','J',true), ('ROW 33','K',true),
  ('ROW 34','A',true), ('ROW 34','B',true), ('ROW 34','C',true), ('ROW 34','D',true), ('ROW 34','E',true), ('ROW 34','F',true),
  ('ROW 35','A',true), ('ROW 35','B',true), ('ROW 35','C',true), ('ROW 35','D',true), ('ROW 35','E',true), ('ROW 35','F',true),
  ('ROW 36','A',true), ('ROW 36','B',true), ('ROW 36','C',true), ('ROW 36','D',true), ('ROW 36','E',true), ('ROW 36','F',true),
  ('ROW 37','A',true), ('ROW 37','B',false), ('ROW 37','C',false), ('ROW 37','D',false), ('ROW 37','E',false), ('ROW 37','F',true),
  ('ROW 38','A',true), ('ROW 38','B',true), ('ROW 38','C',true), ('ROW 38','D',true), ('ROW 38','E',true), ('ROW 38','F',true);

-- The old deduction, on any list of groups: PALLET → LINE → TOWER → OTHER, the
-- smallest first, the highest letter at equal size; every key of a group kept.
CREATE OR REPLACE FUNCTION public.deduct_from_groups(p_groups jsonb, p_qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    v_pending INTEGER := p_qty;
    v_type TEXT;
    v_types TEXT[] := ARRAY['PALLET', 'LINE', 'TOWER', 'OTHER'];
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

-- Which squares a pick of p_qty takes from, in order: [{square, take, why}].
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

  IF v_known THEN
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

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'square', v_pick.letter, 'take', v_take, 'why', v_why));
    v_need := v_need - v_take;
    v_left := v_left - v_pick.letter;
  END LOOP;

  RETURN v_plan;
END;
$function$;

-- Double Check asks for every line at once: [{key, location, distribution,
-- sublocation, qty}] → {key: plan}.
CREATE OR REPLACE FUNCTION public.plan_square_picks_batch(p_lines jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_object_agg(
    l->>'key',
    public.plan_square_picks(
      l->>'location',
      l->'distribution',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(l->'sublocation', '[]'::jsonb))),
      (l->>'qty')::int
    )
  ), '{}'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
  WHERE l ? 'key';
$function$;

GRANT EXECUTE ON FUNCTION public.plan_square_picks(text, jsonb, text[], integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plan_square_picks_batch(jsonb) TO authenticated, service_role;

-- The deduction follows the plan when every group says its square; otherwise
-- it is the deduction it always was. Same signature.
CREATE OR REPLACE FUNCTION public.adjust_distribution(p_item_id integer, p_qty_to_deduct integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_distribution JSONB;
    v_location TEXT;
    v_sublocation TEXT[];
    v_plan JSONB;
    v_step JSONB;
    v_in JSONB;
    v_out JSONB;
    v_result JSONB;
BEGIN
    IF p_qty_to_deduct <= 0 THEN
        RETURN NULL;
    END IF;

    SELECT distribution, location, sublocation
      INTO v_distribution, v_location, v_sublocation
    FROM inventory WHERE id = p_item_id;

    IF v_distribution IS NULL OR jsonb_array_length(v_distribution) = 0 THEN
        RETURN v_distribution;
    END IF;

    v_result := v_distribution;

    IF NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_distribution) e
         WHERE NOT (e ? 'square') OR (e->>'square') !~ '^[A-Z]$')
       AND upper(COALESCE(v_location, '')) LIKE 'ROW%' THEN
        v_plan := plan_square_picks(v_location, v_distribution, v_sublocation, p_qty_to_deduct);
        FOR v_step IN SELECT s FROM jsonb_array_elements(v_plan) s
        LOOP
            SELECT COALESCE(jsonb_agg(e) FILTER (WHERE e->>'square' = v_step->>'square'), '[]'::jsonb),
                   COALESCE(jsonb_agg(e) FILTER (WHERE e->>'square' IS DISTINCT FROM v_step->>'square'), '[]'::jsonb)
              INTO v_in, v_out
            FROM jsonb_array_elements(v_result) e;
            v_result := v_out || deduct_from_groups(v_in, (v_step->>'take')::int);
        END LOOP;
    ELSE
        v_result := deduct_from_groups(v_distribution, p_qty_to_deduct);
    END IF;

    UPDATE inventory
    SET distribution = v_result,
        updated_at = NOW()
    WHERE id = p_item_id;

    RETURN v_result;
END;
$function$;
