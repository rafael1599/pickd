-- El alta de un contenedor dejaba el nombre de la bici como nota de la fila.
--
-- `register_container` llama a `adjust_inventory_quantity` pasándole
-- `coalesce(r.item_name, r.canonical_sku)` en el décimo hueco. Ese hueco era
-- `p_merge_note`, y cuando se escribió esta llamada servía para rellenar el
-- `item_name` de la fila. El 26 de agosto (`20260826233000`, bug-018) ese
-- parámetro se mudó: ahora va **sólo** a `internal_note`. La llamada nunca se
-- actualizó, así que desde entonces cada línea de cada contenedor nace con una
-- nota que repite su propio nombre. El 16 sep se limpiaron 445 filas así y en
-- las tres horas siguientes volvieron 10, todas de contenedores registrados esa
-- tarde. El nombre lo hereda del catálogo, que es de donde debe salir.
--
-- Sólo cambia esa llamada; el resto de la función es la que ya estaba viva.

CREATE OR REPLACE FUNCTION public.register_container(p_location text, p_items jsonb, p_user_id uuid, p_performed_by text, p_warehouse text DEFAULT 'LUDLOW'::text, p_order_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_location text := upper(trim(p_location));
  v_year     smallint := extract(year FROM now() AT TIME ZONE 'America/New_York')::smallint;
  v_dup      text[];
  v_skus int := 0;
  v_units int := 0;
  v_new text[] := '{}';
  r record;
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

  FOR r IN
    SELECT * FROM public.resolve_container_skus(p_items, p_warehouse)
  LOOP
    IF r.is_new THEN
      PERFORM public.register_new_sku(
        p_sku       => r.canonical_sku,
        p_item_name => coalesce(r.item_name, r.canonical_sku),
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

    -- The year it came in is a fact of this intake, not of the sheet: it is
    -- always written, new SKU or old (20260910181656).
    UPDATE sku_metadata SET received_year = v_year WHERE sku = r.canonical_sku;

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
