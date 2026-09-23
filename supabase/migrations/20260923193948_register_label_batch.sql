-- ============================================================================
-- El lote de cajas por foto: register_label_batch + label_batch_runs (idea-224, P1)
--
-- PRD: docs/prds/inventory-batch-label-intake.md §6.
--
-- «Escribir un lote en una ubicación» sigue teniendo UNA implementación:
-- apply_intake_lines (20260923182404). Aquí aprende tres cosas que el contenedor
-- no usa y por eso le salen gratis (sus líneas no traen esas llaves):
--
--   1. `is_bike` explícito por línea al CREAR un SKU. Se inserta la fila de
--      sku_metadata antes que register_new_sku, porque set_is_bike_on_insert
--      respeta el valor explícito y con él escribe los defaults de caja del tipo
--      correcto. Sin esto un `05-…` nace parte por prefijo (1 lb, 0×0×0), y
--      corregirlo después con un UPDATE era exactamente el agujero que cerró
--      20260923182403.
--   2. `weight_lbs` por línea (el G.W. de la etiqueta): en un SKU nuevo viaja en
--      el insert; en uno existente sólo se escribe si weight_verified = false —
--      una pesada real no la pisa nadie. Escribirlo lo sella como verificado, que
--      es lo decidido: es un número del fabricante.
--   3. `p_stamp_received_year`: el contenedor estampa el año de llegada; el lote
--      no (PRD §6, «lo que no se toca»). Default true: el contenedor no cambia.
--
-- register_label_batch es la puerta del lote: la idempotencia por batch_id y el
-- registro de medición en label_batch_runs, alrededor de apply_intake_lines.
-- ============================================================================

-- ── 1) label_batch_runs ────────────────────────────────────────────────────
-- La guarda del doble-submit y el instrumento, en la misma fila. El escáner en
-- vivo se retiró sin un solo registro de qué tan bien funcionaba porque su tabla
-- se creó el último día; ésta nace con la función.
CREATE TABLE IF NOT EXISTS public.label_batch_runs (
  batch_id        uuid PRIMARY KEY,
  location        text NOT NULL,
  warehouse       text NOT NULL,
  skus            integer NOT NULL,
  units           integer NOT NULL,
  new_skus        text[] NOT NULL DEFAULT '{}',
  photos          integer,
  cards_camera    integer,
  cards_hand      integer,
  amber_resolved  integer,
  red_typed       integer,
  units_hand_set  integer,
  seconds         numeric,
  app_version     text,
  device          text,
  result          jsonb NOT NULL,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.label_batch_runs IS
  'Un lote de cajas registrado por foto (idea-224). batch_id lo genera el cliente: '
  'un reenvío con el mismo id devuelve el resultado guardado sin escribir. Las '
  'cifras de cámara vs mano y segundos son la medición que decide si el lector sirve.';

ALTER TABLE public.label_batch_runs ENABLE ROW LEVEL SECURITY;

-- Sólo se escribe por la RPC (SECURITY DEFINER); leer es de admin. Append-only:
-- ninguna política de UPDATE ni DELETE.
DROP POLICY IF EXISTS label_batch_runs_select_admin ON public.label_batch_runs;
CREATE POLICY label_batch_runs_select_admin ON public.label_batch_runs
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.label_batch_runs FROM anon;

-- ── 2) apply_intake_lines, con las tres capacidades ────────────────────────
-- Cambia la firma (un parámetro más), así que se tira y se vuelve a crear, y
-- register_container —que la llama por nombre— se recrea en la misma
-- transacción, idéntico al de 20260923182404.
DROP FUNCTION IF EXISTS public.apply_intake_lines(text, jsonb, uuid, text, text, text);

CREATE FUNCTION public.apply_intake_lines(
  p_location            text,
  p_items               jsonb,
  p_user_id             uuid,
  p_performed_by        text,
  p_warehouse           text    DEFAULT 'LUDLOW'::text,
  p_order_number        text    DEFAULT NULL::text,
  p_stamp_received_year boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_location text := upper(trim(p_location));
  v_year     smallint := extract(year FROM now() AT TIME ZONE 'America/New_York')::smallint;
  v_skus int := 0;
  v_units int := 0;
  v_new text[] := '{}';
  v_is_bike boolean;
  v_weight numeric;
  r record;
BEGIN
  IF v_location = '' OR v_location IS NULL THEN
    RAISE EXCEPTION 'Location is required' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT * FROM public.resolve_container_skus(p_items, p_warehouse)
  LOOP
    -- Lo que las líneas dicen de este SKU más allá de sku/qty/nombre. Una línea
    -- de contenedor no trae estas llaves y ambas quedan en NULL.
    -- resolve_container_skus agrupa y se queda sólo con sus columnas, así que
    -- se vuelven a leer de las líneas que agrupó (merged_from).
    SELECT bool_or((e->>'is_bike')::boolean),
           max(nullif(e->>'weight_lbs', '')::numeric)
      INTO v_is_bike, v_weight
      FROM jsonb_array_elements(p_items) e
     WHERE upper(trim(e->>'sku')) = ANY (r.merged_from);

    IF v_weight IS NOT NULL AND v_weight <= 0 THEN
      v_weight := NULL;  -- un «Weight: 0» no es un peso
    END IF;

    IF r.is_new THEN
      IF v_is_bike IS NOT NULL THEN
        -- Primero, con el tipo explícito: el trigger de alta escribe la caja
        -- por defecto del tipo correcto y, si viene peso, lo sella leído.
        INSERT INTO sku_metadata (sku, is_bike, weight_lbs)
        VALUES (r.canonical_sku, v_is_bike, v_weight)
        ON CONFLICT (sku) DO NOTHING;
      END IF;

      PERFORM public.register_new_sku(
        p_sku       => r.canonical_sku,
        -- Sin nombre pero con modelo/talla/color (una tarjeta del lote), NULL
        -- deja que register_new_sku nombre la fila «Modelo Talla Color». Sólo
        -- sin nada cae al SKU, como hasta ahora.
        p_item_name => coalesce(
          r.item_name,
          CASE WHEN coalesce(r.model, r.size, r.color) IS NULL THEN r.canonical_sku END
        ),
        p_warehouse => p_warehouse,
        p_location  => v_location,
        p_model     => r.model,
        p_size      => r.size,
        p_color     => r.color
      );
      v_new := array_append(v_new, r.canonical_sku);
    END IF;

    -- A SKU the catalog already had keeps everything it already knows; the
    -- sheet only fills what is blank. A container is a shipping document, not
    -- the authority on a bike somebody has since named properly by hand.
    IF r.model IS NOT NULL OR r.size IS NOT NULL OR r.color IS NOT NULL THEN
      UPDATE sku_metadata sm
         SET model = coalesce(sm.model, r.model),
             size  = coalesce(sm.size,  r.size),
             color = coalesce(sm.color, r.color)
       WHERE sm.sku = r.canonical_sku
         AND (sm.model IS NULL OR sm.size IS NULL OR sm.color IS NULL);
    END IF;

    -- El peso de la etiqueta sobre un SKU que ya existía: sólo si nadie lo pesó.
    IF v_weight IS NOT NULL AND NOT r.is_new THEN
      UPDATE sku_metadata sm
         SET weight_lbs = v_weight
       WHERE sm.sku = r.canonical_sku
         AND NOT coalesce(sm.weight_verified, false)
         AND sm.weight_lbs IS DISTINCT FROM v_weight;
    END IF;

    -- The year it came in is a fact of this intake, not of the sheet: it is
    -- always written, new SKU or old (20260910181656). The batch does not
    -- stamp it: a bike found on the floor did not arrive this year.
    IF p_stamp_received_year THEN
      UPDATE sku_metadata SET received_year = v_year WHERE sku = r.canonical_sku;
    END IF;

    PERFORM public.adjust_inventory_quantity(
      r.canonical_sku, p_warehouse, v_location, r.qty,
      coalesce(p_performed_by, 'Container Intake'),
      p_user_id, 'admin', NULL, p_order_number
      -- sin `p_merge_note`: iba a `internal_note` y sólo repetía el nombre
    );

    v_skus  := v_skus + 1;
    v_units := v_units + r.qty;
  END LOOP;

  RETURN jsonb_build_object(
    'location', v_location,
    'warehouse', p_warehouse,
    'skus', v_skus,
    'units', v_units,
    'new_skus', v_new
  );
END;
$function$;

COMMENT ON FUNCTION public.apply_intake_lines(text, jsonb, uuid, text, text, text, boolean) IS
  'Escribe un lote de líneas en una ubicación, en una transacción. La única '
  'implementación: la usan register_container (con su guarda) y register_label_batch '
  '(con su batch_id). Por línea acepta is_bike (al crear) y weight_lbs (si nadie pesó).';

REVOKE ALL ON FUNCTION public.apply_intake_lines(text, jsonb, uuid, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_intake_lines(text, jsonb, uuid, text, text, text, boolean)
  TO service_role;

-- register_container, idéntico a 20260923182404 (se recrea sólo porque su
-- llamada tiene que volver a resolverse contra la firma nueva).
CREATE OR REPLACE FUNCTION public.register_container(
  p_location text,
  p_items jsonb,
  p_user_id uuid,
  p_performed_by text,
  p_warehouse text DEFAULT 'LUDLOW'::text,
  p_order_number text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_location text := upper(trim(p_location));
  v_dup      text[];
BEGIN
  IF v_location = '' OR v_location IS NULL THEN
    RAISE EXCEPTION 'Location is required' USING ERRCODE = '22023';
  END IF;

  -- Re-run guard, por SKU: se niega si alguno de los que llegan ya tiene stock
  -- en esta ubicación. Así un reenvío del manifiesto entero falla y una línea
  -- nueva sobre un contenedor a medio descargar entra.
  SELECT array_agg(DISTINCT i.sku ORDER BY i.sku) INTO v_dup
  FROM inventory i
  WHERE i.warehouse = p_warehouse
    AND upper(trim(coalesce(i.location, ''))) = v_location
    AND i.quantity > 0
    AND i.sku IN (SELECT canonical_sku FROM public.resolve_container_skus(p_items, p_warehouse));

  IF v_dup IS NOT NULL AND array_length(v_dup, 1) > 0 THEN
    RAISE EXCEPTION 'Location % already holds stock of % — aborting to avoid double-load: %',
      v_location, array_length(v_dup, 1), array_to_string(v_dup[1:5], ', ')
      USING ERRCODE = '23505';
  END IF;

  RETURN public.apply_intake_lines(
    p_location     => v_location,
    p_items        => p_items,
    p_user_id      => p_user_id,
    p_performed_by => p_performed_by,
    p_warehouse    => p_warehouse,
    p_order_number => p_order_number
  );
END;
$function$;

-- ── 3) register_label_batch ────────────────────────────────────────────────
-- p_items: [{sku, qty, model, size, color, is_bike, weight_lbs}], una por tarjeta.
-- p_stats: las cifras de la sesión que calcula el cliente (photos, cards_camera,
-- cards_hand, amber_resolved, red_typed, units_hand_set, seconds, app_version,
-- device). Sólo se guardan; no deciden nada.
CREATE OR REPLACE FUNCTION public.register_label_batch(
  p_batch_id     uuid,
  p_location     text,
  p_items        jsonb,
  p_user_id      uuid,
  p_performed_by text,
  p_warehouse    text  DEFAULT 'LUDLOW'::text,
  p_stats        jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prev   jsonb;
  v_result jsonb;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'batch_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'The batch has no lines' USING ERRCODE = '22023';
  END IF;

  -- Dos POST con el mismo id a la vez (la red reintenta sola): el segundo espera
  -- aquí al primero y después encuentra su fila.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 0));

  SELECT result INTO v_prev FROM label_batch_runs WHERE batch_id = p_batch_id;
  IF v_prev IS NOT NULL THEN
    RETURN v_prev || jsonb_build_object('replayed', true);
  END IF;

  v_result := public.apply_intake_lines(
    p_location            => p_location,
    p_items               => p_items,
    p_user_id             => p_user_id,
    p_performed_by        => p_performed_by,
    p_warehouse           => p_warehouse,
    p_order_number        => NULL,
    p_stamp_received_year => false
  ) || jsonb_build_object('batch_id', p_batch_id);

  INSERT INTO label_batch_runs (
    batch_id, location, warehouse, skus, units, new_skus,
    photos, cards_camera, cards_hand, amber_resolved, red_typed, units_hand_set,
    seconds, app_version, device, result, created_by
  ) VALUES (
    p_batch_id,
    v_result->>'location',
    p_warehouse,
    (v_result->>'skus')::int,
    (v_result->>'units')::int,
    ARRAY(SELECT jsonb_array_elements_text(v_result->'new_skus')),
    nullif(p_stats->>'photos', '')::int,
    nullif(p_stats->>'cards_camera', '')::int,
    nullif(p_stats->>'cards_hand', '')::int,
    nullif(p_stats->>'amber_resolved', '')::int,
    nullif(p_stats->>'red_typed', '')::int,
    nullif(p_stats->>'units_hand_set', '')::int,
    nullif(p_stats->>'seconds', '')::numeric,
    nullif(p_stats->>'app_version', ''),
    nullif(p_stats->>'device', ''),
    v_result,
    coalesce(auth.uid(), p_user_id)
  );

  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

COMMENT ON FUNCTION public.register_label_batch(uuid, text, jsonb, uuid, text, text, jsonb) IS
  'Registra un lote de cajas fotografiadas en una ubicación (idea-224). Idempotente '
  'por batch_id; escribe con apply_intake_lines y deja su fila en label_batch_runs.';

REVOKE ALL ON FUNCTION public.register_label_batch(uuid, text, jsonb, uuid, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_label_batch(uuid, text, jsonb, uuid, text, text, jsonb)
  TO authenticated, service_role;
