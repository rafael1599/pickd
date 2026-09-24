# Ship lenta: proyección liviana primero, `items` + reclasificación después

## Estado
IMPLEMENTADO (código, sin commitear todavía — `pnpm check` en verde: `tsc` limpio, 123 archivos /
1697 tests). Investigación completa en
`.agent/management/research/2026-09-23-ship-slow.md` (no repetir, ya está hecha).

## Pedido de Rafael (literal)
"la vista ship esta muy lenta y necesitamos alivianarla sin perder la info que el usuario ve en
cuanto entra, lo demas se puede ir descargando por partes o que se busque la mejor estrategia para
que el usuario sienta que todo va muy rapido, investigar el problema antes de proponer nada."

## Contexto ya conocido
- Backlog: idea-224 (`.agent/management/BACKLOG.md`, sección "141. Ship está muy lenta").
- Emparentado, mismo patrón, sigue abierto: idea-191 (`useStockReservations.ts:93,96`, sin
  debounce) — se ataca en la misma pasada porque la proyección liviana que arregla Ship es la
  misma pieza que necesita ese sitio.
- Ya existe en el propio archivo el patrón correcto a copiar: `fetchSingleLightweightOrder`
  (`ShipScreen.tsx:1109`) + el patch local del handler de realtime (`ShipScreen.tsx:1170-1234`).

## Hallazgos
Ver el research doc completo. Resumen de los 4 hallazgos, con archivo:línea:
1. `fetchOrders` (`useShipOrdersData.ts:286-450`) es un bloque secuencial de 4 fases y
   `ShipScreen.tsx:3056` gatea **toda** la lista con un solo `loading` — nada se pinta hasta que
   termina la fase más lenta, aunque la tarjeta no necesita `items` para pintarse.
2. La fase 4 (`sku_metadata` por cada SKU, `useShipOrdersData.ts:407-441`) es **trabajo duplicado**:
   el trigger `stamp_item_sku_metadata()` ya sella `item.sku_metadata.is_bike`/`weight_lbs` dentro
   de `items` (confirmado en la migración SQL), y `shippingClassification.ts:31` ya lee esa forma.
3. 6 sitios (`ShipScreen.tsx:1567,1613,1625,2332,3198,3221`) llaman `fetchOrders()` completo tras
   mutar 1-2 órdenes conocidas, cuando podrían llamar `fetchSingleLightweightOrder(id)` + patch
   local, igual que ya hace el realtime handler.
4. `useStockReservations.ts:93,96` invalida `picking_lists` sin debounce en cada UPDATE de
   `inventory` (idea-191, sin arreglar) — mismo patrón, otra pantalla (DoubleCheckView).

## Plan de fix propuesto

### Paso 0 — medir antes de tocar código (10-15 min, mañana a primera hora)
Correr contra prod (o local si el stack ya está arriba):
```sql
select count(*) from picking_lists
where status <> 'cancelled'
  and (is_shipped is null or is_shipped = false
       or (is_shipped = true and updated_at >= <medianoche NY de hoy>));

select avg(pg_column_size(items)), max(pg_column_size(items)) from picking_lists
where status <> 'cancelled';

select count(*) from picking_lists
where is_waiting_inventory = true and updated_at < now() - interval '14 days';
```
Si el primer número es grande (cientos), sumar paginación al listado normal (hoy solo pagina la
búsqueda, `SEARCH_PAGE_SIZE`) — no estaba en el plan original, decidir ahí si hace falta ya o
después. Si el tercer número es ~0, la fase 4 se puede borrar sin red de seguridad, no solo diferir.

### Paso 1 — proyección liviana para el listado (el fix principal)
En `useShipOrdersData.ts`:
- Nueva constante `ORDER_LIST_SUMMARY_SELECT` (mismas columnas que `ORDER_LIST_SELECT` **menos**
  `items`, más un campo derivado mínimo para pintar la tarjeta sin las líneas — revisar qué usa
  `renderOrderCard` de `items` hoy antes de decidir qué se puede quitar del todo vs. qué necesita
  quedarse como resumen (p. ej. si `renderOrderCard` ya usa `total_units`/`pallets_qty`/`weight_lbs`
  de columnas propias y no de `items`, `items` se puede omitir entero del primer fetch).
- `fetchOrders` pasa a dos fases:
  - **Fase A (bloquea `loading`):** el query grande con `ORDER_LIST_SUMMARY_SELECT` (sin `items`) +
    las 3 condicionales que ya existían (exact-match, recent-shipped, top-up). `setOrders` se llama
    aquí — esto es lo que apaga el skeleton y pinta la lista.
  - **Fase B (en segundo plano, no bloquea nada):** para las órdenes que quedaron en pantalla,
    traer `items` (sin el join de `sku_metadata`, per Hallazgo 2) y mergear en `orders` por id
    cuando llegue. Sirve para: abrir el detalle sin un segundo round-trip si ya llegó, y para que
    `matchesPendingCarrierFilter`/`matchesShippedCarrierFilter` (que hoy usan `getCarrierLabel` →
    lee `is_bike` de `items`) tengan el dato en cuanto esté, sin bloquear el primer paint.
- **Confirmado (no queda abierto):** `bikeSkuSet` (`useShipOrdersData.ts:176-185`) sale de
  `useBikeSkuSet(allSkus)`, y `allSkus` se arma leyendo `orders.items` — o sea que hoy **ya**
  depende de que `items` haya llegado, exactamente igual que dependería en el esquema de dos fases.
  `useBikeSkuSet` hace su **propio** viaje a `sku_metadata` (`resolveBikeSets`, en
  `src/utils/bikeDetection.ts`), independiente del paso 4 de `fetchOrders` — así que **el paso 4 es
  redundante también por este lado**, no solo por el sello del trigger (Hallazgo 2): hay dos
  caminos que ya resuelven `is_bike`, y el que se puede borrar sin reemplazo es el de
  `fetchOrders`. En la Fase A (sin `items`) el carrier de cada tarjeta se pinta con lo que haya
  (o "sin asignar" un instante) y se corrige solo en cuanto la Fase B mergea `items` y
  `bikeSkuSet` resuelve — es justamente la sensación de "esto va rápido y se va completando" que
  pidió Rafael, no una regresión.

### Paso 2 — quitar (o convertir en fallback) la fase de `sku_metadata`
Depende de la respuesta a la pregunta de producto de abajo:
- **Si Rafael dice que el listado puede tolerar el dato ya sellado en `items`** (el default que
  recomienda el research): borrar el paso 4 de `fetchOrders` entero (líneas 407-441 hoy). El detalle
  de una orden individual (`fetchOrderDetails`) puede seguir haciendo su propio join si hace falta
  precisión ahí — eso es un fetch por selección, no por listado, y no es este problema.
- **Si Rafael quiere red de seguridad para las `is_waiting_inventory` viejas:** dejar el join, pero
  moverlo a la Fase B (no bloqueante) y solo para las órdenes marcadas `is_waiting_inventory`, no
  para todas.

### Paso 3 — los 6 sitios de refetch completo pasan a patch por id
En `ShipScreen.tsx`, reemplazar en los 6 call sites (1567, 1613, 1625, 2332, 3198, 3221):
```ts
// antes
fetchOrders();
// después (mismo patrón que el handler de realtime en 1170-1234)
const updated = await fetchSingleLightweightOrder(affectedId);
if (updated) setOrders(prev => /* filter + insert + sort, igual que el realtime handler */);
```
Para los sitios que mutan **un grupo** (ungroup, uncombine, resolución de envío por lote) puede
hacer falta refrescar más de un id — usar `fetchOrderGroupSiblings` (ya existe, usado en el mount)
en vez de `fetchOrders()` completo. Revisar cada uno de los 6 antes de tocar: no todos mutan la
misma cantidad de órdenes.

### Paso 4 (mismo patrón, otra pantalla) — idea-191
En `useStockReservations.ts:93,96`: envolver la invalidación en un debounce (~500ms), y de paso
darle la misma proyección liviana si `['picking_lists','reservations']` no necesita `items`
completo para lo que pinta DoubleCheckView. Confirmar qué lee esa query antes de tocarla — no
asumir que es igual a Ship.

### Paso 5 — verificación
- `pnpm check` (tsc + vitest, es la compuerta local).
- Antes/después con Chrome DevTools o el propio `web-perf`/Playwright: tiempo hasta primer paint de
  la lista de Ship, tamaño de la respuesta de red de la fase A vs. el `fetchOrders` de hoy.
- Confirmar que combinar/descombinar/cancelar/split/batch-ship siguen reflejando el cambio en la
  lista sin refrescar la página (regresión más probable de esta pasada).

## Preguntas para Rafael
- ❓ **Ya resuelta con el default recomendado, no bloqueó implementar:** se confía en el
  `is_bike`/`weight_lbs` ya sellado en `items` (Paso 2, hecho) — si en la práctica una orden
  `is_waiting_inventory` vieja muestra un carrier mal clasificado en el listado por esto, es la
  señal de que hace falta la red de seguridad que se dejó fuera; hasta entonces no vale la pena
  pagar el join en cada carga.

## Hallazgos de la implementación (23 sep 2026)
- **Paso 2 (quitar el join de `sku_metadata`):** hecho, `useShipOrdersData.ts` — se borró el bloque
  que pedía `sku_metadata` para cada SKU de cada orden. Una consulta menos en cada carga.
- **Paso 1 (proyección/carga por partes):** implementado con un matiz respecto al plan original —
  en vez de partir los CAMPOS (`items` sí / `items` no), se partió las FILAS: la consulta principal
  (sin búsqueda activa) pinta y apaga el skeleton en cuanto llega, y el piso de `RECENT_SHIPPED` +
  los hermanos de grupo combinado se traen después, en segundo plano, y se van agregando a la lista
  ya visible. Se decidió así al confirmar que `ShipFeedCard` sí usa `order.items` para la barra de
  progreso (`OrderProgressBar`) — omitir `items` del primer paint habría hecho que la barra de
  progreso naciera en 0% y se corrigiera sola un instante después, un cambio de comportamiento más
  arriesgado que partir por filas. La búsqueda (con texto) se dejó intacta, un solo viaje — ya es
  chica y paginada, y el prepend del match exacto depende de conocer el orden final de una vez.
  Se agregó un guard de "generación" (`fetchGenerationRef`) para que una ola de fondo de una llamada
  vieja (p. ej. si el usuario escribe en el buscador mientras la carga por defecto seguía trayendo
  hermanos de grupo) no pise el estado de una llamada más nueva.
- **Paso 3 (6 sitios de refetch completo → patch por id/grupo):** 5 de 6 convertidos
  (`ShipScreen.tsx`): combinar por sugerencia y resolución de envío por lote → `refreshOrderGroup`;
  ungroup → `refreshOrderById` del que salió + `refreshOrderGroup` de los que quedan; uncombine →
  member ids capturados ANTES de disolver (una vez disuelto el grupo, nadie conserva ese `group_id`)
  + `refreshOrderById` por cada uno; cancelar/eliminar → se intentó primero remover localmente sin
  red (ids ya conocidos), pero `cancelCombinedOrder`/`deleteList` devuelven `true`/`void` tanto si
  cancelaron como si el usuario declinó la pregunta "¿nunca se envió?" — no hay señal para
  distinguirlo — así que se optó por `refreshOrderById` de los ids afectados (barato: 1-2 filas,
  no toda la tabla) en vez de asumir el resultado. **Split se dejó sin tocar**, como anticipaba el
  plan: la orden nueva que crea no tiene id conocido en ese closure.
- **Paso 4 (idea-191, debounce):** hecho en `useStockReservations.ts` — un timer de 500ms colapsa
  ráfagas de `postgres_changes` en una sola invalidación, con cleanup del timer al desmontar.
- **Paso 0 (medir contra prod):** sigue pendiente — el MCP de Supabase no conectó tampoco durante
  la implementación. No bloqueó: el resto del plan no dependía de esas cifras.
- **Pendiente real, no técnico:** correr esto contra la app de verdad (o al menos contra un stack
  local con datos) antes de dar por buena la percepción de "más rápido" — esta sesión no tuvo forma
  de levantar Supabase local ni un navegador para medir tiempo real; solo `pnpm check` (tsc +
  vitest) verificó que compila y no rompió ningún test existente.

## Al integrarlo en main (24 sep 2026)

El Paso 2 se revirtió a medias: la consulta a `sku_metadata` volvió, como **última ola en
segundo plano** (`fetchLiveSkuMetadata` + `applyLiveSkuMetadata` en `useShipOrdersData.ts`, también
tras una búsqueda), aplicada sobre el estado del momento para no pisar lo que el realtime parcheó.
Motivo: en `shippingClassification.ts` el flag sellado en la línea gana sobre `bikeSkuSet`, incluso
un `false` explícito, y el sello sólo se reescribe cuando se escribe la orden — un SKU registrado o
corregido después dejaría la orden como FedEx (#881703). Backlog: `idea-226`.

