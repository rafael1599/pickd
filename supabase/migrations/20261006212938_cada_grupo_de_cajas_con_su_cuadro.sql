-- Cada grupo de cajas sabe en qué cuadro está (idea-253, P1).
--
-- Rafael, 6 oct 2026: «quiero ser capaz de editar esas cantidades desde la
-- misma card… qty de un SKU en una sublocation y cuántos en otra». Un grupo de
-- `inventory.distribution` pasa de {type, count, units_each[, label]} a llevar
-- también `square` ('F'). La cantidad de un cuadro no se guarda: es la suma de
-- sus grupos, una sola fuente (docs/prds/stock-card-edit-and-pick-square.md).
--
-- Aditiva: `distribution` es jsonb, la clave nueva no cambia el esquema. Dos
-- cosas para que el cuadro no se pierda ni se contradiga:
--
-- 1. `adjust_distribution` reconstruía cada grupo con jsonb_build_object y sólo
--    conservaba `label`: el primer pick habría borrado el cuadro. Ahora parte de
--    la entrada y sólo reescribe `count` / `units_each`, así que conserva toda
--    clave que traiga. A igual tipo y tamaño descuenta primero de la letra más
--    alta (la regla del 18 sep, que queda de desempate).
--
-- 2. Un trigger mantiene `sublocation` y los cuadros de acuerdo:
--    - fuera de un ROW no hay cuadros: se quitan de los grupos;
--    - si sólo cambió `sublocation` (el mapa reetiqueta, la ficha cambia las
--      letras) con el mismo número de letras, cada grupo sigue a su letra en
--      orden (F,G → F,H: el de G pasa a H); con otro número de letras, el grupo
--      cuya letra ya no está se queda sin cuadro;
--    - si TODOS los grupos llevan cuadro, `sublocation` = sus letras, ordenadas.
--      Si alguno no lo lleva (las 561 filas de hoy), `sublocation` no se toca:
--      ningún writer viejo cambia de comportamiento.

CREATE OR REPLACE FUNCTION public.adjust_distribution(p_item_id integer, p_qty_to_deduct integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_distribution JSONB;
    v_pending INTEGER;
    v_type TEXT;
    v_types TEXT[] := ARRAY['PALLET', 'LINE', 'TOWER', 'OTHER'];
    v_entry JSONB;
    v_count INTEGER;
    v_units_each INTEGER;
    v_full_remove INTEGER;
    v_residual INTEGER;
    v_result JSONB := '[]'::JSONB;
BEGIN
    IF p_qty_to_deduct <= 0 THEN
        RETURN NULL;
    END IF;

    SELECT distribution INTO v_distribution
    FROM inventory WHERE id = p_item_id;

    IF v_distribution IS NULL OR jsonb_array_length(v_distribution) = 0 THEN
        RETURN v_distribution;
    END IF;

    v_pending := p_qty_to_deduct;

    -- PALLET → LINE → TOWER → OTHER; inside a type the smallest group first,
    -- and at the same size the highest letter (18 Sep rule, now the tiebreak).
    FOREACH v_type IN ARRAY v_types
    LOOP
        FOR v_entry IN
            SELECT e.value
            FROM jsonb_array_elements(v_distribution) AS e(value)
            WHERE e.value->>'type' = v_type
            ORDER BY (e.value->>'units_each')::INTEGER ASC,
                     COALESCE(e.value->>'square', '') DESC
        LOOP
            v_count := (v_entry->>'count')::INTEGER;
            v_units_each := (v_entry->>'units_each')::INTEGER;

            IF v_pending <= 0 OR v_count <= 0 OR v_units_each <= 0 THEN
                v_result := v_result || jsonb_build_array(v_entry);
                CONTINUE;
            END IF;

            v_full_remove := LEAST(floor(v_pending::NUMERIC / v_units_each)::INTEGER, v_count);
            v_count := v_count - v_full_remove;
            v_pending := v_pending - (v_full_remove * v_units_each);

            -- Break one group: the residual keeps the entry's square and label.
            IF v_pending > 0 AND v_count > 0 THEN
                v_count := v_count - 1;
                v_residual := v_units_each - v_pending;
                v_pending := 0;

                IF v_residual > 0 THEN
                    v_result := v_result || jsonb_build_array(
                        v_entry || jsonb_build_object('count', 1, 'units_each', v_residual)
                    );
                END IF;
            END IF;

            IF v_count > 0 THEN
                v_result := v_result || jsonb_build_array(
                    v_entry || jsonb_build_object('count', v_count)
                );
            END IF;
        END LOOP;
    END LOOP;

    UPDATE inventory
    SET distribution = v_result,
        updated_at = NOW()
    WHERE id = p_item_id;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.keep_inventory_squares()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old text[];
  v_new text[];
  v_groups jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_sq text;
  v_pos int;
  v_all boolean := true;
  v_letters text[];
BEGIN
  IF NEW.distribution IS NULL OR jsonb_typeof(NEW.distribution) <> 'array'
     OR jsonb_array_length(NEW.distribution) = 0 THEN
    RETURN NEW;
  END IF;

  -- Outside a ROW there are no squares.
  IF NEW.location IS NULL OR NEW.location NOT ILIKE 'ROW%' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.distribution) e WHERE e ? 'square') THEN
      SELECT jsonb_agg(e - 'square') INTO NEW.distribution
      FROM jsonb_array_elements(NEW.distribution) e;
    END IF;
    RETURN NEW;
  END IF;

  -- Only the letters changed: the groups follow their letter.
  IF TG_OP = 'UPDATE'
     AND NEW.distribution IS NOT DISTINCT FROM OLD.distribution
     AND NEW.sublocation IS DISTINCT FROM OLD.sublocation
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.distribution) e WHERE e ? 'square') THEN
    SELECT array_agg(DISTINCT s ORDER BY s) INTO v_old FROM unnest(COALESCE(OLD.sublocation, '{}')) s;
    SELECT array_agg(DISTINCT s ORDER BY s) INTO v_new FROM unnest(COALESCE(NEW.sublocation, '{}')) s;

    FOR v_entry IN SELECT e FROM jsonb_array_elements(NEW.distribution) e
    LOOP
      v_sq := v_entry->>'square';
      IF v_sq IS NOT NULL AND NOT (v_sq = ANY(COALESCE(v_new, '{}'))) THEN
        v_pos := array_position(v_old, v_sq);
        IF v_pos IS NOT NULL AND cardinality(v_old) = cardinality(v_new) THEN
          v_entry := v_entry || jsonb_build_object('square', v_new[v_pos]);
        ELSE
          v_entry := v_entry - 'square';
        END IF;
      END IF;
      v_groups := v_groups || jsonb_build_array(v_entry);
    END LOOP;
    NEW.distribution := v_groups;
    RETURN NEW;
  END IF;

  -- Every group has its square: the row's letters are those squares.
  SELECT bool_and(e ? 'square' AND (e->>'square') ~ '^[A-Z]$'),
         array_agg(DISTINCT e->>'square' ORDER BY e->>'square')
    INTO v_all, v_letters
  FROM jsonb_array_elements(NEW.distribution) e;

  IF v_all THEN
    NEW.sublocation := v_letters;
  END IF;

  RETURN NEW;
END;
$function$;

-- After trg_zz_inventory_sync_location (BEFORE triggers run in name order).
DROP TRIGGER IF EXISTS trg_zzz_inventory_squares ON public.inventory;
CREATE TRIGGER trg_zzz_inventory_squares
  BEFORE INSERT OR UPDATE OF distribution, sublocation, location, location_id ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.keep_inventory_squares();
