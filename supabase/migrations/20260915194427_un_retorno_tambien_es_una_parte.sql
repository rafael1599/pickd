-- Un retorno de FedEx también puede ser una parte, y se puede decir en cualquier paso.
--
-- Rafael, 15 sep 2026: «en fedex returns aprovecha para desbloquear las partes para que
-- también pueda determinar partes» y «quiero que desde cualquier parte del proceso fedex
-- returns se pueda cambiar de bike a part». Lo había tenido que resolver a mano: el retorno
-- 792490352439 eran 12 horquillas 12-8352KW.
--
-- Tres cosas lo impedían:
-- 1. El tipo no era un dato. El intake lo escribía como texto dentro de `notes`
--    («[TYPE: BIKE]», 12 retornos) y forzaba `is_bike = true` en el placeholder igual,
--    «returns are always bikes». Ahora es `fedex_returns.item_type`, y el placeholder
--    (sku = tracking) sigue a esa columna por trigger, escriba quien escriba.
-- 2. La búsqueda de Return to Stock sólo veía bicis (arreglo en el cliente).
-- 3. `process_fedex_return_item` movía la cantidad del placeholder (1) e ignoraba la que
--    se elegía en pantalla. Ahora acepta `p_quantity`: el placeholder sigue consumiendo su
--    unidad (la caja) y a destino van las unidades que llegaron.

-- ── 1. El tipo, como columna ────────────────────────────────────────────────
ALTER TABLE public.fedex_returns
  ADD COLUMN IF NOT EXISTS item_type text
  CHECK (item_type IN ('bike', 'part'));

COMMENT ON COLUMN public.fedex_returns.item_type IS
  'Bike o part. Decide el is_bike del placeholder (sku = tracking_number) mientras exista. Se puede cambiar en cualquier estado.';

-- Lo que decía la etiqueta del texto pasa a la columna y sale de las notas. Sin etiqueta:
-- bike, que es lo que el placeholder ya era.
UPDATE public.fedex_returns
SET item_type = CASE WHEN notes ~ '\[TYPE: PART/ACCESSORY\]' THEN 'part' ELSE 'bike' END,
    notes = NULLIF(trim(regexp_replace(COALESCE(notes, ''), '\s*\[TYPE: (BIKE|PART/ACCESSORY)\]\s*', ' ', 'g')), '')
WHERE item_type IS NULL;

-- ── 2. El placeholder sigue al tipo ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_fedex_return_placeholder_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.item_type IS NULL THEN
    RETURN NEW;
  END IF;
  -- Sólo el placeholder: la fila de catálogo cuyo SKU es el propio tracking. Una SKU real
  -- ya resuelta tiene su propio is_bike y no la toca un retorno.
  UPDATE public.sku_metadata
  SET is_bike = (NEW.item_type = 'bike')
  WHERE sku = NEW.tracking_number
    AND is_bike IS DISTINCT FROM (NEW.item_type = 'bike');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_fedex_returns_sync_placeholder_type ON public.fedex_returns;
CREATE TRIGGER tr_fedex_returns_sync_placeholder_type
  AFTER INSERT OR UPDATE OF item_type ON public.fedex_returns
  FOR EACH ROW EXECUTE FUNCTION public.sync_fedex_return_placeholder_type();

-- Los placeholders de hoy, alineados con el tipo recién rellenado.
UPDATE public.sku_metadata m
SET is_bike = (r.item_type = 'bike')
FROM public.fedex_returns r
WHERE m.sku = r.tracking_number
  AND m.is_bike IS DISTINCT FROM (r.item_type = 'bike');

-- ── 3. La cantidad que llegó ────────────────────────────────────────────────
-- Cambiar la firma obliga a DROP + CREATE; los permisos se devuelven tal cual.
DROP FUNCTION IF EXISTS public.process_fedex_return_item(uuid, text, text, text, text, text, uuid, text);

CREATE FUNCTION public.process_fedex_return_item(p_item_id uuid, p_real_sku text, p_item_name text, p_target_warehouse text, p_target_location text, p_condition text, p_user_id uuid, p_performed_by text DEFAULT 'FedEx Returns'::text, p_quantity integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item RECORD;
  v_return RECORD;
  v_placeholder_sku text;
  v_tracking text;
  v_real_sku text := UPPER(TRIM(p_real_sku));
  v_target_loc text := UPPER(TRIM(p_target_location));
  v_placeholder_inv RECORD;
  v_placeholder_qty integer;
  v_dest_inv RECORD;
  v_dest_prev integer;
  v_dest_new integer;
  v_from_loc_id uuid;
  v_to_loc_id uuid;
  v_snapshot jsonb;
  v_remaining integer;
  v_note text;
  v_qty integer;
BEGIN
  IF v_real_sku IS NULL OR v_real_sku = '' THEN
    RAISE EXCEPTION 'process_fedex_return_item: p_real_sku required' USING ERRCODE='22023';
  END IF;
  IF v_target_loc IS NULL OR v_target_loc = '' THEN
    RAISE EXCEPTION 'process_fedex_return_item: p_target_location required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.fedex_return_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fedex_return_item % not found', p_item_id USING ERRCODE='22023'; END IF;
  IF v_item.moved_to_location IS NOT NULL THEN
    RAISE EXCEPTION 'item % already moved to %', p_item_id, v_item.moved_to_location USING ERRCODE='22023';
  END IF;

  -- Lo que llegó de verdad: una caja de 12 horquillas son 12, no la unidad del
  -- placeholder. Sin cantidad, la del item (el comportamiento de antes).
  v_qty := COALESCE(p_quantity, v_item.quantity);
  IF v_qty IS NULL OR v_qty < 1 THEN
    RAISE EXCEPTION 'process_fedex_return_item: quantity must be >= 1 (got %)', v_qty USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_return FROM public.fedex_returns WHERE id = v_item.return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fedex_returns % not found', v_item.return_id USING ERRCODE='22023'; END IF;

  v_tracking := v_return.tracking_number;
  v_placeholder_sku := v_item.sku;

  -- Ensure sku_metadata exists for the real SKU (idempotent insert).
  INSERT INTO public.sku_metadata (sku) VALUES (v_real_sku) ON CONFLICT DO NOTHING;

  v_note := 'FedEx Return ' || v_tracking;

  -- Look up the placeholder inventory row (sku=tracking number) at LUDLOW.FDX.
  -- We tolerate any FDX-prefixed location (FDX, FDX 1, FDX 2…) since intake
  -- and historical placement varied.
  SELECT * INTO v_placeholder_inv
  FROM public.inventory
  WHERE sku = v_placeholder_sku
    AND warehouse = 'LUDLOW'
    AND location LIKE 'FDX%'
    AND is_active = TRUE
  ORDER BY quantity DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_placeholder_inv.quantity >= v_item.quantity THEN
    -- Path A: there is a placeholder to consume. Decrement it.
    v_placeholder_qty := v_placeholder_inv.quantity;
    v_from_loc_id := v_placeholder_inv.location_id;

    UPDATE public.inventory
    SET quantity = quantity - v_item.quantity,
        is_active = (quantity - v_item.quantity > 0),
        item_name = CASE WHEN quantity - v_item.quantity = 0 THEN '[deduped] ' || COALESCE(item_name, '') ELSE item_name END
    WHERE id = v_placeholder_inv.id;
  ELSE
    -- Path B: no placeholder (or insufficient qty) — record from-location as
    -- canonical FDX so History still shows a sensible MOVE source.
    v_placeholder_qty := 0;
    v_from_loc_id := public.resolve_location('LUDLOW', 'FDX');
  END IF;

  -- Add to destination (consolidate or create).
  SELECT * INTO v_dest_inv
  FROM public.inventory
  WHERE sku = v_real_sku
    AND warehouse = p_target_warehouse
    AND location = v_target_loc
    AND is_active = TRUE
  FOR UPDATE;

  IF FOUND THEN
    v_dest_prev := v_dest_inv.quantity;
    v_dest_new := v_dest_prev + v_qty;
    UPDATE public.inventory
    SET quantity = v_dest_new,
        is_active = TRUE
    WHERE id = v_dest_inv.id;
  ELSE
    v_to_loc_id := public.resolve_location(p_target_warehouse, v_target_loc);
    INSERT INTO public.inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
    VALUES (v_real_sku, p_target_warehouse, v_target_loc, v_to_loc_id, v_qty, TRUE, p_item_name)
    RETURNING id, quantity INTO v_dest_inv.id, v_dest_new;
    v_dest_prev := 0;
  END IF;

  v_to_loc_id := public.resolve_location(p_target_warehouse, v_target_loc);

  SELECT row_to_json(inv.*)::jsonb INTO v_snapshot
  FROM public.inventory inv WHERE inv.id = v_dest_inv.id;

  -- Single MOVE log: sku=real, previous_sku=tracking (rename evidence),
  -- from=FDX, to=target, note='FedEx Return <tracking>'.
  PERFORM public.upsert_inventory_log(
    v_real_sku::TEXT, 'LUDLOW'::TEXT, 'FDX'::TEXT,
    p_target_warehouse::TEXT, v_target_loc::TEXT,
    v_qty::INTEGER, v_dest_prev::INTEGER, v_dest_new::INTEGER,
    'MOVE'::TEXT,
    v_dest_inv.id::BIGINT, v_from_loc_id::UUID, v_to_loc_id::UUID,
    p_performed_by::TEXT, p_user_id::UUID,
    NULL::UUID, NULL::TEXT, v_snapshot::JSONB, false,
    v_note,
    CASE WHEN v_placeholder_sku <> v_real_sku THEN v_placeholder_sku ELSE NULL END
  );

  -- Update the fedex_return_items row (rename in place — preserve created_at).
  UPDATE public.fedex_return_items
  SET sku = v_real_sku,
      item_name = p_item_name,
      quantity = v_qty,
      condition = COALESCE(p_condition, condition, 'good'),
      target_warehouse = p_target_warehouse,
      target_location = v_target_loc,
      moved_to_location = v_target_loc,
      moved_to_warehouse = p_target_warehouse,
      moved_at = now()
  WHERE id = p_item_id;

  -- Auto-resolve: if every item in this return now has moved_to_location set,
  -- flip the return to 'resolved'.
  SELECT COUNT(*) INTO v_remaining
  FROM public.fedex_return_items
  WHERE return_id = v_return.id AND moved_to_location IS NULL;

  IF v_remaining = 0 AND v_return.status <> 'resolved' THEN
    UPDATE public.fedex_returns
    SET status = 'resolved',
        resolved_at = now(),
        updated_at = now()
    WHERE id = v_return.id;
  END IF;

  RETURN jsonb_build_object(
    'item_id', p_item_id,
    'sku', v_real_sku,
    'tracking', v_tracking,
    'moved_qty', v_qty,
    'target_location', v_target_loc,
    'return_resolved', (v_remaining = 0)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_fedex_return_item(uuid, text, text, text, text, text, uuid, text, integer)
  TO anon, authenticated, service_role;
