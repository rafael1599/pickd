-- ============================================================================
-- One spelling per SKU: canonical_sku() imposed at every write (idea-154)
--
-- Decision (Rafael, 2026-08-26): the canonical form is AS400's —
--   DD-NNNN[CC(C)]: 2-digit department, dash, 4-digit number zero-padded,
--   0-3 upper-case colour/finish letters. AS400 has no other spelling:
--   '01-0288' is "S/D EXPLORER A1…" there, '01-288' finds nothing.
-- Anything that does not parse as that shape (PKD-…, 12-digit UPCs, serials
-- like Y22B010415, tracking numbers, '23-00146A' with a 5-digit number) is
-- stored upper(trim) and otherwise left alone.
--
-- Why a rule at the write, not tolerance at the read: fourteen paths create
-- SKUs and one of them dashed; the catalog held 1,662 rows in AS400 form
-- next to 72 short ones ('31-75'), 33 dashless ones ('700106BK'), 22 pairs
-- of the same part under two names with the stock split between them, and
-- every reader — inventorySkuCandidates, lookup_canonical_sku, the search
-- RPC, the watchdog's sku_map — carried its own tolerance and still missed
-- the leading zero. Every earlier attempt added a tolerant read; this adds
-- the write. docs/sku-identity-analysis.md has the full case.
--
-- What this migration does, in order:
--   1. canonical_sku(text) — the rule, one copy, IMMUTABLE. Mirrored in TS
--      (normalizeSkuOnRegister) and Python (parser.canonical_sku); the tests
--      on each side pin the same table of cases.
--   2. rename_sku_everywhere(old, new) — rewrites the denormalized name in
--      every table that carries it (inventory, inventory_logs ×2, snapshots,
--      asset_tags, cycle counts, FedEx returns, exclusions, picking_lists
--      .items) and merges when the new name already exists: two rows in the
--      same bin become one with the quantities summed and a log line; two
--      catalog rows become one keeping the target's values and filling its
--      blanks from the old. Every call is written to sku_canonical_renames.
--   3. The data pass: every catalog row whose spelling is not canonical
--      (108 on 2026-08-26: 22 merges, 2 same-bin sums), then every order
--      item still naming a spelling that is not a catalog row at all (the
--      watchdog's '010491' for SKUs nobody registered). Terminal orders are
--      rewritten too — the paper said four digits anyway — with the activity
--      and compensation triggers off so history neither reorders "Recently
--      Completed" nor moves stock.
--   4. Triggers that canonicalize NEW.sku on sku_metadata, inventory,
--      inventory_logs and cycle_count_items; register_new_sku, the search
--      RPC, lookup_canonical_sku and the container helper use the function.
--   5. sku_key (normalized, generated) with a UNIQUE index: the database
--      refuses '128338BK' next to '12-8338BK' instead of storing both. The
--      migration aborts — nothing applied — if the pass leaves a duplicate.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The rule
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.canonical_sku(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH s AS (
    SELECT regexp_replace(upper(trim(p_raw)), '\s+', ' ', 'g') AS v
  ),
  m AS (
    SELECT v,
           -- dept, separator, 1-4 digit number, optional letters: '01-530', '03 3768 BLD'
           regexp_match(v, '^(\d{2})[-\s]+(\d{1,4})\s*([A-Z]{0,3})$') AS a,
           -- glued 6 digits + letters: '033768BLD', '700106BK', '128353'
           regexp_match(v, '^(\d{2})(\d{4})([A-Z]{0,3})$')            AS b
      FROM s
  )
  SELECT CASE
           WHEN a IS NOT NULL THEN a[1] || '-' || lpad(a[2], 4, '0') || a[3]
           WHEN b IS NOT NULL THEN b[1] || '-' || b[2] || b[3]
           ELSE v
         END
    FROM m;
$$;

COMMENT ON FUNCTION public.canonical_sku(text) IS
  'Canonical SKU spelling (idea-154): DD-NNNN[CCC] for anything that parses as an AS400 stock number (number zero-padded to 4), upper(trim) for everything else. Mirrored by normalizeSkuOnRegister (TS) and parser.canonical_sku (watchdog); keep the three case tables identical.';

-- ----------------------------------------------------------------------------
-- 2. Audit + rename helper
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sku_canonical_renames (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  old_sku        text NOT NULL,
  new_sku        text NOT NULL,
  merged         boolean NOT NULL,
  inventory_rows int NOT NULL DEFAULT 0,
  inventory_qty  int NOT NULL DEFAULT 0,
  logs           int NOT NULL DEFAULT 0,
  snapshots      int NOT NULL DEFAULT 0,
  picking_lists  int NOT NULL DEFAULT 0,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sku_canonical_renames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sku_canonical_renames_admin_read ON public.sku_canonical_renames;
CREATE POLICY sku_canonical_renames_admin_read
  ON public.sku_canonical_renames FOR SELECT TO authenticated
  USING (public.is_admin());

COMMENT ON TABLE public.sku_canonical_renames IS
  'Append-only record of every SKU rename/merge done by rename_sku_everywhere (idea-154). merged = the new name already existed; the counts say what was rewritten. This is the list for the physical count of merged parts.';

CREATE OR REPLACE FUNCTION public.rename_sku_everywhere(p_old text, p_new text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  UPDATE public.fedex_return_items SET sku = p_new WHERE sku = p_old;

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
$$;

REVOKE EXECUTE ON FUNCTION public.rename_sku_everywhere(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rename_sku_everywhere(text, text, text) TO service_role;

COMMENT ON FUNCTION public.rename_sku_everywhere(text, text, text) IS
  'Renames a SKU in every table that carries it and merges into an existing name (bins summed, catalog blanks filled). Records the call in sku_canonical_renames. service_role only: it moves stock names, not something a screen should call.';

-- ----------------------------------------------------------------------------
-- 3. The data pass
-- ----------------------------------------------------------------------------

-- Off for the pass, back on right after:
--   update_activity_timestamp would stamp last_activity_at on every historic
--   order whose line gets respelled and reorder "Recently Completed";
--   compensate_picking_list_changes diffs items by index and reads a changed
--   sku as "replaced item" — it only acts on active statuses (none name a
--   respelled SKU today), but a rename must never move stock by accident.
ALTER TABLE public.picking_lists DISABLE TRIGGER update_activity_timestamp;
ALTER TABLE public.picking_lists DISABLE TRIGGER compensate_picking_list_changes_trigger;

DO $$
DECLARE
  r        record;
  v        jsonb;
  n_ren    int := 0;
  n_merged int := 0;
  n_items  int := 0;
BEGIN
  FOR r IN
    SELECT sku, public.canonical_sku(sku) AS canon
      FROM public.sku_metadata
     WHERE public.canonical_sku(sku) IS DISTINCT FROM sku
     ORDER BY sku
  LOOP
    v := public.rename_sku_everywhere(r.sku, r.canon, 'Canonical SKU (idea-154)');
    n_ren := n_ren + 1;
    IF (v->>'merged')::boolean THEN n_merged := n_merged + 1; END IF;
  END LOOP;

  -- Order lines naming a spelling that is not a catalog row at all: the
  -- watchdog's dashless form for a SKU nobody registered ('010491'). Same
  -- line, canonical spelling, so a later registration matches it exactly.
  UPDATE public.picking_lists p
     SET items = (
       SELECT jsonb_agg(
                CASE WHEN (i ? 'sku') AND public.canonical_sku(i->>'sku') IS DISTINCT FROM (i->>'sku')
                     THEN jsonb_set(i, '{sku}', to_jsonb(public.canonical_sku(i->>'sku')))
                     ELSE i END
                ORDER BY ord)
         FROM jsonb_array_elements(p.items) WITH ORDINALITY AS t(i, ord))
   WHERE jsonb_typeof(p.items) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.items) AS i
                  WHERE (i ? 'sku') AND public.canonical_sku(i->>'sku') IS DISTINCT FROM (i->>'sku'));
  GET DIAGNOSTICS n_items = ROW_COUNT;

  RAISE NOTICE 'canonical pass: % catalog names respelled (% merged into an existing name), % further orders with lines respelled',
    n_ren, n_merged, n_items;
END;
$$;

ALTER TABLE public.picking_lists ENABLE TRIGGER update_activity_timestamp;
ALTER TABLE public.picking_lists ENABLE TRIGGER compensate_picking_list_changes_trigger;

-- Nothing below is worth having if two catalog rows still share a key.
DO $$
DECLARE v_dups text;
BEGIN
  SELECT string_agg(k || ' (' || skus || ')', '; ')
    INTO v_dups
    FROM (SELECT regexp_replace(upper(sku), '[^A-Z0-9]', '', 'g') AS k, string_agg(sku, ', ') AS skus
            FROM public.sku_metadata GROUP BY 1 HAVING count(*) > 1) d;
  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION 'canonical pass left duplicate keys, aborting: %', v_dups;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. From now on the database spells every new name
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.canonicalize_sku_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only a new name or a rename: a quantity edit on a row must never move
  -- the row to another name behind the caller's back.
  IF TG_OP = 'INSERT' OR NEW.sku IS DISTINCT FROM OLD.sku THEN
    NEW.sku := public.canonical_sku(NEW.sku);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_canonical_sku ON public.sku_metadata;
CREATE TRIGGER a_canonical_sku
  BEFORE INSERT OR UPDATE OF sku ON public.sku_metadata
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_sku_column();

DROP TRIGGER IF EXISTS a_canonical_sku ON public.inventory;
CREATE TRIGGER a_canonical_sku
  BEFORE INSERT OR UPDATE OF sku ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_sku_column();

DROP TRIGGER IF EXISTS a_canonical_sku ON public.inventory_logs;
CREATE TRIGGER a_canonical_sku
  BEFORE INSERT ON public.inventory_logs
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_sku_column();

DROP TRIGGER IF EXISTS a_canonical_sku ON public.cycle_count_items;
CREATE TRIGGER a_canonical_sku
  BEFORE INSERT OR UPDATE OF sku ON public.cycle_count_items
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_sku_column();

-- register_new_sku: canonical before the lookup, so the dedup redirect and
-- the ON CONFLICT both see the one spelling.
CREATE OR REPLACE FUNCTION public.register_new_sku(p_sku text, p_item_name text DEFAULT NULL::text, p_warehouse text DEFAULT 'LUDLOW'::text, p_location text DEFAULT 'INCOMING'::text, p_model text DEFAULT NULL::text, p_size text DEFAULT NULL::text, p_color text DEFAULT NULL::text, p_serial_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_location_id uuid;
  v_sku text := public.canonical_sku(p_sku); -- idea-154: one spelling, before any lookup
  v_location text := upper(trim(p_location));
  v_model text := NULLIF(trim(p_model), '');
  v_size text := NULLIF(trim(p_size), '');
  v_color text := NULLIF(trim(p_color), '');
  v_serial text := NULLIF(trim(p_serial_number), '');
  v_name text := NULLIF(trim(p_item_name), '');
  v_canonical_sku text;
  v_canonical_dashes int;
  v_input_dashes int;
  v_redirected boolean := false;
BEGIN
  IF v_sku = '' OR v_sku IS NULL THEN
    RAISE EXCEPTION 'SKU cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- Derive the display name from Model/Size/Color when no explicit name is given.
  -- concat_ws skips NULLs, so a missing field never leaves a double space.
  IF v_name IS NULL THEN
    v_name := NULLIF(concat_ws(' ', v_model, v_size, v_color), '');
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Provide an item name or at least a model/size/color'
      USING ERRCODE = '22023';
  END IF;

  IF v_location = '' OR v_location IS NULL THEN
    v_location := 'INCOMING';
  END IF;

  -- Pick the candidate with the most dashes (canonical convention).
  -- Tie-break alphabetically for determinism.
  SELECT sku, length(regexp_replace(sku, '[^-]', '', 'g'))
    INTO v_canonical_sku, v_canonical_dashes
  FROM public.lookup_canonical_sku(v_sku)
  ORDER BY length(regexp_replace(sku, '[^-]', '', 'g')) DESC, sku ASC
  LIMIT 1;

  v_input_dashes := length(regexp_replace(v_sku, '[^-]', '', 'g'));

  -- Only redirect upward (more dashes = more canonical).
  IF v_canonical_sku IS NOT NULL AND v_canonical_dashes > v_input_dashes THEN
    v_sku := v_canonical_sku;
    v_redirected := true;
  END IF;

  -- Persist the structured fields on sku_metadata. COALESCE so re-registering an
  -- existing SKU with blanks never wipes previously stored values.
  INSERT INTO sku_metadata (sku, model, size, color, serial_number)
  VALUES (v_sku, v_model, v_size, v_color, v_serial)
  ON CONFLICT (sku) DO UPDATE SET
    model         = COALESCE(EXCLUDED.model, sku_metadata.model),
    size          = COALESCE(EXCLUDED.size, sku_metadata.size),
    color         = COALESCE(EXCLUDED.color, sku_metadata.color),
    serial_number = COALESCE(EXCLUDED.serial_number, sku_metadata.serial_number);

  v_location_id := resolve_location(p_warehouse, v_location, 'admin');

  INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
  VALUES (v_sku, p_warehouse, v_location, v_location_id, 0, true, v_name)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'sku', v_sku,
    'item_name', v_name,
    'model', v_model,
    'size', v_size,
    'color', v_color,
    'serial_number', v_serial,
    'location', v_location,
    'location_id', v_location_id,
    'canonical_redirect', v_redirected
  );
END;
$function$;

-- lookup_canonical_sku: the padded form is a match too ('01-530' → 01-0530).
CREATE OR REPLACE FUNCTION public.lookup_canonical_sku(p_raw text)
 RETURNS TABLE(sku text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH norm AS (
    SELECT regexp_replace(LOWER(TRIM(p_raw)), '[-\s]', '', 'g') AS n,
           public.canonical_sku(p_raw)                         AS c
  )
  SELECT sm.sku
  FROM public.sku_metadata sm
  CROSS JOIN norm
  WHERE norm.n <> ''
    AND (regexp_replace(LOWER(sm.sku), '[-\s]', '', 'g') = norm.n OR sm.sku = norm.c)
    AND sm.sku <> p_raw -- exclude exact-match (the bad sku itself if it happens to live in sku_metadata)
  LIMIT 2;
$function$;

-- Container sheets: Excel drops the leading zero of a numeric cell, so
-- '01 0077' arrives as 0077 → 77. Pad the number; the colour rule is
-- unchanged (a third letter is a per-family decision, not this one).
CREATE OR REPLACE FUNCTION public._container_base_sku(p_sku text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN length(public._container_digits(p_sku)) BETWEEN 3 AND 6
      THEN left(public._container_digits(p_sku), 2) || '-'
           || lpad(substr(public._container_digits(p_sku), 3), 4, '0')
           || public._container_color2(p_sku)
    ELSE upper(trim(p_sku))
  END;
$function$;

-- Search: a complete term in any spelling finds the canonical row.
CREATE OR REPLACE FUNCTION public.search_inventory_with_metadata(p_search text DEFAULT ''::text, p_warehouse text DEFAULT NULL::text, p_include_inactive boolean DEFAULT false, p_show_parts boolean DEFAULT false, p_only_scratch_dent boolean DEFAULT false, p_only_fedex_returns boolean DEFAULT false, p_offset integer DEFAULT 0, p_limit integer DEFAULT 30)
 RETURNS TABLE(id bigint, sku text, quantity integer, location text, location_id uuid, sublocation text[], item_name text, warehouse text, is_active boolean, internal_note text, distribution jsonb, created_at timestamp with time zone, location_sort_key integer, image_url text, length_in numeric, width_in numeric, height_in numeric, weight_lbs numeric, is_bike boolean, is_scratch_dent boolean, serial_number text, upc text, model text, condition_description text, pdf_link text, sd_price numeric, condition text, fedex_tracking_number text, fedex_return_id uuid, fedex_return_status text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT
      TRIM(p_search)                                     AS raw_search,
      regexp_replace(TRIM(p_search), '[-\s]', '', 'g')   AS normalized_search,
      -- idea-154: the canonical spelling of the whole term, so '01-530' finds 01-0530.
      regexp_replace(public.canonical_sku(TRIM(p_search)), '[-\s]', '', 'g') AS canonical_key
  ),
  -- Latest fedex_return per sku (when >1 returns share a sku, take the most
  -- recently received). Drives both the "which return is this" enrichment
  -- and the p_only_fedex_returns scope filter.
  fdx_latest AS (
    SELECT DISTINCT ON (fri.sku)
      fri.sku,
      fr.id              AS return_id,
      fr.tracking_number,
      fr.status,
      fr.received_at
    FROM public.fedex_return_items fri
    JOIN public.fedex_returns fr ON fr.id = fri.return_id
    ORDER BY fri.sku, fr.received_at DESC NULLS LAST
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
      fx.tracking_number AS fedex_tracking_number,
      fx.return_id       AS fedex_return_id,
      fx.status          AS fedex_return_status
    FROM public.inventory i
    JOIN public.sku_metadata m ON m.sku = i.sku
    LEFT JOIN fdx_latest fx ON fx.sku = i.sku
    CROSS JOIN normalized n
    WHERE (p_warehouse IS NULL OR i.warehouse = p_warehouse)
      AND (p_include_inactive OR (i.is_active = TRUE AND i.quantity > 0))
      AND (NOT p_only_scratch_dent OR m.is_scratch_dent = TRUE)
      -- Bike/parts toggle: applies normally, but bypassed for FedEx-return
      -- rows (their seriales rarely match the bike-pattern trigger, so the
      -- toggle would hide them), for scratch-and-dent / only-fedex modes, and
      -- when p_show_parts IS NULL (search mode: bikes and parts together).
      AND (
        p_only_fedex_returns
        OR p_only_scratch_dent
        OR fx.return_id IS NOT NULL
        OR p_show_parts IS NULL
        OR m.is_bike = (NOT p_show_parts)
      )
      AND (NOT p_only_fedex_returns OR fx.return_id IS NOT NULL)
      AND (
        n.raw_search = ''
        OR i.item_name ILIKE '%' || n.raw_search || '%'
        OR i.location  ILIKE '%' || n.raw_search || '%'
        OR m.model ILIKE '%' || n.raw_search || '%'
        OR m.condition_description ILIKE '%' || n.raw_search || '%'
        OR (
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
        OR (
          n.normalized_search <> ''
          AND m.serial_number IS NOT NULL
          AND regexp_replace(m.serial_number, '[-\s]', '', 'g')
              ILIKE '%' || n.normalized_search || '%'
        )
        OR (
          n.normalized_search <> ''
          AND m.upc IS NOT NULL
          AND regexp_replace(m.upc, '[-\s]', '', 'g')
              ILIKE '%' || n.normalized_search || '%'
        )
        -- Match by FedEx tracking number → finds the inventory row linked to
        -- the return via fedex_return_items.sku, no matter where the bike
        -- currently lives. Uses a subquery rather than fx.tracking_number so
        -- it works for items whose sku didn't make it into fdx_latest's
        -- DISTINCT ON (e.g., a sku that lives in older returns).
        OR (
          n.normalized_search <> ''
          AND i.sku IN (
            SELECT fri2.sku FROM public.fedex_return_items fri2
            JOIN public.fedex_returns fr2 ON fr2.id = fri2.return_id
            WHERE regexp_replace(fr2.tracking_number, '[-\s]', '', 'g')
                  ILIKE '%' || n.normalized_search || '%'
          )
        )
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
    f.fedex_tracking_number, f.fedex_return_id, f.fedex_return_status,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    f.location_sort_key ASC,
    (f.is_active AND f.quantity > 0) DESC,
    f.sku ASC
  OFFSET p_offset
  LIMIT p_limit;
$function$;


-- ----------------------------------------------------------------------------
-- 5. Never two names for one key again
-- ----------------------------------------------------------------------------

ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS sku_key text
  GENERATED ALWAYS AS (regexp_replace(upper(sku), '[^A-Z0-9]', '', 'g')) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sku_metadata_sku_key ON public.sku_metadata (sku_key);

COMMENT ON COLUMN public.sku_metadata.sku_key IS
  'upper(sku) with everything but A-Z0-9 removed. UNIQUE: the catalog cannot hold two spellings of one key. Read-only (generated).';
