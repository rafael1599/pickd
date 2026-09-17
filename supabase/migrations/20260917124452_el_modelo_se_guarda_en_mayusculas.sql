-- El modelo se guarda en mayúsculas
--
-- `sku_metadata.model` se guarda hoy como lo teclee cada uno: conviven `Explorer A2` y `EXPLORER A2`. Para el sistema son modelos distintos, y eso cuesta en dos sitios:
-- parte en dos una fila del archivo de cartones que se sube a FedEx Ship Manager, y hace que al buscar tecleando el modelo aparezcan dos entradas de la misma bici.
--
-- El guardia solo pone MAYÚSCULAS y quita espacios de sobra. Nada más. No quita tallas, ni colores, ni años, ni toca la puntuación.

CREATE OR REPLACE FUNCTION public.normalize_sku_model()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.model IS NOT NULL THEN
    NEW.model := NULLIF(UPPER(BTRIM(REGEXP_REPLACE(NEW.model, '\s+', ' ', 'g'))), '');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_sku_model ON public.sku_metadata;
CREATE TRIGGER trg_normalize_sku_model
  BEFORE INSERT OR UPDATE OF model ON public.sku_metadata
  FOR EACH ROW EXECUTE FUNCTION public.normalize_sku_model();

COMMENT ON FUNCTION public.normalize_sku_model() IS
  'Una sola grafía por modelo: MAYÚSCULAS, sin espacios de sobra. Dos grafías del mismo modelo son una fila de más en FedEx y una bici que no aparece al buscarla.';
