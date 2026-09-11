-- Un color, una grafía.
--
-- `sku_metadata.color` alimenta un filtro de coincidencia EXACTA en Scratch &
-- Dent (`scratchAndDentApi.ts`: `.eq('color', …)`), y el desplegable se arma con
-- los valores distintos. Con la columna como está, ese filtro ya miente hoy:
--
--     Blue | BLUE                                    90 filas, 2 entradas
--     gloss black | Gloss Black | GLOSS BLACK | ...   71 filas, 4 entradas
--     Thunder Grey | THUNDER GREY | 'Thunder Grey '   29 filas, 3 entradas
--
-- Filtrar por `Blue` se pierde las 28 que dicen `BLUE`, y «gloss black» aparece
-- cuatro veces en la lista — una de ellas con un espacio al final que nadie ve.
-- **163 valores distintos, 113 de verdad.** Un tercio del desplegable es ruido.
--
-- Se normaliza a MAYÚSCULAS porque es hacia donde ya iba la columna sola: las
-- grafías mayoritarias (`GLOSS BLACK`, `THUNDER GREY`, `BLACK PEARL`) ya lo
-- están, y AS400 —que va a ser la autoridad de aquí en adelante— escribe así.
-- Si se quiere bonito en pantalla, eso es Title Case al pintarlo, no al
-- guardarlo.
--
-- El trigger es la mitad que importa: sin él la columna se vuelve a partir con
-- el primer formulario que escriba «Ink» en vez de «INK».

CREATE OR REPLACE FUNCTION public.normalize_sku_color()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.color IS NOT NULL THEN
    -- Espacios de sobra dentro y fuera, y una sola caja. NULL si queda vacío:
    -- una cadena en blanco es un hueco disfrazado y el filtro la ofrecería.
    NEW.color := NULLIF(UPPER(BTRIM(REGEXP_REPLACE(NEW.color, '\s+', ' ', 'g'))), '');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_sku_color ON public.sku_metadata;
CREATE TRIGGER trg_normalize_sku_color
  BEFORE INSERT OR UPDATE OF color ON public.sku_metadata
  FOR EACH ROW EXECUTE FUNCTION public.normalize_sku_color();

-- Y las que ya están. Toca solo las que cambian, para no remover 811 filas ni
-- disparar realtime sobre las que ya estaban bien escritas.
UPDATE public.sku_metadata
SET color = NULLIF(UPPER(BTRIM(REGEXP_REPLACE(color, '\s+', ' ', 'g'))), '')
WHERE color IS NOT NULL
  AND color IS DISTINCT FROM NULLIF(UPPER(BTRIM(REGEXP_REPLACE(color, '\s+', ' ', 'g'))), '');

COMMENT ON FUNCTION public.normalize_sku_color() IS
  'Una sola grafía por color: MAYÚSCULAS, sin espacios de sobra. El filtro de Scratch & Dent compara exacto, así que dos grafías del mismo color son dos entradas del desplegable y una búsqueda que se pierde filas.';
