-- ============================================================================
-- Reusing the SKU of a sold S/D without losing it (idea-257 P1, Rafael 7 Oct 2026)
--
-- «Los SKU de S/D vendidas sí se reutilizan… mantener el historial y a la vez
-- reutilizar SKUs de bicis ya vendidas». Study: docs/prds/sd-units-reuse.md.
--
-- A live S/D is still its catalog row. When a new bike takes the SKU of a sold
-- one (Register, or a rename onto it), the sold one is ARCHIVED first: one row
-- in sd_units (keyed by its # for people; a frozen copy of its catalog row,
-- cover, how it left) and its logs and extra photos tagged with the unit id,
-- so the live card no longer shows them and a rename never moves them. Then
-- the catalog row is left clean for the new bike, whose first print gives it a
-- new #. Nothing is backfilled: a sold S/D stays in its row until its SKU is
-- reused.
--
-- Logs are tagged, not cut by id or date: inventory_logs.id is a uuid, and the
-- bike renamed onto a reused SKU can have logs older than the sale.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sd_units (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sd_number        integer UNIQUE,
  sku              text NOT NULL,
  serial_number    text,
  item_name        text,
  internal_note    text,
  cover_url        text,
  catalog          jsonb NOT NULL,
  left_at          timestamptz,
  left_action      text,
  left_order       text,
  left_by          text,
  archived_at      timestamptz NOT NULL DEFAULT now(),
  archived_by      text,
  archived_by_user uuid
);
CREATE INDEX IF NOT EXISTS sd_units_sku_idx ON public.sd_units (sku);
CREATE INDEX IF NOT EXISTS sd_units_serial_idx ON public.sd_units (upper(serial_number));
COMMENT ON TABLE public.sd_units IS
  'S/D bikes that left and whose SKU went to another bike (idea-257). Written only by archive_sd_unit; catalog = the sku_metadata row as it was.';

ALTER TABLE public.sd_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sd_units_read ON public.sd_units;
CREATE POLICY sd_units_read ON public.sd_units FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.sd_units TO authenticated;

ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS sd_unit_id bigint;
CREATE INDEX IF NOT EXISTS inventory_logs_sd_unit_idx ON public.inventory_logs (sd_unit_id)
  WHERE sd_unit_id IS NOT NULL;
COMMENT ON COLUMN public.inventory_logs.sd_unit_id IS
  'Set when the S/D this line belongs to was archived (sd_units): the live card skips it, renames leave it.';

ALTER TABLE public.sku_photos ADD COLUMN IF NOT EXISTS sd_unit_id bigint;
COMMENT ON COLUMN public.sku_photos.sd_unit_id IS
  'Set when the S/D the photo shows was archived: it stays with that unit, not with the SKU.';

-- The weight trigger only ever turns weight_verified on. Clearing a reused
-- SKU (and copying a catalog row whole) declares it with weight_source =
-- 'reset', and then the value written is the value kept.
CREATE OR REPLACE FUNCTION public.set_dimensions_verified()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_is_default_box boolean;
  v_new_is_default_box boolean;
  v_is_default_box_swap boolean;
  v_old_is_default_weight boolean;
  v_new_is_default_weight boolean;
  v_is_default_weight_swap boolean;
BEGIN
  IF COALESCE(current_setting('pickd.demote_dimensions', true), '') = 'true' THEN
    NEW.dimensions_verified := COALESCE(NEW.dimensions_verified, false);
    NEW.dimensions_measured_at := NEW.dimensions_measured_at;
  ELSE
    v_old_is_default_box := COALESCE(
      (OLD.length_in = 55 AND OLD.width_in = 8.5 AND OLD.height_in = 30.5)
      OR (OLD.length_in = 0 AND OLD.width_in = 0 AND OLD.height_in = 0)
    , false);
    v_new_is_default_box := COALESCE(
      (NEW.length_in = 55 AND NEW.width_in = 8.5 AND NEW.height_in = 30.5)
      OR (NEW.length_in = 0 AND NEW.width_in = 0 AND NEW.height_in = 0)
    , false);
    v_is_default_box_swap := (v_old_is_default_box AND v_new_is_default_box);

    IF (COALESCE(NEW.dimensions_verified, false) AND NOT COALESCE(OLD.dimensions_verified, false))
       OR (
         (NEW.length_in IS DISTINCT FROM OLD.length_in
          OR NEW.width_in  IS DISTINCT FROM OLD.width_in
          OR NEW.height_in IS DISTINCT FROM OLD.height_in)
         AND NOT v_is_default_box_swap
       )
    THEN
      NEW.dimensions_verified := true;
      NEW.dimensions_measured_at := now();
    ELSE
      NEW.dimensions_verified := COALESCE(OLD.dimensions_verified, false);
      NEW.dimensions_measured_at := OLD.dimensions_measured_at;
    END IF;
  END IF;

  IF COALESCE(current_setting('pickd.weight_source', true), '') = 'reset' THEN
    NEW.weight_verified := COALESCE(NEW.weight_verified, false);
    RETURN NEW;
  END IF;

  v_old_is_default_weight := COALESCE(OLD.weight_lbs IN (45, 1), false);
  v_new_is_default_weight := COALESCE(NEW.weight_lbs IN (45, 1), false);
  v_is_default_weight_swap := (v_old_is_default_weight AND v_new_is_default_weight);

  IF (COALESCE(NEW.weight_verified, false) AND NOT COALESCE(OLD.weight_verified, false))
     OR (
       NEW.weight_lbs IS DISTINCT FROM OLD.weight_lbs
       AND COALESCE(current_setting('pickd.weight_source', true), '') = ''
       AND NOT v_is_default_weight_swap
     )
  THEN
    NEW.weight_verified := true;
  ELSE
    NEW.weight_verified := COALESCE(OLD.weight_verified, false);
  END IF;

  RETURN NEW;
END;
$function$;

-- The sold S/D a SKU still carries, or NULL: what Register shows in amber and
-- what rename_sku_everywhere archives. A SKU qualifies when nothing of it is
-- on a shelf and it holds a bike to archive (a serial, a #, or a unit that
-- left), and it is an S/D — or an 01-, which AS400 only gives to S/D.
CREATE OR REPLACE FUNCTION public.sd_sold_unit(p_sku text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_meta public.sku_metadata%ROWTYPE;
  v_left record;
  v_name text;
BEGIN
  SELECT * INTO v_meta FROM public.sku_metadata WHERE sku = p_sku;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory WHERE sku = p_sku AND quantity > 0) THEN
    RETURN NULL;
  END IF;
  SELECT created_at, action_type, order_number, performed_by INTO v_left
    FROM public.inventory_logs
   WHERE sku = p_sku AND quantity_change < 0 AND sd_unit_id IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF NOT (v_meta.unit_kind = 'sd' OR (p_sku ~ '^01-' AND v_left.created_at IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  IF v_meta.serial_number IS NULL AND v_meta.sd_number IS NULL AND v_left.created_at IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT item_name INTO v_name FROM public.inventory
   WHERE sku = p_sku AND item_name IS NOT NULL
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  RETURN jsonb_build_object(
    'sku', p_sku,
    'sd_number', v_meta.sd_number,
    'serial', v_meta.serial_number,
    'name', COALESCE(v_name, v_meta.as400_description),
    'cover_url', v_meta.image_url,
    'left_at', v_left.created_at,
    'left_action', v_left.action_type,
    'left_order', v_left.order_number
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.sd_sold_unit(text) FROM public;
GRANT EXECUTE ON FUNCTION public.sd_sold_unit(text) TO authenticated, service_role;

-- Archive the sold S/D of a SKU and leave its catalog row clean for the next
-- bike. p_cover_url: where the client copied the cover (upload-photo, mode
-- archive) — the cover's own key, photos/{sku}.webp, is overwritten by the
-- next bike's photo. Without it the current URL is kept (a rename: no new
-- photo is taken there).
CREATE OR REPLACE FUNCTION public.archive_sd_unit(
  p_sku text,
  p_cover_url text DEFAULT NULL,
  p_performed_by text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_meta public.sku_metadata%ROWTYPE;
  v_unit jsonb;
  v_inv record;
  v_id bigint;
BEGIN
  IF auth.uid() IS NULL AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  SELECT * INTO v_meta FROM public.sku_metadata WHERE sku = p_sku FOR UPDATE;
  v_unit := public.sd_sold_unit(p_sku);
  IF v_unit IS NULL THEN
    RAISE EXCEPTION '% has no sold S/D to archive', p_sku USING errcode = '22023';
  END IF;

  SELECT item_name, internal_note INTO v_inv FROM public.inventory
   WHERE sku = p_sku
   ORDER BY (item_name IS NULL), updated_at DESC NULLS LAST LIMIT 1;

  INSERT INTO public.sd_units (
    sd_number, sku, serial_number, item_name, internal_note, cover_url, catalog,
    left_at, left_action, left_order, left_by, archived_by, archived_by_user
  ) VALUES (
    v_meta.sd_number, p_sku, v_meta.serial_number, COALESCE(v_inv.item_name, v_unit->>'name'),
    v_inv.internal_note, COALESCE(p_cover_url, v_meta.image_url), to_jsonb(v_meta),
    (v_unit->>'left_at')::timestamptz, v_unit->>'left_action', v_unit->>'left_order',
    (SELECT performed_by FROM public.inventory_logs
      WHERE sku = p_sku AND quantity_change < 0 AND sd_unit_id IS NULL
      ORDER BY created_at DESC LIMIT 1),
    COALESCE(p_performed_by, 'Warehouse Team'), auth.uid()
  ) RETURNING id INTO v_id;

  UPDATE public.inventory_logs SET sd_unit_id = v_id WHERE sku = p_sku AND sd_unit_id IS NULL;
  UPDATE public.sku_photos SET sd_unit_id = v_id WHERE sku = p_sku AND sd_unit_id IS NULL;

  -- The clean row: the next bike is an S/D too and gets measured, read from
  -- AS400 again (as400_read_at NULL puts it back in the watchdog's queue)
  -- and numbered on its first print.
  PERFORM set_config('pickd.sd_number_repair', 'on', true);
  PERFORM set_config('pickd.demote_dimensions', 'true', true);
  PERFORM set_config('pickd.weight_source', 'reset', true);
  UPDATE public.sku_metadata SET
    serial_number = NULL, condition = NULL, condition_description = NULL,
    category = NULL, sd_category = NULL, msrp = NULL, standard_price = NULL, sd_price = NULL,
    pdf_link = NULL, image_url = NULL, upc = NULL, model = NULL, size = NULL, color = NULL,
    base_sku = NULL, received_year = NULL,
    as400_description = NULL, as400_read_at = NULL, as400_snapshot = NULL,
    sd_number = NULL, sd_for_sale = 'not_yet', unit_kind = 'sd',
    length_in = CASE WHEN is_bike THEN 55 ELSE length_in END,
    width_in = CASE WHEN is_bike THEN 8.5 ELSE width_in END,
    height_in = CASE WHEN is_bike THEN 30.5 ELSE height_in END,
    weight_lbs = CASE WHEN is_bike THEN 45 ELSE weight_lbs END,
    dimensions_verified = false, dimensions_measured_at = NULL, weight_verified = false
  WHERE sku = p_sku;
  PERFORM set_config('pickd.demote_dimensions', '', true);
  PERFORM set_config('pickd.weight_source', '', true);

  UPDATE public.inventory SET item_name = NULL, internal_note = NULL WHERE sku = p_sku;

  INSERT INTO public.inventory_logs
    (sku, quantity_change, action_type, performed_by, user_id, note)
  VALUES
    (p_sku, 0, 'EDIT', COALESCE(p_performed_by, 'Warehouse Team'), auth.uid(),
     format('archived S/D %s %s %s',
            COALESCE('#' || public.sd_code(v_meta.sd_number), '—'),
            COALESCE(v_meta.serial_number, ''),
            COALESCE(v_inv.item_name, '')));

  RETURN jsonb_build_object('id', v_id, 'sd_number', v_meta.sd_number,
                            'serial', v_meta.serial_number, 'item_name', v_inv.item_name);
END;
$function$;
REVOKE ALL ON FUNCTION public.archive_sd_unit(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.archive_sd_unit(text, text, text) TO authenticated, service_role;

-- The live card's history skips the lines of archived units.
CREATE OR REPLACE FUNCTION public.get_inventory_logs_for_sku(p_sku text, p_limit integer DEFAULT 50)
 RETURNS SETOF inventory_logs
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT *
  FROM public.inventory_logs
  WHERE sku = ANY(public.resolve_sku_chain(p_sku))
    AND sd_unit_id IS NULL
  ORDER BY created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 1);
$function$;

-- rename_sku_everywhere: archive a sold S/D on the target, and leave archived
-- lines, photos and orders where they are (base: 20261007144844).
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
  v_reused  boolean := false;
  v_cut     timestamptz;
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

  -- 0b. Onto the SKU of a sold S/D (idea-257): that bike is archived first and
  --     the row it leaves clean takes the renamed bike whole, instead of the
  --     two being mixed. Its logs and photos stay with it.
  IF v_merged AND public.sd_sold_unit(p_new) IS NOT NULL THEN
    PERFORM public.archive_sd_unit(p_new, NULL, 'system: rename');
    v_reused := true;
  END IF;
  -- The renamed SKU may itself carry archived units: their lines stay.
  SELECT max(archived_at) INTO v_cut FROM public.sd_units WHERE sku = p_old;

  -- 1. The catalog row under the new name: fill the target's blanks from the
  --    old row (a photo, a model) and take measured dimensions over defaults;
  --    or copy the old row whole. Column list built at run time so a column
  --    added later (or a generated one) never breaks this.
  IF v_reused THEN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sku_metadata' AND is_generated = 'NEVER'
       AND column_name NOT IN ('sku', 'created_at');
    PERFORM set_config('pickd.demote_dimensions', 'true', true);
    PERFORM set_config('pickd.weight_source', 'reset', true);
    EXECUTE format('UPDATE public.sku_metadata t SET (%s) = (SELECT %s FROM public.sku_metadata o WHERE o.sku = $1) WHERE t.sku = $2', v_cols, v_cols)
      USING p_old, p_new;
    PERFORM set_config('pickd.demote_dimensions', '', true);
    PERFORM set_config('pickd.weight_source', '', true);
  ELSIF v_merged THEN
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
  UPDATE public.inventory_logs SET sku = p_new WHERE sku = p_old AND sd_unit_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_logs := v_logs + v_n;
  UPDATE public.inventory_logs SET previous_sku = p_new WHERE previous_sku = p_old AND sd_unit_id IS NULL;
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
  UPDATE public.sku_photos SET sku = p_new WHERE sku = p_old AND sd_unit_id IS NULL;

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
     AND p.items @> jsonb_build_array(jsonb_build_object('sku', p_old))
     AND (v_cut IS NULL OR p.created_at > v_cut);
  GET DIAGNOSTICS v_items = ROW_COUNT;

  -- 5. The old catalog row goes last: nothing references it any more.
  DELETE FROM public.sku_metadata WHERE sku = p_old;

  IF v_sd IS NOT NULL THEN
    UPDATE public.sku_metadata SET sd_number = v_sd WHERE sku = p_new AND sd_number IS NULL;
  END IF;

  INSERT INTO public.sku_canonical_renames
    (old_sku, new_sku, merged, inventory_rows, inventory_qty, logs, snapshots, picking_lists, note)
  VALUES (p_old, p_new, v_merged AND NOT v_reused, v_inv, v_inv_qty, v_logs, v_snaps, v_items, p_note);

  RETURN jsonb_build_object('old', p_old, 'new', p_new, 'merged', v_merged AND NOT v_reused,
                            'archived_sold_sd', v_reused,
                            'inventory_rows', v_inv, 'inventory_qty', v_inv_qty,
                            'logs', v_logs, 'snapshots', v_snaps, 'picking_lists', v_items);
END;
$function$;
