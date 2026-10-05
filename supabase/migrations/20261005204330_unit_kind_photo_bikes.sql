-- ============================================================================
-- unit_kind + base_sku + split_unit: una bici especial es su propio artículo
-- (idea-248, paso 1 de la opción A de docs/stock-bicis-estudio-2026-10-05.md)
--
-- El AS400 ya da número propio a cada bici especial: `01-NNNN` a cada S/D (con
-- el serial en la descripción) y `02-` a las photo y demo (Rafael, 5 oct 2026:
-- «demo cuenta como ph»). PickD seguía colgando la photo bike del SKU de su
-- modelo: 26 PH `03-`/`07-` en PHOTO compartían nombre y foto con las nuevas,
-- y el AS400 no las cuenta ahí (03-4229BL: 5 en NJ, 6 en PickD).
--
--   1. `sku_metadata.unit_kind` ('new' | 'sd' | 'photo'): qué es la bici.
--      `is_scratch_dent` se queda como espejo de `unit_kind = 'sd'`, sincronizado
--      en los dos sentidos por `a_unit_kind_sync`, así ningún lector ni escritor
--      actual de `is_scratch_dent` cambia. Una bici no puede ser S/D y PH a la vez:
--      es una sola columna.
--   2. `sku_metadata.base_sku`: el SKU del modelo del que viene una bici
--      especial. Sin FK a propósito: `rename_sku_everywhere` fusiona y borra
--      fichas, y un FK perdería el vínculo en silencio.
--   3. El nombre de una PH termina en ` PH`, con la misma mecánica que ` S/D`
--      (20260930150819, 20261001192600): lo pone y lo quita la base al cambiar
--      `unit_kind`, y se conserva cuando alguien reescribe el nombre.
--   4. `split_unit(...)`: separa N unidades de una fila a un SKU propio, con una
--      copia de la ficha del modelo. No toca ninguno de los escritores de stock.
--
-- Aditiva: dos columnas nuevas, funciones y triggers nuevos. Las funciones S/D
-- existentes no cambian.
-- ============================================================================

BEGIN;

-- ─── 1. Columnas ────────────────────────────────────────────────────────────
ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS unit_kind text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS base_sku text;

ALTER TABLE public.sku_metadata
  DROP CONSTRAINT IF EXISTS sku_metadata_unit_kind_check;
ALTER TABLE public.sku_metadata
  ADD CONSTRAINT sku_metadata_unit_kind_check CHECK (unit_kind IN ('new', 'sd', 'photo'));

COMMENT ON COLUMN public.sku_metadata.unit_kind IS
  'Qué es la bici: new (de catálogo), sd (scratch & dent) o photo (photo/demo/prototipo; DEMO cuenta como PH, Rafael 5 oct 2026). is_scratch_dent es su espejo (a_unit_kind_sync). idea-248.';
COMMENT ON COLUMN public.sku_metadata.base_sku IS
  'SKU del modelo del que viene una bici especial (03-4229BL para la PH separada de ese SKU). Sin FK a propósito. idea-248.';

-- Backfill ANTES de crear los triggers: solo copia la marca que ya existe y no
-- debe reescribir ningún nombre.
UPDATE public.sku_metadata SET unit_kind = 'sd' WHERE is_scratch_dent AND unit_kind <> 'sd';

CREATE INDEX IF NOT EXISTS sku_metadata_unit_kind_idx
  ON public.sku_metadata (unit_kind) WHERE unit_kind <> 'new';
CREATE INDEX IF NOT EXISTS sku_metadata_base_sku_idx
  ON public.sku_metadata (base_sku) WHERE base_sku IS NOT NULL;

-- ─── 2. unit_kind ↔ is_scratch_dent ────────────────────────────────────────
-- Corre antes que los demás BEFORE (orden alfabético: a_canonical_sku,
-- a_unit_kind_sync, tr_*), así sd_for_sale_default ya ve el is_scratch_dent
-- correcto en un INSERT. En un UPDATE de unit_kind, ese trigger (que es
-- `UPDATE OF is_scratch_dent, sd_for_sale`) no se dispara, por eso el default
-- 'not_yet' también se pone aquí.
CREATE OR REPLACE FUNCTION public.sync_unit_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF tg_op = 'INSERT' THEN
    new.unit_kind := COALESCE(new.unit_kind, 'new');
    IF COALESCE(new.is_scratch_dent, false) AND new.unit_kind = 'new' THEN
      new.unit_kind := 'sd';
    END IF;
  ELSIF new.unit_kind IS DISTINCT FROM old.unit_kind THEN
    NULL; -- unit_kind manda; is_scratch_dent se deriva abajo
  ELSIF new.is_scratch_dent IS DISTINCT FROM old.is_scratch_dent THEN
    new.unit_kind := CASE
      WHEN new.is_scratch_dent THEN 'sd'
      WHEN old.unit_kind = 'sd' THEN 'new'
      ELSE old.unit_kind
    END;
  END IF;

  new.is_scratch_dent := (new.unit_kind = 'sd');
  IF new.unit_kind = 'sd' AND new.sd_for_sale IS NULL THEN
    new.sd_for_sale := 'not_yet';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS a_unit_kind_sync ON public.sku_metadata;
CREATE TRIGGER a_unit_kind_sync
  BEFORE INSERT OR UPDATE ON public.sku_metadata
  FOR EACH ROW EXECUTE FUNCTION public.sync_unit_kind();

-- ─── 3. El nombre de una PH termina en " PH" ───────────────────────────────
-- Quita PH, PHTO y PHOTO como palabra suelta, donde estén (el AS400 escribe
-- «… TEAL    PHTO»). No toca DEMO: es parte de lo que se sabe de la bici.
CREATE OR REPLACE FUNCTION public.strip_ph_item_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_name IS NULL THEN NULL
    ELSE btrim(regexp_replace(
      regexp_replace(p_name, '(^|\s)(PH|PHTO|PHOTO)(?=\s|$)', ' ', 'gi'),
      '\s+', ' ', 'g'))
  END
$$;

CREATE OR REPLACE FUNCTION public.ph_item_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN nullif(public.strip_ph_item_name(p_name), '') IS NULL THEN p_name
    ELSE public.strip_ph_item_name(p_name) || ' PH'
  END
$$;

-- El nombre que corresponde a un tipo: una sola marca, al final.
CREATE OR REPLACE FUNCTION public.unit_item_name(p_name text, p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'sd'    THEN public.sd_item_name(public.strip_ph_item_name(p_name))
    WHEN 'photo' THEN public.ph_item_name(public.strip_sd_item_name(p_name))
    ELSE public.strip_ph_item_name(public.strip_sd_item_name(p_name))
  END
$$;

DO $$
BEGIN
  ASSERT public.ph_item_name('EXPLORER A1 S/T 16 2024 ANO TEAL    PHTO') = 'EXPLORER A1 S/T 16 2024 ANO TEAL PH';
  ASSERT public.ph_item_name('PHTO NV CHERRY BLOSSOM LADIES 3SPD PU') = 'NV CHERRY BLOSSOM LADIES 3SPD PU PH';
  ASSERT public.ph_item_name('RENEGADE C1 RED AXS 56 2026 PRISM Blue') = 'RENEGADE C1 RED AXS 56 2026 PRISM Blue PH';
  ASSERT public.ph_item_name('Portal A2 17 photo') = 'Portal A2 17 PH';
  ASSERT public.ph_item_name('X PH') = 'X PH';
  ASSERT public.ph_item_name('PHANTOM 17 GRAPH') = 'PHANTOM 17 GRAPH PH';
  ASSERT public.ph_item_name('') = '';
  ASSERT public.ph_item_name('PH') = 'PH';
  ASSERT public.ph_item_name(NULL) IS NULL;
  ASSERT public.unit_item_name('LASER 1.6 - 2025 SMOKE S/D', 'photo') = 'LASER 1.6 - 2025 SMOKE PH';
  ASSERT public.unit_item_name('LASER 1.6 - 2025 SMOKE PH', 'sd') = 'LASER 1.6 - 2025 SMOKE S/D';
  ASSERT public.unit_item_name('LASER 1.6 - 2025 SMOKE PH', 'new') = 'LASER 1.6 - 2025 SMOKE';
  ASSERT public.unit_item_name('HARDLINE C2 17 2020 HAZZARD DEMO', 'photo') = 'HARDLINE C2 17 2020 HAZZARD DEMO PH';
END $$;

-- Lado del estante: un nombre escrito para un SKU photo conserva su marca.
CREATE OR REPLACE FUNCTION public.keep_ph_item_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sku_metadata m WHERE m.sku = new.sku AND m.unit_kind = 'photo') THEN
    new.item_name := public.unit_item_name(new.item_name, 'photo');
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS tr_inventory_ph_item_name ON public.inventory;
CREATE TRIGGER tr_inventory_ph_item_name
  BEFORE INSERT OR UPDATE OF item_name, sku ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.keep_ph_item_name();

-- Lado del catálogo: cambiar de tipo reescribe el nombre de todas sus filas.
-- Corre después de tr_sku_metadata_sd_item_name (orden alfabético), así que
-- cuando los dos se disparan, este deja la palabra final.
CREATE OR REPLACE FUNCTION public.sync_unit_kind_item_names()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (tg_op = 'INSERT' AND new.unit_kind <> 'new')
     OR (tg_op = 'UPDATE' AND new.unit_kind IS DISTINCT FROM old.unit_kind) THEN
    UPDATE public.inventory i
       SET item_name = public.unit_item_name(i.item_name, new.unit_kind)
     WHERE i.sku = new.sku
       AND i.item_name IS DISTINCT FROM public.unit_item_name(i.item_name, new.unit_kind);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_sku_metadata_unit_kind_item_name ON public.sku_metadata;
CREATE TRIGGER tr_sku_metadata_unit_kind_item_name
  AFTER INSERT OR UPDATE OF unit_kind, is_scratch_dent ON public.sku_metadata
  FOR EACH ROW EXECUTE FUNCTION public.sync_unit_kind_item_names();

-- ─── 4. split_unit ─────────────────────────────────────────────────────────
-- Saca p_qty unidades de (p_sku, p_warehouse, p_location) a un SKU propio de
-- tipo p_kind. El SKU nuevo es, por orden: p_new_sku (el número del AS400 si ya
-- existe), el serial, o `<p_sku>-PH1` / `-SD1` (el primero libre).
--
-- La ficha nueva copia del modelo lo físico (is_bike, modelo, talla, color,
-- categoría, medidas, peso) y nada de lo que es del modelo y no de la unidad:
-- ni foto, ni UPC, ni lo del AS400, ni los campos de S/D.
--
-- Un solo log EDIT con previous_sku = el SKU del modelo, la misma forma que un
-- cambio de SKU de una fila (docs/inventory-log-shapes.md): no es un ADD ni un
-- DEDUCT, no entra ni sale nada del almacén.
CREATE OR REPLACE FUNCTION public.split_unit(
  p_sku text,
  p_warehouse text,
  p_location text,
  p_qty integer,
  p_kind text,
  p_performed_by text,
  p_user_id uuid DEFAULT NULL,
  p_new_sku text DEFAULT NULL,
  p_serial text DEFAULT NULL,
  p_user_role text DEFAULT 'staff'
)
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
    dimensions_verified, dimensions_measured_at, weight_verified, received_year
  ) VALUES (
    v_new, p_kind, p_sku, v_serial, v_meta.is_bike, v_meta.model, v_meta.size, v_meta.color, v_meta.category,
    v_meta.length_in, v_meta.width_in, v_meta.height_in, v_meta.length_ft, v_meta.weight_lbs,
    v_meta.dimensions_verified, v_meta.dimensions_measured_at, v_meta.weight_verified, v_meta.received_year
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

COMMENT ON FUNCTION public.split_unit(text, text, text, integer, text, text, uuid, text, text, text) IS
  'Separa p_qty unidades de una fila a un SKU propio de tipo sd/photo (número del AS400, serial o <sku>-PHn). idea-248.';

COMMIT;
