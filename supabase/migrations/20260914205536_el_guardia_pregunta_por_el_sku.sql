-- El guardia de doble carga pregunta por los SKUs, no por la ubicación.
--
-- `register_container` se negaba si la ubicación tenía **cualquier** stock. Eso
-- protege de cargar dos veces el mismo manifiesto, que es lo que debe hacer,
-- pero además impedía lo único que hacía falta para el caso real: que una hoja
-- que GANÓ líneas después de registrarse pueda meter sólo las nuevas.
--
-- Rafael, 14 sep 2026: «cuando agrego cambios en el excel no los detecta el
-- registrador». El `7005N` de la hoja del 28 ago trae once líneas y PickD tiene
-- nueve: `03-4716BK` (1 u) y `03-4718BK` (2 u) se añadieron a la hoja después,
-- y la pantalla mandaba el contenedor entero a la lista de «ya está» sin mirar
-- lo que traía dentro.
--
-- La pregunta correcta es **por SKU**: negarse si alguno de los que vienen ya
-- tiene stock en esa ubicación. Reenviar el manifiesto completo sigue fallando
-- —sus nueve líneas viejas tienen stock— y mandar sólo las dos nuevas entra,
-- porque ninguna de las dos tiene fila ahí. La protección no se afloja, se
-- afina: el error además dice qué SKU la disparó, que antes había que ir a
-- buscar a mano.
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
      p_user_id, 'admin', NULL, p_order_number,
      coalesce(r.item_name, r.canonical_sku)
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
