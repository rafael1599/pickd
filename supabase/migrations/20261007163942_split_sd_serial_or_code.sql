-- ============================================================================
-- Mark as S/D separates one unit with its serial as SKU, and never -SD1 again
-- (idea-257 P2, Rafael 7 Oct 2026; docs/prds/sd-units-reuse.md §4 C).
--
-- split_unit, kind 'sd': SKU = the number given › the serial › SD<code>, the
-- last one numbered right there (sd_number_seq, the # on its box). If that SKU
-- is a sold S/D, it is archived first (archive_sd_unit) and its clean row
-- takes this bike. PH (kind 'photo') is unchanged: <model>-PH<n>.
-- Base: 20261007144844.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.split_unit(p_sku text, p_warehouse text, p_location text, p_qty integer, p_kind text, p_performed_by text, p_user_id uuid DEFAULT NULL::uuid, p_new_sku text DEFAULT NULL::text, p_serial text DEFAULT NULL::text, p_user_role text DEFAULT 'staff'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_meta public.sku_metadata%ROWTYPE;
  v_src public.inventory%ROWTYPE;
  v_serial text := nullif(upper(btrim(p_serial)), '');
  v_new text;
  v_n integer := 1;
  v_suffix text;
  v_new_id bigint;
  v_loc_id uuid;
  v_sdn integer;
  v_reuse boolean := false;
BEGIN
  IF p_kind NOT IN ('sd', 'photo') THEN
    RAISE EXCEPTION 'split_unit: kind must be sd or photo (got %)', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'split_unit: qty must be > 0 (got %)', COALESCE(p_qty::text, 'NULL') USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_meta FROM public.sku_metadata WHERE sku = p_sku;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'split_unit: % is not in the catalog', p_sku USING ERRCODE = 'P0002';
  END IF;
  IF v_meta.unit_kind <> 'new' THEN
    RAISE EXCEPTION 'split_unit: % is already a % unit; change its kind instead', p_sku, v_meta.unit_kind
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_src FROM public.inventory
   WHERE sku = p_sku AND warehouse = p_warehouse
     AND upper(btrim(COALESCE(location, ''))) = upper(btrim(COALESCE(p_location, '')))
     AND is_active
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'split_unit: no stock of % at % / %', p_sku, p_warehouse, p_location USING ERRCODE = 'P0002';
  END IF;
  IF p_qty > v_src.quantity THEN
    RAISE EXCEPTION 'split_unit: % / % has % of %, cannot split %', p_warehouse, v_src.location, v_src.quantity, p_sku, p_qty
      USING ERRCODE = '22023';
  END IF;

  v_new := public.canonical_sku(COALESCE(nullif(upper(btrim(p_new_sku)), ''), v_serial));
  -- An S/D without a serial is SD<code>, numbered right here (idea-257 P2,
  -- 7 Oct 2026): never <model>-SD1 again. The # is the one on its box.
  IF v_new IS NULL AND p_kind = 'sd' THEN
    v_sdn := nextval('public.sd_number_seq');
    v_new := 'SD' || public.sd_code(v_sdn);
  END IF;
  IF v_new IS NULL THEN
    v_suffix := CASE p_kind WHEN 'photo' THEN '-PH' ELSE '-SD' END;
    LOOP
      v_new := p_sku || v_suffix || v_n;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = v_new)
            AND NOT EXISTS (SELECT 1 FROM public.inventory WHERE sku = v_new);
      v_n := v_n + 1;
    END LOOP;
  END IF;

  -- Un número reusado (Jayme reusa los de bicis vendidas) no se fusiona aquí:
  -- la ficha vieja ganaría. Ver docs/photo-bikes.md, decisiones del 5 oct.
  -- The SKU of a sold S/D is taken over (idea-257): that bike goes to its
  -- history first and its clean row receives this one.
  IF p_kind = 'sd' AND v_new <> p_sku AND public.sd_sold_unit(v_new) IS NOT NULL THEN
    PERFORM public.archive_sd_unit(v_new, NULL, p_performed_by);
    v_reuse := true;
  END IF;

  IF v_new = p_sku
     OR (NOT v_reuse AND EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = v_new))
     OR EXISTS (SELECT 1 FROM public.inventory WHERE sku = v_new AND quantity > 0) THEN
    RAISE EXCEPTION 'split_unit: SKU % already exists; choose another', v_new USING ERRCODE = '23505';
  END IF;

  IF v_reuse THEN
    DELETE FROM public.sku_metadata m
     WHERE m.sku = v_new
       AND NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.sku = m.sku);
  END IF;
  IF v_reuse AND EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = v_new) THEN
    PERFORM set_config('pickd.demote_dimensions', 'true', true);
    PERFORM set_config('pickd.weight_source', 'reset', true);
    UPDATE public.sku_metadata SET
      unit_kind = p_kind, base_sku = p_sku, serial_number = v_serial, is_bike = v_meta.is_bike,
      model = v_meta.model, size = v_meta.size, color = v_meta.color, category = v_meta.category,
      length_in = v_meta.length_in, width_in = v_meta.width_in, height_in = v_meta.height_in,
      length_ft = v_meta.length_ft, weight_lbs = v_meta.weight_lbs,
      dimensions_verified = v_meta.dimensions_verified,
      dimensions_measured_at = v_meta.dimensions_measured_at,
      weight_verified = v_meta.weight_verified, received_year = v_meta.received_year,
      as400_description = v_meta.as400_description
    WHERE sku = v_new;
    PERFORM set_config('pickd.demote_dimensions', '', true);
    PERFORM set_config('pickd.weight_source', '', true);
  ELSE
  INSERT INTO public.sku_metadata (
    sku, unit_kind, base_sku, serial_number, is_bike, model, size, color, category,
    length_in, width_in, height_in, length_ft, weight_lbs,
    dimensions_verified, dimensions_measured_at, weight_verified, received_year,
    as400_description
  ) VALUES (
    v_new, p_kind, p_sku, v_serial, v_meta.is_bike, v_meta.model, v_meta.size, v_meta.color, v_meta.category,
    v_meta.length_in, v_meta.width_in, v_meta.height_in, v_meta.length_ft, v_meta.weight_lbs,
    v_meta.dimensions_verified, v_meta.dimensions_measured_at, v_meta.weight_verified, v_meta.received_year,
    -- The model's AS400 name: the unit is that bike, and the new SKU will
    -- never be in AS400 to be read (7 Oct 2026, 03-3769BL-SD1).
    v_meta.as400_description
  );
  END IF;
  IF v_sdn IS NOT NULL THEN
    UPDATE public.sku_metadata SET sd_number = v_sdn WHERE sku = v_new;
  END IF;

  PERFORM public.adjust_inventory_quantity(
    p_sku, p_warehouse, v_src.location, -p_qty,
    p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE
  );
  PERFORM public.adjust_inventory_quantity(
    v_new, p_warehouse, v_src.location, p_qty,
    p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE
  );

  -- La fila nueva hereda el nombre (el trigger le pone la marca), la
  -- sublocation y, si se lleva la fila entera, su nota.
  UPDATE public.inventory
     SET item_name = v_src.item_name,
         sublocation = v_src.sublocation,
         internal_note = CASE WHEN p_qty = v_src.quantity THEN v_src.internal_note ELSE internal_note END
   WHERE sku = v_new AND warehouse = p_warehouse
     AND upper(btrim(COALESCE(location, ''))) = upper(btrim(COALESCE(v_src.location, '')))
  RETURNING id, location_id INTO v_new_id, v_loc_id;

  PERFORM public.upsert_inventory_log(
    v_new, p_warehouse, v_src.location, p_warehouse, v_src.location,
    0, p_qty, p_qty, 'EDIT',
    v_new_id, v_loc_id, v_loc_id,
    p_performed_by, p_user_id, NULL, NULL, row_to_json(v_src)::jsonb, false, NULL, p_sku
  );

  RETURN jsonb_build_object(
    'success', true, 'sku', v_new, 'base_sku', p_sku, 'unit_kind', p_kind,
    'moved_qty', p_qty, 'id', v_new_id, 'sd_number', v_sdn, 'archived_sold_sd', v_reuse
  );
END;
$function$;
