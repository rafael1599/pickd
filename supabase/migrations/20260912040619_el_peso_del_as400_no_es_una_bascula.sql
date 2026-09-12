-- El peso del AS400 entra, pero no se hace pasar por una báscula.
--
-- Rafael, 12 sep 2026: «en los pesos sí regístralos también. Si el peso de
-- PickD es menor a 45 pero mayor al peso de AS400, el de PickD gana; en los
-- demás gana AS400, para quitar los 45 default que en la gran mayoría está
-- mal». Y después: «eso solo para bikes, en partes no aplica esa regla».
--
-- Hasta hoy ese write era imposible sin mentir. `set_dimensions_verified`
-- (1 sep 2026) marca `weight_verified = true` en **cualquier** UPDATE que
-- cambie `weight_lbs` —«el que mide lo dice, no el valor que cambió»— y es
-- monótono: no se puede bajar después. Así que meter el 42 del AS400 archivaba
-- ese 42 como lectura de báscula, y la cola de Measure (`/export/measure`) deja
-- de pedir que alguien pese esa caja **para siempre**. El peso es uno de los
-- cuatro números que la estación teclea en Audit Source: un nominal disfrazado
-- de báscula se paga en flete.
--
-- La bandera sigue teniendo un dueño, la báscula. Lo que se añade es la
-- declaración simétrica a la que el trigger ya acepta («el que escribe mandó
-- verified = true»): **el que escribe puede decir que esto NO es una pesada**,
-- con un ajuste local a la transacción. No hay forma de confundirlo con el
-- `false` rancio que `ItemDetailView` reescribe en cada guardado —contra el que
-- existe la regla monótona—, porque ese camino no pone el ajuste.

CREATE OR REPLACE FUNCTION public.set_dimensions_verified()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.length_in IS DISTINCT FROM OLD.length_in
     OR NEW.width_in  IS DISTINCT FROM OLD.width_in
     OR NEW.height_in IS DISTINCT FROM OLD.height_in
     -- The writer measured it and the numbers happened not to move.
     OR (COALESCE(NEW.dimensions_verified, false) AND NOT COALESCE(OLD.dimensions_verified, false))
  THEN
    NEW.dimensions_verified := true;
    NEW.dimensions_measured_at := now();
  ELSE
    -- Monotonic: a later write cannot carry a stale false over a measurement.
    NEW.dimensions_verified := COALESCE(OLD.dimensions_verified, false);
    NEW.dimensions_measured_at := OLD.dimensions_measured_at;
  END IF;

  IF (
       (NEW.weight_lbs IS DISTINCT FROM OLD.weight_lbs
        -- …salvo que quien escribe declare que su número NO es una pesada.
        -- Lo pone `apply_as400_weight`, local a su transacción.
        AND COALESCE(current_setting('pickd.weight_source', true), '') <> 'as400')
       OR (COALESCE(NEW.weight_verified, false) AND NOT COALESCE(OLD.weight_verified, false))
     )
  THEN
    NEW.weight_verified := true;
  ELSE
    NEW.weight_verified := COALESCE(OLD.weight_verified, false);
  END IF;

  RETURN NEW;
END;
$function$;

-- ── La regla de Rafael, en SQL y en un solo sitio ────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_as400_weight(p_sku text, p_weight numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sku   text := public.canonical_sku(p_sku);
  v_bike  boolean;
  v_have  numeric;
BEGIN
  -- Un cero no es un peso. Nueve de los primeros diecisiete bikes leídos traen
  -- `Weight: 0` en la pantalla del AS400, y cambiar 45 por 0 no es quitar un
  -- default, es empeorarlo.
  IF p_weight IS NULL OR p_weight <= 0 THEN
    RETURN jsonb_build_object('sku', v_sku, 'action', 'skipped', 'why', 'as400 has no weight');
  END IF;

  SELECT is_bike, weight_lbs INTO v_bike, v_have FROM sku_metadata WHERE sku = v_sku;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sku', v_sku, 'action', 'skipped', 'why', 'not in the catalogue');
  END IF;

  -- La excepción, y es **solo para bicis**: un peso que no es el default de 45
  -- y que además es MÁS PESADO que el del AS400 es casi siempre una pesada de
  -- verdad — el del AS400 es neto o nominal y siempre sale por debajo (36 donde
  -- la báscula dijo 33,6; 37 donde dijo 37,91). Por debajo del suyo, el nuestro
  -- es un default o un error, y el suyo gana.
  --
  -- Las partes no tienen 45 que proteger: su default es 1 lb, que no es la
  -- pesada de nadie. Ahí gana el AS400 siempre que traiga un número
  -- (Rafael, 12 sep 2026: «eso solo para bikes»).
  IF COALESCE(v_bike, false) AND v_have IS NOT NULL AND v_have < 45 AND v_have > p_weight THEN
    RETURN jsonb_build_object(
      'sku', v_sku, 'action', 'kept', 'why', 'pickd is heavier and not the default',
      'pickd', v_have, 'as400', p_weight
    );
  END IF;

  IF v_have IS NOT DISTINCT FROM p_weight THEN
    RETURN jsonb_build_object('sku', v_sku, 'action', 'unchanged', 'weight', p_weight);
  END IF;

  -- El ajuste es local a la transacción, no a la sentencia, así que se apaga
  -- en cuanto el UPDATE pasa: si no, cualquier otro write de peso en la misma
  -- transacción heredaría el permiso de no sellar. La ventana es una sentencia.
  PERFORM set_config('pickd.weight_source', 'as400', true);
  UPDATE sku_metadata SET weight_lbs = p_weight WHERE sku = v_sku;
  PERFORM set_config('pickd.weight_source', '', true);

  RETURN jsonb_build_object(
    'sku', v_sku, 'action', 'written', 'from', v_have, 'to', p_weight,
    'is_bike', COALESCE(v_bike, false)
  );
END;
$function$;

COMMENT ON FUNCTION public.apply_as400_weight(text, numeric) IS
  'Mete el peso del AS400 en sku_metadata sin sellar weight_verified. Gana AS400 salvo que sea una BICI cuyo peso en PickD no sea el default de 45 y ademas pese mas que el del AS400 (Rafael, 12 sep 2026). Un peso <= 0 del AS400 no es un peso.';

REVOKE ALL ON FUNCTION public.apply_as400_weight(text, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_as400_weight(text, numeric) TO service_role, authenticated;
