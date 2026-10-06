-- Reetiquetar un cuadro no arrastra a los demás (idea-253, P1).
--
-- 20261006212938 hacía seguir a cada grupo su letra emparejando la lista vieja
-- y la nueva por posición. En una fila F,G, el mover del mapa que lleva F a H
-- deja G,H, y por posición F pasaba a G y G a H: el grupo de G cambiaba de
-- cuadro sin que nadie lo moviera. Ahora las letras que siguen en las dos
-- listas no se tocan, y sólo las que salen se emparejan, en orden, con las que
-- entran (F → H). El resto del trigger es el mismo.

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

  -- Only the letters changed: the groups follow their letter. Letters in both
  -- lists stay; the ones that left map, in order, to the ones that arrived
  -- (F,G → G,H is F → H: G never moved). Unequal counts: a group whose letter
  -- left keeps no square.
  IF TG_OP = 'UPDATE'
     AND NEW.distribution IS NOT DISTINCT FROM OLD.distribution
     AND NEW.sublocation IS DISTINCT FROM OLD.sublocation
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.distribution) e WHERE e ? 'square') THEN
    SELECT array_agg(DISTINCT s ORDER BY s) INTO v_old
      FROM unnest(COALESCE(OLD.sublocation, '{}')) s
     WHERE NOT (s = ANY(COALESCE(NEW.sublocation, '{}')));
    SELECT array_agg(DISTINCT s ORDER BY s) INTO v_new
      FROM unnest(COALESCE(NEW.sublocation, '{}')) s
     WHERE NOT (s = ANY(COALESCE(OLD.sublocation, '{}')));

    FOR v_entry IN SELECT e FROM jsonb_array_elements(NEW.distribution) e
    LOOP
      v_sq := v_entry->>'square';
      IF v_sq IS NOT NULL AND NOT (v_sq = ANY(COALESCE(NEW.sublocation, '{}'))) THEN
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
