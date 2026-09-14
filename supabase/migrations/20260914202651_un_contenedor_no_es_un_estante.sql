-- Un contenedor no es un estante.
--
-- Un `NNNNN` como `7006N` es el nombre temporal de una carga: mercancía que
-- llegó o está llegando y que alguien irá moviendo, caja a caja, a su fila real.
-- Ese movimiento ES el proceso y funciona — `6430N` lleva 16 movimientos con
-- 1.667 unidades, `7004N` doce con 235. Lo que no funcionaba es lo que pasa
-- ENTRE que la carga entra al sistema y alguien la descarga: en esa ventana el
-- contenedor se comportaba como una fila más del almacén.
--
-- Rafael, 14 sep 2026: «hay nuevo stock viniendo así que no apliques esa verdad
-- para locations de containers… para nosotros es fácil simplemente mover del
-- contenedor a una ubicación real cuando llega la mercancía».
--
-- **Lo que rompía, medido:** `7002N` tenía `picking_order = 359` —en medio de la
-- ruta de recorrido, rankeado como un estante cualquiera— y entregó **207
-- unidades en 114 recogidas**. Los otros diecisiete contenedores están en NULL,
-- que `pickingOrder.ts` trata como «sin ranking, o sea normal». Así que la ruta
-- podía mandar, y mandó, a alguien a abrir un contenedor para sacar una pieza.
-- Hay una orden viva (#881309, `needs_correction`) apuntando a `9000N`, que se
-- vació en julio.
--
-- **La regla:** el stock de un contenedor existe y se cuenta, pero no está
-- disponible mientras siga ahí. `picking_order` en la banda de último recurso
-- (`LAST_RESORT_PICKING_ORDER` = 9000) dice exactamente eso: no lo esconde del
-- inventario ni de las búsquedas, sólo hace que nadie vaya allí mientras quede
-- estante. Si de verdad no hay otra, el picker llega y el mensaje es honesto.
--
-- **9997, y no otro número:** después de `ROW X EP` (9995), que es overflow
-- palletizado pero está en el edificio y sobre un estante, y antes del 9999 de
-- `UNKNOWN`, que significa «no sabemos dónde está». Un contenedor es peor que un
-- pallet enterrado y mejor que una incógnita.
--
-- No se toca ningún contenedor que alguien ya haya puesto en la banda a mano.
UPDATE public.locations
   SET picking_order = 9997
 WHERE location ~ '^[0-9]{4}N$'
   AND (picking_order IS NULL OR picking_order < 9000);

-- Qué cargas quedan por descargar, y desde cuándo.
--
-- Hasta hoy no había ninguna señal de la edad de un contenedor, y por eso
-- `6430N` lleva 125 unidades desde el 11 de junio sin que nadie lo sepa. La
-- vista no pide que nadie marque nada: sale de las filas que el movimiento ya
-- crea y ya vacía.
--
-- Y cierra el ciclo sola. `quantity > 0` es lo único que hace falta para que un
-- contenedor vaciado desaparezca de la lista con el mismo gesto que lo vació:
-- no hay un botón de «cerrar contenedor» que alguien pueda olvidar.
CREATE OR REPLACE VIEW public.v_open_containers AS
SELECT
  i.warehouse,
  i.location                                      AS container,
  COUNT(DISTINCT i.sku)::int                      AS skus,
  SUM(i.quantity)::int                            AS units,
  MIN(i.created_at)::date                         AS opened_on,
  MAX(i.updated_at)::date                         AS last_touched,
  (CURRENT_DATE - MIN(i.created_at)::date)::int   AS days_open,
  (CURRENT_DATE - MAX(i.updated_at)::date)::int   AS days_idle
FROM public.inventory i
WHERE i.location ~ '^[0-9]{4}N$'
  AND i.is_active
  AND i.quantity > 0
GROUP BY i.warehouse, i.location;

COMMENT ON VIEW public.v_open_containers IS
  'Cargas sin terminar de descargar, con su edad. Un contenedor desaparece de aquí cuando sale su última unidad — el mismo movimiento que lo vacía lo cierra. days_idle alto con pocos SKUs = quedó a medias.';
