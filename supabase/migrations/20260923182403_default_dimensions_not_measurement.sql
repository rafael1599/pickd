-- ============================================================================
-- Las medidas selladas sin cinta: cambiar un default por otro no es medir (idea-224)
--
-- Problema:
--   Un SKU 05- nace parte por prefijo (1 lb, caja 0×0×0). Cuando alguien corrige el
--   tipo a bici en el formulario, el UPDATE pone 45 lb y 55×8.5×30.5, y
--   set_dimensions_verified sellaba dimensions_verified = true y weight_verified = true
--   porque «un valor cambió». Nadie midió ni pesó.
--
-- Regla en el trigger:
--   - Cambiar una caja por defecto (55/8.5/30.5 o 0/0/0) por otra caja por defecto
--     NO es una medición. Si OLD y NEW son ambos cajas por defecto y el cliente
--     no mandó dimensions_verified = true explícito, la bandera se mantiene como estaba.
--   - Mismo trato para el peso con los defaults 45 y 1 lb.
--   - Monótono: un valor medido real nunca se baja.
--   - Un true explícito siempre sella (permite a Measure confirmar un default medido).
--
-- Destildado de datos:
--   10 SKUs sellados con exactamente la caja por defecto de bici que llegan al
--   export de FedEx se desmarcan (dimensions_verified = false, dimensions_measured_at = NULL).
--   weight_verified NO se toca (el peso de la etiqueta se queda verificado).
--   El trigger respeta set_config('pickd.demote_dimensions', 'true', true),
--   evitando el lock ACCESS EXCLUSIVE que provocaría ALTER TABLE DISABLE TRIGGER.
-- ============================================================================

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
  -- Escape explícito de destildado administrativo (local a la transacción)
  IF COALESCE(current_setting('pickd.demote_dimensions', true), '') = 'true' THEN
    NEW.dimensions_verified := COALESCE(NEW.dimensions_verified, false);
    NEW.dimensions_measured_at := NEW.dimensions_measured_at;
  ELSE
    -- Cajas por defecto: Bici (55 x 8.5 x 30.5) y Parte (0 x 0 x 0)
    -- COALESCE: 47 filas tienen medidas en NULL; sin él la comparación da NULL
    -- y la regla dependería de la lógica de tres valores.
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
      -- Monótono: un write posterior no pisa una medición real con false
      NEW.dimensions_verified := COALESCE(OLD.dimensions_verified, false);
      NEW.dimensions_measured_at := OLD.dimensions_measured_at;
    END IF;
  END IF;

  -- Pesos por defecto: Bici (45 lb) y Parte (1 lb)
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

COMMENT ON FUNCTION public.set_dimensions_verified() IS
  'Sella dimensions_verified y weight_verified sólo ante mediciones/pesadas reales. El cambio entre cajas o pesos por defecto de tipos no sella salvo que venga marcado explícito.';

-- Destildado idempotente de los 10 SKUs en export de FedEx con caja por defecto no medida
SELECT set_config('pickd.demote_dimensions', 'true', true);

UPDATE public.sku_metadata
   SET dimensions_verified = false,
       dimensions_measured_at = NULL
 WHERE sku IN (
   '03-3680GY', '07-3673BK', '03-4631GY', '02-3680GY', '03-4666BR',
   '06-4603BL', '05-1142BK', '05-1135GN', '05-1136RD', '05-1121GN'
 )
   AND length_in = 55 AND width_in = 8.5 AND height_in = 30.5
   AND dimensions_verified = true;

-- El escape se apaga en cuanto termina el destildado: es local a la transacción,
-- pero nada más en esta migración debe poder bajar una bandera.
SELECT set_config('pickd.demote_dimensions', '', true);
