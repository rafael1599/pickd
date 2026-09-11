-- FedEx puede llevar cualquier peso.
--
-- Rafael, 11 sep 2026. `classify_picking_list_fedex` mandaba a camión toda
-- orden con un artículo de más de 50 libras — una regla que contestaba a un
-- límite que FedEx no tiene. Desde el 1 de agosto puso en camión **19 órdenes**
-- que podían haber ido por paquetería (de 25 con artículo pesado; las otras 6
-- iban en camión igual por llevar 5 bicis o más). Eso es flete pagado de más,
-- y lo pagaba una suposición.
--
-- Lo que queda es de VOLUMEN, no de peso: cinco bicis son un pallet, y un
-- pallet es un camión por sitio y por manejo. Las partes siguen sin forzar
-- nada — 50 partes pequeñas van por FedEx.
--
-- Los 21 SKUs de más de 50 libras son todos bicis y todos con báscula
-- verificada, así que la regla disparaba de verdad; no era letra muerta.
--
-- El espejo en TypeScript (`utils/shippingClassification.ts`) se quita en el
-- mismo commit, y allí desapareció también el parámetro `skuWeights`: un
-- argumento que ya no decide nada es una mentira que el siguiente lector paga.

CREATE OR REPLACE FUNCTION public.classify_picking_list_fedex(p_items jsonb, p_transport_company text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bike_qty integer;
  v_transport text;
BEGIN
  v_transport := UPPER(TRIM(COALESCE(p_transport_company, '')));
  IF v_transport = 'FEDEX' THEN
    RETURN true;
  END IF;
  IF v_transport != '' AND v_transport != 'FEDEX' THEN
    RETURN false; -- Explicit freight/regular carrier assigned
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN true; -- empty order → fedex by default
  END IF;

  -- Única regla: >= 5 BIKES (canónico sm.is_bike = true). El peso ya no
  -- interviene — ver la cabecera de esta migración.
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer
  INTO v_bike_qty
  FROM jsonb_array_elements(p_items) AS item
  LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE sm.is_bike = true;

  IF v_bike_qty >= 5 THEN RETURN false; END IF;

  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.classify_picking_list_fedex(jsonb, text) IS
  'FedEx salvo que la orden lleve 5 bicis o más (un pallet). El peso NO decide: FedEx lleva cualquier peso (Rafael, 11 sep 2026). Espejo de utils/shippingClassification.ts — mantener los dos en sync.';
