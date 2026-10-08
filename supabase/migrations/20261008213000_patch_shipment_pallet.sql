-- Migration: patch_shipment_pallet y patch_picking_list_pallet
-- Permite actualizar campos de una tarima (pallet_dims) de forma atómica y aditiva
-- sin sobreescribir la entrada entera ni pisar items armados a mano.

CREATE OR REPLACE FUNCTION public.patch_shipment_pallet(
  p_shipment_id uuid,
  p_pallet      integer,
  p_patch       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current      jsonb;
  v_elem         jsonb;
  v_merged_entry jsonb;
  v_result       jsonb := '[]'::jsonb;
  v_found        boolean := false;
  v_items_units  integer;
BEGIN
  IF p_shipment_id IS NULL OR p_pallet IS NULL OR p_patch IS NULL THEN
    RAISE EXCEPTION 'Parámetros inválidos para patch_shipment_pallet';
  END IF;

  -- 1. Bloqueo transaccional de la fila del envío
  SELECT pallet_dims INTO v_current
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment % no encontrado', p_shipment_id;
  END IF;

  IF v_current IS NULL OR jsonb_typeof(v_current) <> 'array' THEN
    v_current := '[]'::jsonb;
  END IF;

  -- 2. Recorrer tarimas existentes y fusionar campos sobre el ordinal objetivo
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_current)
  LOOP
    IF (v_elem->>'pallet')::integer = p_pallet THEN
      -- Fusión superficial: preserva campos existentes no presentes en p_patch
      v_merged_entry := v_elem || p_patch;
      v_merged_entry := jsonb_set(v_merged_entry, '{pallet}', to_jsonb(p_pallet));

      -- Guardia de vigencia: si la tarima tiene items armados a mano, units
      -- se mantiene fiel a la suma de items, evitando que una medida con copia
      -- rancia degrade la cuenta real de unidades de la tarima.
      IF v_merged_entry ? 'items' AND jsonb_typeof(v_merged_entry->'items') = 'array'
         AND jsonb_array_length(v_merged_entry->'items') > 0 THEN
        SELECT COALESCE(SUM((it->>'qty')::integer), 0)
          INTO v_items_units
          FROM jsonb_array_elements(v_merged_entry->'items') it;
        v_merged_entry := jsonb_set(v_merged_entry, '{units}', to_jsonb(v_items_units));
      END IF;

      v_result := v_result || jsonb_build_array(v_merged_entry);
      v_found := true;
    ELSE
      v_result := v_result || jsonb_build_array(v_elem);
    END IF;
  END LOOP;

  -- 3. Si el ordinal no existía, se añade
  IF NOT v_found THEN
    v_merged_entry := jsonb_build_object('pallet', p_pallet, 'units', 0) || p_patch;
    IF v_merged_entry ? 'items' AND jsonb_typeof(v_merged_entry->'items') = 'array'
       AND jsonb_array_length(v_merged_entry->'items') > 0 THEN
      SELECT COALESCE(SUM((it->>'qty')::integer), 0)
        INTO v_items_units
        FROM jsonb_array_elements(v_merged_entry->'items') it;
      v_merged_entry := jsonb_set(v_merged_entry, '{units}', to_jsonb(v_items_units));
    END IF;
    v_result := v_result || jsonb_build_array(v_merged_entry);
  END IF;

  -- 4. Ordenar tarimas por ordinal
  SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'pallet')::integer), '[]'::jsonb)
    INTO v_result
    FROM jsonb_array_elements(v_result) elem;

  -- 5. Actualizar el envío
  UPDATE public.shipments
  SET pallet_dims = v_result,
      updated_at = now()
  WHERE id = p_shipment_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.patch_shipment_pallet(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patch_shipment_pallet(uuid, integer, jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.patch_picking_list_pallet(
  p_picking_list_id uuid,
  p_pallet          integer,
  p_patch           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current      jsonb;
  v_elem         jsonb;
  v_merged_entry jsonb;
  v_result       jsonb := '[]'::jsonb;
  v_found        boolean := false;
  v_items_units  integer;
BEGIN
  IF p_picking_list_id IS NULL OR p_pallet IS NULL OR p_patch IS NULL THEN
    RAISE EXCEPTION 'Parámetros inválidos para patch_picking_list_pallet';
  END IF;

  -- 1. Bloqueo transaccional de la fila de la orden
  SELECT pallet_dims INTO v_current
  FROM public.picking_lists
  WHERE id = p_picking_list_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % no encontrado', p_picking_list_id;
  END IF;

  IF v_current IS NULL OR jsonb_typeof(v_current) <> 'array' THEN
    v_current := '[]'::jsonb;
  END IF;

  -- 2. Recorrer tarimas existentes y fusionar campos sobre el ordinal objetivo
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_current)
  LOOP
    IF (v_elem->>'pallet')::integer = p_pallet THEN
      v_merged_entry := v_elem || p_patch;
      v_merged_entry := jsonb_set(v_merged_entry, '{pallet}', to_jsonb(p_pallet));

      IF v_merged_entry ? 'items' AND jsonb_typeof(v_merged_entry->'items') = 'array'
         AND jsonb_array_length(v_merged_entry->'items') > 0 THEN
        SELECT COALESCE(SUM((it->>'qty')::integer), 0)
          INTO v_items_units
          FROM jsonb_array_elements(v_merged_entry->'items') it;
        v_merged_entry := jsonb_set(v_merged_entry, '{units}', to_jsonb(v_items_units));
      END IF;

      v_result := v_result || jsonb_build_array(v_merged_entry);
      v_found := true;
    ELSE
      v_result := v_result || jsonb_build_array(v_elem);
    END IF;
  END LOOP;

  -- 3. Si el ordinal no existía, se añade
  IF NOT v_found THEN
    v_merged_entry := jsonb_build_object('pallet', p_pallet, 'units', 0) || p_patch;
    IF v_merged_entry ? 'items' AND jsonb_typeof(v_merged_entry->'items') = 'array'
       AND jsonb_array_length(v_merged_entry->'items') > 0 THEN
      SELECT COALESCE(SUM((it->>'qty')::integer), 0)
        INTO v_items_units
        FROM jsonb_array_elements(v_merged_entry->'items') it;
      v_merged_entry := jsonb_set(v_merged_entry, '{units}', to_jsonb(v_items_units));
    END IF;
    v_result := v_result || jsonb_build_array(v_merged_entry);
  END IF;

  -- 4. Ordenar tarimas por ordinal
  SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'pallet')::integer), '[]'::jsonb)
    INTO v_result
    FROM jsonb_array_elements(v_result) elem;

  -- 5. Actualizar la orden
  UPDATE public.picking_lists
  SET pallet_dims = v_result,
      updated_at = now()
  WHERE id = p_picking_list_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.patch_picking_list_pallet(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patch_picking_list_pallet(uuid, integer, jsonb) TO authenticated, service_role;
