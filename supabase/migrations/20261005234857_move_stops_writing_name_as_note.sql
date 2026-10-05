-- ============================================================================
-- Un movimiento ya no escribe el nombre de la bici como nota (5 oct 2026)
--
-- Rafael: «se están llenando muchas notas basura». move_inventory_stock le
-- pasaba `item_name` del origen a adjust_inventory_quantity como p_merge_note,
-- y esa función lo guarda en `internal_note` al CREAR la fila de destino
-- (`COALESCE(p_internal_note, NULLIF(TRIM(p_merge_note), ''))`). Toda mudanza a
-- una ubicación donde el SKU no tenía fila dejaba su nombre como nota: 289
-- filas al 5 oct, 196 activas, 53 en PHOTO. Ninguno de los otros llamadores de
-- adjust_inventory_quantity pasa el nombre.
--
-- El argumento sobraba: adjust_inventory_quantity ya nombra la fila nueva a
-- partir de las otras filas de su SKU (bug-018). La nota de verdad del origen
-- sigue viajando por p_internal_note → COALESCE(p_internal_note,
-- v_src_internal_note), como antes.
--
-- 1. move_inventory_stock: idéntica a 20260520240000 salvo ese argumento (NULL).
-- 2. Limpieza: se vacía `internal_note` cuando es, salvo espacios y mayúsculas,
--    un nombre que tuvo la bici — de su SKU o de su base_sku: el item_name de
--    alguna fila, el de un snapshot del historial, o el `model` del catálogo.
--    Cada nota borrada queda en `inventory_note_cleanup` para poder devolverla.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.move_inventory_stock(
  p_sku text,
  p_from_warehouse text,
  p_from_location text,
  p_to_warehouse text,
  p_to_location text,
  p_qty integer,
  p_performed_by text,
  p_user_id uuid DEFAULT NULL::uuid,
  p_user_role text DEFAULT 'staff'::text,
  p_internal_note text DEFAULT NULL::text,
  p_sublocation text[] DEFAULT NULL::text[],
  p_move_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_src_id BIGINT;
  v_src_prev_qty INTEGER;
  v_src_new_qty INTEGER;
  v_src_note TEXT;
  v_src_internal_note TEXT;
  v_from_loc_id UUID;
  v_from_loc_name TEXT;
  v_to_loc_id UUID;
  v_snapshot JSONB;
  v_resolved_note TEXT;
  v_resolved_sublocation TEXT[];
  v_from_norm TEXT;
  v_to_norm TEXT;
BEGIN
  -- Normalize early so the validation comparison agrees with downstream
  -- processing (which uppercases + trims).
  v_from_norm := NULLIF(TRIM(UPPER(p_from_location)), '');
  v_to_norm   := NULLIF(TRIM(UPPER(p_to_location)), '');
  p_from_location := v_from_norm;
  p_to_location   := v_to_norm;

  -- Guard: positive qty required.
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'move_inventory_stock: qty must be > 0 (got %)', COALESCE(p_qty::text,'NULL')
      USING ERRCODE = '22023',
            HINT = 'Pass a strictly positive integer for p_qty.';
  END IF;

  -- Guard: same source and target = no-op, refuse so the caller fixes its UI.
  -- Sublocation edits should go through the inventory update path, not move.
  IF p_from_warehouse = p_to_warehouse
     AND COALESCE(v_from_norm, '') = COALESCE(v_to_norm, '') THEN
    RAISE EXCEPTION 'move_inventory_stock: source and target are the same (%, %)',
      p_from_warehouse, COALESCE(v_from_norm, '<NULL>')
      USING ERRCODE = '22023',
            HINT = 'Pick a different destination row. Use the inventory edit flow to change sublocation in place.';
  END IF;

  IF p_to_location IS NOT NULL AND p_to_location ILIKE 'ROW%' THEN
    v_resolved_sublocation := p_sublocation;
  ELSE
    v_resolved_sublocation := NULL;
  END IF;

  SELECT id, quantity, item_name, internal_note
  INTO v_src_id, v_src_prev_qty, v_src_note, v_src_internal_note
  FROM public.inventory
  WHERE sku = p_sku AND warehouse = p_from_warehouse
    AND ((p_from_location IS NULL AND (location IS NULL OR location = '')) OR (location = p_from_location))
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Source item not found or inactive'; END IF;

  v_from_loc_id := public.resolve_location(p_from_warehouse, p_from_location);
  SELECT location INTO v_from_loc_name FROM public.locations WHERE id = v_from_loc_id;
  v_to_loc_id := public.resolve_location(p_to_warehouse, p_to_location);

  SELECT row_to_json(inv.*)::jsonb INTO v_snapshot
  FROM public.inventory inv
  WHERE inv.id = v_src_id;

  v_resolved_note := COALESCE(p_internal_note, v_src_internal_note);

  PERFORM public.adjust_inventory_quantity(
    p_sku, p_from_warehouse, p_from_location, -p_qty,
    p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE
  );
  v_src_new_qty := v_src_prev_qty - p_qty;

  PERFORM public.adjust_inventory_quantity(
    p_sku, p_to_warehouse, p_to_location, p_qty,
    -- p_merge_note = NULL: el nombre del origen no es una nota (20261005234857).
    p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE, v_resolved_note
  );

  UPDATE inventory
  SET sublocation = v_resolved_sublocation
  WHERE sku = p_sku
    AND warehouse = p_to_warehouse
    AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(COALESCE(p_to_location, '')))
    AND is_active = true;

  PERFORM public.upsert_inventory_log(
    p_sku::TEXT, p_from_warehouse::TEXT, v_from_loc_name::TEXT,
    p_to_warehouse::TEXT, p_to_location::TEXT,
    (-p_qty)::INTEGER, v_src_prev_qty::INTEGER, v_src_new_qty::INTEGER,
    'MOVE'::TEXT,
    v_src_id::BIGINT, v_from_loc_id::UUID, v_to_loc_id::UUID,
    p_performed_by::TEXT, p_user_id::UUID,
    NULL::UUID, NULL::TEXT, v_snapshot::JSONB, false, p_move_note, NULL
  );

  RETURN jsonb_build_object('success', true, 'moved_qty', p_qty, 'id', v_src_id);
END;
$function$;

CREATE TABLE IF NOT EXISTS public.inventory_note_cleanup (
  inventory_id bigint      NOT NULL,
  sku          text        NOT NULL,
  location     text,
  note         text        NOT NULL,
  item_name    text,
  cleaned_at   timestamptz NOT NULL DEFAULT now(),
  reason       text        NOT NULL
);
ALTER TABLE public.inventory_note_cleanup ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.inventory_note_cleanup IS
  'Notas internas vaciadas por ser solo un nombre de la bici (20261005234857). Para devolver una: UPDATE inventory SET internal_note = note WHERE id = inventory_id.';

WITH fam AS (
  SELECT m.sku, COALESCE(m.base_sku, m.sku) AS base FROM public.sku_metadata m
), names AS (
  SELECT DISTINCT f.sku, upper(btrim(regexp_replace(x.nm, '\s+', ' ', 'g'))) AS nm
  FROM fam f
  JOIN LATERAL (
    SELECT i.item_name AS nm FROM public.inventory i WHERE i.sku IN (f.sku, f.base)
    UNION SELECT l.snapshot_before->>'item_name' FROM public.inventory_logs l
           WHERE l.sku IN (f.sku, f.base) AND l.snapshot_before ? 'item_name'
    UNION SELECT m2.model FROM public.sku_metadata m2 WHERE m2.sku IN (f.sku, f.base)
  ) x ON x.nm IS NOT NULL
), garbage AS (
  SELECT i.id, i.sku, i.location, i.internal_note, i.item_name
  FROM public.inventory i
  WHERE nullif(btrim(i.internal_note), '') IS NOT NULL
    AND EXISTS (SELECT 1 FROM names n
                 WHERE n.sku = i.sku
                   AND n.nm = upper(btrim(regexp_replace(i.internal_note, '\s+', ' ', 'g'))))
), saved AS (
  INSERT INTO public.inventory_note_cleanup (inventory_id, sku, location, note, item_name, reason)
  SELECT id, sku, location, internal_note, item_name, 'name copied as note by move_inventory_stock'
  FROM garbage
  RETURNING inventory_id
)
UPDATE public.inventory i SET internal_note = NULL
  FROM saved s WHERE i.id = s.inventory_id;

COMMIT;
