-- ============================================================================
-- S/D numbers that never come back, and renames that keep them (Rafael, 7 Oct 2026)
--
-- 1. sd_code(n): how the number prints on the box. 1 … 99, then 1A … 9Z, then
--    100 … 999, then 10A … 99Z, and so on: the shortest code that keeps
--    numbers first. Capitals only, without I, L, O (they read as 1 and 0).
--    The column stays an integer (it sorts, it is unique); the code is only
--    how it is shown. Copied from src/utils/sdCode.ts and the sd-sheet edge
--    function; if it changes in one, change the three.
-- 2. rename_sku_everywhere carries the S/D number. It copied the catalog row
--    whole and then deleted the old one, so the unique index on sd_number
--    refused every rename of a numbered S/D (#73: the serial M211005756 is
--    M21I005756 on the box and could not be fixed).
-- 3. split_unit copies the model's as400_description to the new unit.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sd_code(n integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  letters  constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ';
  l        constant int := 23;
  rest     bigint;
  p        int := 1;
  low      bigint;
  lettered bigint;
  digits   bigint;
BEGIN
  IF n IS NULL THEN RETURN NULL; END IF;
  IF n <= 99 THEN RETURN n::text; END IF;
  rest := n - 100;
  LOOP
    low := 10 ^ (p - 1);
    lettered := 9 * low * l;
    IF rest < lettered THEN
      RETURN (low + rest / l)::text || substr(letters, (rest % l)::int + 1, 1);
    END IF;
    rest := rest - lettered;
    digits := 9 * 10 ^ (p + 1);
    IF rest < digits THEN
      RETURN (10 ^ (p + 1) + rest)::bigint::text;
    END IF;
    rest := rest - digits;
    p := p + 1;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rename_sku_everywhere(p_old text, p_new text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_merged  boolean;
  v_cols    text;
  v_vals    text;
  v_inv     int := 0;
  v_inv_qty int := 0;
  v_logs    int := 0;
  v_snaps   int := 0;
  v_items   int := 0;
  v_n       int;
  v_sd      int;
  r         record;
BEGIN
  IF p_old IS NULL OR p_new IS NULL OR p_old = p_new THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = p_old) THEN
    RAISE EXCEPTION 'rename_sku_everywhere: % is not a catalog row', p_old;
  END IF;
  v_merged := EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = p_new);

  -- 0. The S/D number goes with the bike (7 Oct 2026). It is unique, so the
  --    old row lets go of it first and the new name takes it at the end; a
  --    target that already has one keeps its own. Without this every rename of
  --    a numbered S/D died on sku_metadata_sd_number_key (#73, M211005756).
  SELECT sd_number INTO v_sd FROM public.sku_metadata WHERE sku = p_old;
  IF v_sd IS NOT NULL THEN
    PERFORM set_config('pickd.sd_number_repair', 'on', true);
    UPDATE public.sku_metadata SET sd_number = NULL WHERE sku = p_old;
  END IF;

  -- 1. The catalog row under the new name: fill the target's blanks from the
  --    old row (a photo, a model) and take measured dimensions over defaults;
  --    or copy the old row whole. Column list built at run time so a column
  --    added later (or a generated one) never breaks this.
  IF v_merged THEN
    UPDATE public.sku_metadata t
       SET image_url             = COALESCE(t.image_url, o.image_url),
           model                 = COALESCE(t.model, o.model),
           size                  = COALESCE(t.size, o.size),
           color                 = COALESCE(t.color, o.color),
           upc                   = COALESCE(t.upc, o.upc),
           serial_number         = COALESCE(t.serial_number, o.serial_number),
           category              = COALESCE(t.category, o.category),
           condition             = COALESCE(t.condition, o.condition),
           condition_description = COALESCE(t.condition_description, o.condition_description),
           sd_category           = COALESCE(t.sd_category, o.sd_category),
           msrp                  = COALESCE(t.msrp, o.msrp),
           standard_price        = COALESCE(t.standard_price, o.standard_price),
           sd_price              = COALESCE(t.sd_price, o.sd_price),
           pdf_link              = COALESCE(t.pdf_link, o.pdf_link),
           length_in = CASE WHEN NOT COALESCE(t.dimensions_verified, false) AND COALESCE(o.dimensions_verified, false) THEN o.length_in ELSE t.length_in END,
           width_in  = CASE WHEN NOT COALESCE(t.dimensions_verified, false) AND COALESCE(o.dimensions_verified, false) THEN o.width_in  ELSE t.width_in  END,
           height_in = CASE WHEN NOT COALESCE(t.dimensions_verified, false) AND COALESCE(o.dimensions_verified, false) THEN o.height_in ELSE t.height_in END
      FROM public.sku_metadata o
     WHERE t.sku = p_new AND o.sku = p_old;
  ELSE
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
           string_agg(CASE WHEN column_name = 'sku' THEN '$2' ELSE quote_ident(column_name) END, ', ' ORDER BY ordinal_position)
      INTO v_cols, v_vals
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sku_metadata' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO public.sku_metadata (%s) SELECT %s FROM public.sku_metadata WHERE sku = $1', v_cols, v_vals)
      USING p_old, p_new;
  END IF;

  -- 2. Inventory: a row in a bin the new name already occupies is summed
  --    into it (one log line says so); any other row is renamed in place.
  FOR r IN
    SELECT o.id AS old_id, o.quantity AS old_qty, o.warehouse, o.location,
           t.id AS tgt_id, t.quantity AS tgt_qty
      FROM public.inventory o
      LEFT JOIN public.inventory t
        ON t.sku = p_new AND t.warehouse = o.warehouse AND t.location IS NOT DISTINCT FROM o.location
     WHERE o.sku = p_old
  LOOP
    IF r.tgt_id IS NOT NULL THEN
      UPDATE public.inventory
         SET quantity  = quantity + r.old_qty,
             is_active = (quantity + r.old_qty) > 0 OR is_active
       WHERE id = r.tgt_id;
      DELETE FROM public.inventory WHERE id = r.old_id;
      INSERT INTO public.inventory_logs
        (sku, previous_sku, from_warehouse, from_location, to_warehouse, to_location,
         quantity_change, prev_quantity, new_quantity, action_type, performed_by, item_id, note)
      VALUES
        (p_new, p_old, r.warehouse, r.location, r.warehouse, r.location,
         r.old_qty, r.tgt_qty, r.tgt_qty + r.old_qty, 'EDIT', 'system: canonical-sku', r.tgt_id,
         concat_ws(' ', p_note, format('merged %s units of %s into %s at %s', r.old_qty, p_old, p_new, COALESCE(r.location, '-'))));
    ELSE
      UPDATE public.inventory SET sku = p_new WHERE id = r.old_id;
      INSERT INTO public.inventory_logs
        (sku, previous_sku, from_warehouse, from_location, to_warehouse, to_location,
         quantity_change, prev_quantity, new_quantity, action_type, performed_by, item_id, note)
      VALUES
        (p_new, p_old, r.warehouse, r.location, r.warehouse, r.location,
         0, r.old_qty, r.old_qty, 'EDIT', 'system: canonical-sku', r.old_id,
         concat_ws(' ', p_note, format('renamed %s to %s', p_old, p_new)));
    END IF;
    v_inv := v_inv + 1;
    v_inv_qty := v_inv_qty + COALESCE(r.old_qty, 0);
  END LOOP;

  -- 3. History and side tables: denormalized text, no FK — rewrite in place.
  UPDATE public.inventory_logs SET sku = p_new WHERE sku = p_old;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_logs := v_logs + v_n;
  UPDATE public.inventory_logs SET previous_sku = p_new WHERE previous_sku = p_old;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_logs := v_logs + v_n;

  -- Snapshots are unique per (date, warehouse, location, sku): a day where
  -- both names were counted in the same bin becomes one row with the sum.
  UPDATE public.daily_inventory_snapshots t
     SET quantity = t.quantity + o.quantity
    FROM public.daily_inventory_snapshots o
   WHERE o.sku = p_old AND t.sku = p_new
     AND t.snapshot_date = o.snapshot_date AND t.warehouse = o.warehouse
     AND t.location IS NOT DISTINCT FROM o.location;
  DELETE FROM public.daily_inventory_snapshots o
   USING public.daily_inventory_snapshots t
   WHERE o.sku = p_old AND t.sku = p_new
     AND t.snapshot_date = o.snapshot_date AND t.warehouse = o.warehouse
     AND t.location IS NOT DISTINCT FROM o.location;
  UPDATE public.daily_inventory_snapshots SET sku = p_new WHERE sku = p_old;
  GET DIAGNOSTICS v_snaps = ROW_COUNT;

  UPDATE public.asset_tags SET sku = p_new WHERE sku = p_old;
  -- The photos after the cover go with the SKU (sku_photos, 20261006011325).
  UPDATE public.sku_photos SET sku = p_new WHERE sku = p_old;

  DELETE FROM public.cycle_count_items o
   USING public.cycle_count_items t
   WHERE o.sku = p_old AND t.sku = p_new AND t.session_id = o.session_id
     AND COALESCE(t.location, '__NO_LOCATION__') = COALESCE(o.location, '__NO_LOCATION__');
  UPDATE public.cycle_count_items SET sku = p_new WHERE sku = p_old;

  IF EXISTS (SELECT 1 FROM public.warehouse_excluded_skus WHERE sku = p_new) THEN
    DELETE FROM public.warehouse_excluded_skus WHERE sku = p_old;
  ELSE
    UPDATE public.warehouse_excluded_skus SET sku = p_new WHERE sku = p_old;
  END IF;

  -- 4. Order lines, every status: what AS400 printed, in the one spelling.
  --    Array order is kept (compensate_picking_list_changes diffs by index).
  UPDATE public.picking_lists p
     SET items = (
       SELECT jsonb_agg(
                CASE WHEN i->>'sku' = p_old THEN jsonb_set(i, '{sku}', to_jsonb(p_new)) ELSE i END
                ORDER BY ord)
         FROM jsonb_array_elements(p.items) WITH ORDINALITY AS t(i, ord))
   WHERE jsonb_typeof(p.items) = 'array'
     AND p.items @> jsonb_build_array(jsonb_build_object('sku', p_old));
  GET DIAGNOSTICS v_items = ROW_COUNT;

  -- 5. The old catalog row goes last: nothing references it any more.
  DELETE FROM public.sku_metadata WHERE sku = p_old;

  IF v_sd IS NOT NULL THEN
    UPDATE public.sku_metadata SET sd_number = v_sd WHERE sku = p_new AND sd_number IS NULL;
  END IF;

  INSERT INTO public.sku_canonical_renames
    (old_sku, new_sku, merged, inventory_rows, inventory_qty, logs, snapshots, picking_lists, note)
  VALUES (p_old, p_new, v_merged, v_inv, v_inv_qty, v_logs, v_snaps, v_items, p_note);

  RETURN jsonb_build_object('old', p_old, 'new', p_new, 'merged', v_merged,
                            'inventory_rows', v_inv, 'inventory_qty', v_inv_qty,
                            'logs', v_logs, 'snapshots', v_snaps, 'picking_lists', v_items);
END;
$function$;

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
  IF v_new = p_sku
     OR EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = v_new)
     OR EXISTS (SELECT 1 FROM public.inventory WHERE sku = v_new) THEN
    RAISE EXCEPTION 'split_unit: SKU % already exists; choose another', v_new USING ERRCODE = '23505';
  END IF;

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
    'moved_qty', p_qty, 'id', v_new_id
  );
END;
$function$;
