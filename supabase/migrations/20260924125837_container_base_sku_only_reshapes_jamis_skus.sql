-- ============================================================================
-- _container_base_sku sólo reacomoda lo que tiene forma de SKU de JAMIS (24 sep 2026)
--
-- Nació para las hojas de contenedor, donde Excel se come los ceros y el
-- guion (`0077` → `00-0077`, `034680BK` → `03-4680BK`). Pero reacomodaba
-- cualquier SKU con 3 a 6 dígitos, tuviera la forma que tuviera: al registrar
-- una caja de dos cuadros del proveedor Wei Lun, `TM-993` salió como
-- `99-0003TM`, y `PKD-137BIK` sale como `13-0007PK`. La usan el alta de
-- contenedores y el lote por fotos (resolve_container_skus → apply_intake_lines),
-- así que cualquier número de proveedor se registraba con un SKU inventado.
--
-- Ahora sólo reacomoda lo que empieza por dígito y termina en hasta tres letras
-- —un SKU de JAMIS al que le falta formato—; todo lo demás pasa por
-- canonical_sku(), que es la autoridad de la grafía de un SKU (20260826220000).
-- Validado en prod con rollback: sobre todos los SKUs de sku_metadata e
-- inventory, sólo cambian los que no tienen forma de JAMIS.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._container_base_sku(p_sku text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN upper(trim(coalesce(p_sku, ''))) ~ '^[0-9][0-9 -]*[A-Z]{0,3}$'
     AND length(public._container_digits(p_sku)) BETWEEN 3 AND 6
      THEN left(public._container_digits(p_sku), 2) || '-'
           || lpad(substr(public._container_digits(p_sku), 3), 4, '0')
           || public._container_color2(p_sku)
    ELSE public.canonical_sku(p_sku)
  END;
$function$;

DO $$
DECLARE bad text := '';
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('TM-993', 'TM-993'), ('PKD-137BIK', 'PKD-137BIK'), ('0077', '00-0077'),
    ('034680BK', '03-4680BK'), ('03-4680BK', '03-4680BK'), ('03 4680 BK', '03-4680BK'),
    ('792584991050', '792584991050'), ('19-1961', '19-1961')
  ) AS v(input, expected) LOOP
    IF public._container_base_sku(r.input) IS DISTINCT FROM r.expected THEN
      bad := bad || format(E'\n  %s → %s (expected %s)', r.input, public._container_base_sku(r.input), r.expected);
    END IF;
  END LOOP;
  IF bad <> '' THEN RAISE EXCEPTION '_container_base_sku validation failed:%', bad; END IF;
END $$;
