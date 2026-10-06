-- ============================================================================
-- FedEx Returns se borra (idea-250, fase 3). Rafael, 5 oct 2026: «no creo que
-- sea necesario dejar las tablas como historial, solo pasar la data a las
-- tablas de item», y «adelante con la fase 3».
--
-- Todo lo que servía ya vive en la ficha (fase 1, 20261006015755): las 62
-- devoluciones son unidades `return` con su RMA, misship, modelo identificado
-- y foto de la etiqueta; el alta es `register_return` (fase 2). La última
-- escritura en estas tablas fue el 5 oct a las 17:20 UTC, antes de la fase 1:
-- no hay nada sin copiar (lo comprueba el ASSERT de abajo).
--
-- Se van: las dos tablas (con sus políticas, su sitio en supabase_realtime y
-- sus triggers), el puente de la fase 1, el flujo viejo (procesar, desechar,
-- tipo del placeholder) y las columnas fedex_return_id / fedex_return_status de
-- la búsqueda. Dos lectores las nombraban y se rehacen sin ellas:
-- `rename_sku_everywhere` (ya no hay ítems que renombrar; de paso lleva las
-- fotos de `sku_photos` al SKU nuevo, que era un pendiente de la ficha) y
-- `v_sku_metadata_orphans` (la historia de una devolución está en
-- inventory_logs, como la de cualquier SKU).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fedex_returns r
     WHERE NOT EXISTS (SELECT 1 FROM public.sku_metadata m WHERE m.sku = r.tracking_number)
  ), 'a FedEx return has no unit in sku_metadata';
END $$;

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
  r         record;
BEGIN
  IF p_old IS NULL OR p_new IS NULL OR p_old = p_new THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = p_old) THEN
    RAISE EXCEPTION 'rename_sku_everywhere: % is not a catalog row', p_old;
  END IF;
  v_merged := EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = p_new);

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

  INSERT INTO public.sku_canonical_renames
    (old_sku, new_sku, merged, inventory_rows, inventory_qty, logs, snapshots, picking_lists, note)
  VALUES (p_old, p_new, v_merged, v_inv, v_inv_qty, v_logs, v_snaps, v_items, p_note);

  RETURN jsonb_build_object('old', p_old, 'new', p_new, 'merged', v_merged,
                            'inventory_rows', v_inv, 'inventory_qty', v_inv_qty,
                            'logs', v_logs, 'snapshots', v_snaps, 'picking_lists', v_items);
END;
$function$;

CREATE OR REPLACE VIEW public.v_sku_metadata_orphans AS
 SELECT sku,
    created_at,
    is_bike,
    image_url IS NOT NULL AS has_image,
    (EXISTS ( SELECT 1
           FROM inventory_logs l
          WHERE l.sku = m.sku OR l.previous_sku = m.sku)) OR (EXISTS ( SELECT 1
           FROM daily_inventory_snapshots s
          WHERE s.sku = m.sku)) OR (EXISTS ( SELECT 1
           FROM asset_tags a
          WHERE a.sku = m.sku)) OR (EXISTS ( SELECT 1
           FROM cycle_count_items c
          WHERE c.sku = m.sku)) OR (EXISTS ( SELECT 1
           FROM warehouse_excluded_skus w
          WHERE w.sku = m.sku)) AS has_history,
    (EXISTS ( SELECT 1
           FROM picking_lists p
          WHERE (p.status <> ALL (ARRAY['completed'::text, 'cancelled'::text])) AND p.items @> jsonb_build_array(jsonb_build_object('sku', m.sku)))) AS in_open_order
   FROM sku_metadata m
  WHERE NOT (EXISTS ( SELECT 1
           FROM inventory i
          WHERE i.sku = m.sku));

DROP FUNCTION IF EXISTS public.process_fedex_return_item(uuid, text, text, text, text, text, uuid, text, integer);
DROP FUNCTION IF EXISTS public.dispose_fedex_return(uuid, uuid, text, text);
DROP TRIGGER IF EXISTS tr_fedex_returns_sync_unit ON public.fedex_returns;
DROP TRIGGER IF EXISTS tr_fedex_return_items_sync_unit ON public.fedex_return_items;
DROP TRIGGER IF EXISTS tr_fedex_returns_sync_placeholder_type ON public.fedex_returns;
DROP FUNCTION IF EXISTS public.tr_sync_return_unit();
DROP FUNCTION IF EXISTS public.sync_return_unit(uuid);
DROP FUNCTION IF EXISTS public.sync_fedex_return_placeholder_type();

DROP TABLE public.fedex_return_items;
DROP TABLE public.fedex_returns;

-- Otras columnas: RETURNS TABLE cambia, así que DROP + CREATE y los permisos
-- de siempre.
DROP FUNCTION public.search_inventory_with_metadata(text, text, boolean, boolean, boolean, boolean, integer, integer, text, boolean);

CREATE FUNCTION public.search_inventory_with_metadata(p_search text DEFAULT ''::text, p_warehouse text DEFAULT NULL::text, p_include_inactive boolean DEFAULT false, p_show_parts boolean DEFAULT false, p_only_scratch_dent boolean DEFAULT false, p_only_fedex_returns boolean DEFAULT false, p_offset integer DEFAULT 0, p_limit integer DEFAULT 30, p_field text DEFAULT 'all'::text, p_only_photo boolean DEFAULT false)
 RETURNS TABLE(id bigint, sku text, quantity integer, location text, location_id uuid, sublocation text[], item_name text, warehouse text, is_active boolean, internal_note text, distribution jsonb, created_at timestamp with time zone, location_sort_key integer, image_url text, length_in numeric, width_in numeric, height_in numeric, weight_lbs numeric, is_bike boolean, is_scratch_dent boolean, serial_number text, upc text, model text, condition_description text, pdf_link text, sd_price numeric, condition text, fedex_tracking_number text, size text, category text, unit_kind text, base_sku text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT
      TRIM(p_search)                                     AS raw_search,
      regexp_replace(TRIM(p_search), '[-\s]', '', 'g')   AS normalized_search,
      -- idea-154: the canonical spelling of the whole term, so '01-530' finds 01-0530.
      regexp_replace(public.canonical_sku(TRIM(p_search)), '[-\s]', '', 'g') AS canonical_key,
      regexp_replace(TRIM(p_search), '\s', '', 'g')     AS spaceless_search,
      COALESCE(NULLIF(p_field, ''), 'all')               AS field
  ),
  filtered AS (
    SELECT
      i.id, i.sku, i.quantity, i.location, i.location_id, i.sublocation,
      i.item_name, i.warehouse, i.is_active, i.internal_note, i.distribution,
      i.created_at, i.location_sort_key,
      m.image_url, m.length_in, m.width_in, m.height_in, m.weight_lbs,
      m.is_bike, m.is_scratch_dent, m.serial_number,
      m.upc, m.model, m.condition_description,
      m.pdf_link, m.sd_price, m.condition,
      -- A return's SKU is its tracking (idea-250).
      CASE WHEN m.unit_kind = 'return' THEN i.sku END AS fedex_tracking_number,
      m.size, m.category, m.unit_kind, m.base_sku
    FROM public.inventory i
    JOIN public.sku_metadata m ON m.sku = i.sku
    CROSS JOIN normalized n
    WHERE (p_warehouse IS NULL OR i.warehouse = p_warehouse)
      AND (p_include_inactive OR (i.is_active = TRUE AND i.quantity > 0))
      AND (NOT p_only_scratch_dent OR m.is_scratch_dent = TRUE)
      AND (NOT p_only_photo OR m.unit_kind = 'photo')
      -- Bike/parts toggle: applies normally, but bypassed for FedEx-return
      -- rows (their seriales rarely match the bike-pattern trigger, so the
      -- toggle would hide them), for scratch-and-dent / only-fedex modes, and
      -- when p_show_parts IS NULL (search mode: bikes and parts together).
      AND (
        p_only_fedex_returns
        OR p_only_scratch_dent
        OR p_only_photo
        OR m.unit_kind = 'return'
        OR p_show_parts IS NULL
        OR m.is_bike = (NOT p_show_parts)
      )
      AND (NOT p_only_fedex_returns OR m.unit_kind = 'return')
      AND (
        n.raw_search = ''
        OR (n.field IN ('all', 'name') AND (
          i.item_name ILIKE '%' || n.raw_search || '%'
          OR m.model ILIKE '%' || n.raw_search || '%'
          OR m.condition_description ILIKE '%' || n.raw_search || '%'
        ))
        OR (n.field = 'all' AND i.location ILIKE '%' || n.raw_search || '%')
        OR (
          n.field = 'location'
          AND n.spaceless_search <> ''
          AND regexp_replace(i.location, '\s', '', 'g') ILIKE '%' || n.spaceless_search || '%'
        )
        OR (n.field IN ('all', 'sku') AND (
          (
            n.normalized_search <> ''
            AND regexp_replace(i.sku, '[-\s]', '', 'g')
                ILIKE '%' || n.normalized_search || '%'
          )
          -- Substring above keeps '03-37' finding every 03-37xx; this equality
          -- only adds the zero-padded form of a complete term (idea-154).
          OR (
            n.canonical_key <> ''
            AND regexp_replace(i.sku, '[-\s]', '', 'g') = n.canonical_key
          )
        ))
        OR (n.field IN ('all', 'serial') AND n.normalized_search <> '' AND (
          (
            m.serial_number IS NOT NULL
            AND regexp_replace(m.serial_number, '[-\s]', '', 'g')
                ILIKE '%' || n.normalized_search || '%'
          )
          OR (
            m.upc IS NOT NULL
            AND regexp_replace(m.upc, '[-\s]', '', 'g')
                ILIKE '%' || n.normalized_search || '%'
          )
        ))
      )
  )
  SELECT
    f.id, f.sku, f.quantity, f.location, f.location_id, f.sublocation,
    f.item_name, f.warehouse, f.is_active, f.internal_note, f.distribution,
    f.created_at, f.location_sort_key,
    f.image_url, f.length_in, f.width_in, f.height_in, f.weight_lbs,
    f.is_bike, f.is_scratch_dent, f.serial_number,
    f.upc, f.model, f.condition_description,
    f.pdf_link, f.sd_price, f.condition,
    f.fedex_tracking_number,
    f.size, f.category, f.unit_kind, f.base_sku,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    f.location_sort_key ASC,
    (f.is_active AND f.quantity > 0) DESC,
    f.sku ASC
  OFFSET p_offset
  LIMIT p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.search_inventory_with_metadata(text, text, boolean, boolean, boolean, boolean, integer, integer, text, boolean)
  TO anon, authenticated, service_role;

COMMIT;
