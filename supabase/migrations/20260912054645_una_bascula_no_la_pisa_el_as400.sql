-- Una pesada real no la pisa el AS400, aunque pase de 45.
--
-- Rafael, 12 sep 2026, dio la regla: «si el peso de PickD es menor a 45 pero
-- mayor al peso de AS400, el de PickD gana; en los demás gana AS400, para
-- quitar los 45 default que en la gran mayoría está mal». El `< 45` era su
-- manera de decir «esto es el default del trigger», y acierta en las bicis
-- normales.
--
-- Falla en las **e-bikes**, que nunca tuvieron 45. `03-3604BL` y `03-3607GY`
-- (HUDSON E2) llevaban **80 lb con `weight_verified = true`** —una báscula— y
-- el AS400 dice 66, su habitual peso neto. La regla, leída al pie de la letra,
-- las bajó a 66. Y ese número no es decorativo: una e-bike se declara en su
-- propio cartón y su peso es lo que la estación teclea en Audit Source
-- (docs/prds/ship-ebike-declaration.md). Catorce libras de menos es la
-- dirección que FedEx re-factura.
--
-- Así que el umbral se sustituye por la pregunta exacta que ya existe en la
-- tabla desde el 1 sep: **`weight_verified` dice si alguien lo puso en una
-- báscula**. Un peso verificado no lo toca nadie; el resto sigue la regla de
-- Rafael tal cual. No es contradecirle: es su misma intención, con el dato
-- bueno en lugar del proxy.

CREATE OR REPLACE FUNCTION public.apply_as400_weight(p_sku text, p_weight numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sku      text := public.canonical_sku(p_sku);
  v_bike     boolean;
  v_have     numeric;
  v_weighed  boolean;
BEGIN
  -- Un cero no es un peso: nueve de los primeros diecisiete bikes leídos traen
  -- `Weight: 0`, y cambiar 45 por 0 no quita un default, lo empeora.
  IF p_weight IS NULL OR p_weight <= 0 THEN
    RETURN jsonb_build_object('sku', v_sku, 'action', 'skipped', 'why', 'as400 has no weight');
  END IF;

  SELECT is_bike, weight_lbs, COALESCE(weight_verified, false)
    INTO v_bike, v_have, v_weighed
  FROM sku_metadata WHERE sku = v_sku;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sku', v_sku, 'action', 'skipped', 'why', 'not in the catalogue');
  END IF;

  -- La báscula gana siempre. Es la pregunta que el `< 45` intentaba hacer.
  IF v_weighed THEN
    RETURN jsonb_build_object(
      'sku', v_sku, 'action', 'kept', 'why', 'somebody weighed this one',
      'pickd', v_have, 'as400', p_weight
    );
  END IF;

  -- Y la regla de Rafael para lo demás: un peso que no es el default de 45 y
  -- que además pesa MÁS que el del AS400 es casi siempre una medida real sin
  -- marcar — el número del AS400 es neto y siempre sale por debajo. Solo bicis:
  -- las partes tienen 1 lb de default, que no es la pesada de nadie.
  IF COALESCE(v_bike, false) AND v_have IS NOT NULL AND v_have < 45 AND v_have > p_weight THEN
    RETURN jsonb_build_object(
      'sku', v_sku, 'action', 'kept', 'why', 'pickd is heavier and not the default',
      'pickd', v_have, 'as400', p_weight
    );
  END IF;

  IF v_have IS NOT DISTINCT FROM p_weight THEN
    RETURN jsonb_build_object('sku', v_sku, 'action', 'unchanged', 'weight', p_weight);
  END IF;

  -- El ajuste es local a la transacción, no a la sentencia: se apaga en cuanto
  -- el UPDATE pasa, o cualquier otro write de peso heredaría el permiso.
  PERFORM set_config('pickd.weight_source', 'as400', true);
  UPDATE sku_metadata SET weight_lbs = p_weight WHERE sku = v_sku;
  PERFORM set_config('pickd.weight_source', '', true);

  RETURN jsonb_build_object(
    'sku', v_sku, 'action', 'written', 'from', v_have, 'to', p_weight,
    'is_bike', COALESCE(v_bike, false)
  );
END;
$function$;

-- Las tres que la regla literal ya pisó, devueltas a su báscula.
SELECT set_config('pickd.weight_source', 'as400', true);
UPDATE sku_metadata SET weight_lbs = 80    WHERE sku = '03-3604BL' AND weight_lbs = 66;
UPDATE sku_metadata SET weight_lbs = 80    WHERE sku = '03-3607GY' AND weight_lbs = 66;
UPDATE sku_metadata SET weight_lbs = 46.29 WHERE sku = '03-3675BL' AND weight_lbs = 47;
SELECT set_config('pickd.weight_source', '', true);
