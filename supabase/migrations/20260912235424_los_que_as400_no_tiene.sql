-- Los números que AS400 no tiene, apuntados donde se pueden ver.
--
-- Rafael, 12 sep 2026: «ya sabes cuáles no tiene, esos los puedes poner en una
-- lista de excluidos para ahorrar tiempo».
--
-- La lista existía y estaba mal guardada: un JSON en el disco de Bay 2
-- (`.sku_unknown.json`). Invisible desde PickD, sin copia, atado a esa máquina
-- y perdido si alguien reinstala. Un veredicto del ERP sobre el catálogo es un
-- hecho del catálogo, así que vive en el catálogo.
--
-- Un SKU marcado aquí no se vuelve a preguntar. Y como es una columna y no un
-- archivo, además se puede LEER: «qué tiene PickD que el AS400 no conoce» pasa
-- de ser una pregunta sin respuesta a un `where as400_absent_at is not null`.
-- Ahí es donde salieron las 75 VENTURA A1 CERULEAN registradas con sufijo `GY`
-- cuando su familia entera es `BL`.

ALTER TABLE public.sku_metadata
  ADD COLUMN IF NOT EXISTS as400_absent_at timestamptz;

COMMENT ON COLUMN public.sku_metadata.as400_absent_at IS
  'Cuando el watchdog pregunto por este numero y AS400 devolvio el buscador en blanco, que es como dice que no lo tiene. Lo excluye de la cola de lectura. Un valor aqui es una pista de catalogo: o el SKU esta mal escrito en PickD, o el ERP lo dio de baja.';

CREATE INDEX IF NOT EXISTS sku_metadata_as400_absent_idx
  ON public.sku_metadata (as400_absent_at)
  WHERE as400_absent_at IS NOT NULL;
