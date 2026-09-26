# PRD: Un pallet, una cuenta — lo que arma el piso, contado igual en Double Check y en Ship

**Estado:** Propuesto, esperando las ❓ de Rafael · **Fecha:** 2026-09-26 · **Autor:** Rafael + PickD
· **Backlog:** bug-045 · **Continúa:** `ship-pallet-dimensions.md` (su D1, «persistir el reparto de
pallets como entidad real», quedó fuera del MVP; este PRD es eso) · **Relacionado:**
`ship-ebike-declaration.md`, `/export/measure`, `docs/warehouse-ui-rules.md`

Todo lo que sigue está comprobado en el código (`archivo:línea` del 26 sep 2026) o medido en prod con
las funciones reales del repo (`npx vite-node`, script en
`label-bench/ship-plan/scripts/ship-stats-claude.mts`, fuera del repo). El inventario de código
duplicado lo hizo agy (`label-bench/refactor/01-inventario-agy.md`) y está verificado.

---

## 1) Contexto y problema

Ship existe por cuatro números —pallets, bikes, parts, weight— y por la tabla de pallets que pide el
portal del carrier (tamaño y peso por bulto). Un número mal es un envío mal.

**El 25 sep, WILMETTE** (#881735 / #881644 / #881645, 56 bicis: 31 grandes + 25 de niño) salió en
**5 tarimas**: grandes 11 / 10 / 10 y de niño 13 / 12. Ship declaraba **4**: 12 / 12 / 7 y un bulto
de niño de 25. Hubo que corregirlo a mano en la base (`0229a43`, `2d51f83`).

**Medido en prod** (envíos regulares completados; un envío = una orden suelta o un grupo
`general`/`pickup`):

| Últimos 30 días (214 envíos con bicis)                                                   |       Cifra |    % |
| ---------------------------------------------------------------------------------------- | ----------: | ---: |
| Llevan **tarima de niño** (más de 2 de niño) y Double Check **no la cuenta** como pallet |          32 | 15 % |
| `pallets_qty` guardado ≠ filas que declara Ship                                          |          21 | 10 % |
| Unidades de bici despachadas en **cajas sin medir**                                      | 242 / 1.207 | 20 % |
| Unidades de bici con el **peso por defecto** (45 lb, sin báscula)                        | 192 / 1.207 | 16 % |

A 90 días (656 envíos, 3.494 unidades de bici): 42 envíos con tarima de niño, las 42 sin contar; 755
unidades en cajas sin medir (22 %); 564 con 45 lb de defecto. Las cajas sin medir que más salen son
**las de WILMETTE**: CITIZEN 2 S/T `03-3990TL` (51 u en 30 días), `03-3989GY` (36), y después
`03-4703GY` (19), `03-4706GY` (17), `03-4709BR` (15), `03-4712BR` (10).

Casos concretos: **#881418** (22 de niño, ninguna grande) — Double Check cuenta **0 pallets**;
**#881450** (2 de niño) y **#881403** (1) — ni Double Check ni Ship declaran **ninguna** tarima;
#881568/#881662, #881449/#881468, #881623, #881373/#881622 — la tarima de niño no entra en
`pallets_qty`.

## 2) Las causas

**R1 · El reparto se calcula en cinco sitios, con tres reglas.**

| Dónde                       | Qué hace                                                                                                                        | Archivo                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Ship, tabla                 | `calculatePalletsWithBikeAwareness` → `applyBikeCounts` → `buildPalletDeclaration` (la tarima de niño es fila propia pasadas 2) | `ShipScreen.tsx` ~924-988          |
| DCV, pantalla               | `calculatePalletsWithBikeAwareness` → `redistributeWithOverrides` → `filter(!isParts).length`                                   | `DoubleCheckView.tsx` ~824-846     |
| Carrito, orden al completar | `getOptimizedPickingPath` → `calculatePalletsWithBikeAwareness` → `filter(!isParts).length`                                     | `PickingCartDrawer.tsx` ~825-831   |
| Carrito, cada hermana       | ídem, por hermana                                                                                                               | `PickingCartDrawer.tsx` ~937-943   |
| Carrito, Add-On             | ídem, en `calcMetrics`                                                                                                          | `PickingCartDrawer.tsx` ~1052-1059 |

**R2 · La tarima de niño no cuenta como pallet.** El contenedor de niño sale del reparto con
`isParts: true` (`containerKind: 'smallBikes'`), así que los cuatro `filter(!isParts)` la dejan
fuera; sólo Ship la declara. Una orden **sólo de niño** llega a tener 0 pallets.

**R3 · Lo que dice el piso no tiene un solo hogar.** El «este pallet lleva N» de DCV es `useState`
(`DoubleCheckView.tsx` ~626) y muere al cerrar; el total de pallets viaja por
`overriddenPalletCountRef` sólo al completar; `split` (tarimas de niño) y `bikes` (bicis por pallet)
viven en `pallet_dims` pero sólo Ship los lee y **ninguna pantalla** permite teclear `bikes`.

**R4 · Corregir un pallet en DCV rompe el reparto.** `redistributeWithOverrides`
(`utils/pickingLogic.ts` ~195) junta todas las líneas en un montón, llena los pallets fijados en orden
y reparte el resto con `calculatePallets`, sin reglas de bici: en WILMETTE metió **4 de niño** en un
pallet grande. Además muta las cantidades del montón (`poolItem.pickingQty -= take`).

**R5 · El reparto adivina sobre cajas sin medir.** La geometría supone 55 × 8.5 × 30.5 para una caja
que nadie midió y le caben 12 bicis donde el piso mete 10. El piso lo corrige cada vez; el catálogo no
se entera.

**R6 · Qué es bici se decide en tres sitios.** Ship arma sus conjuntos desde `skuMeta` con
`inventorySkuCandidates`; DCV consulta por su cuenta y, **antes** de que llegue la consulta, sólo
reconoce como bici los `03-` (`DoubleCheckView.tsx:693`) — las `01-`, `02-`, `06-`, `07-` pasan por
partes hasta entonces; el carrito llama a `resolveBikeSets`, que vive en `utils/bikeDetection.ts`
junto a las funciones puras e importa el cliente de Supabase, así que nada puro puede importarlo.

**R7 · Una combinada se junta de tres maneras.** Ship (`combineGeneralGroupSiblings`,
`ShipScreen.tsx` ~233-317) ancla en la más vieja, etiqueta cada línea con su orden, suma unidades y
fotos; el board (`mergeGroupOrders`, `board/mergeGroupOrders.ts` ~41-102) ancla en `groupOrders[0]`
por posición y no etiqueta las líneas; Double Check (`loadExternalList`, `usePickingSync.ts` ~722-764)
etiqueta con `source_order` y `source_list_id` y excluye completadas y canceladas.

### Bugs encontrados de paso (mismo terreno, no de pallets)

- **Ship y `PickingSummaryModal` guardan la foto del pallet leyendo el arreglo y reescribiéndolo**
  (`ShipScreen.tsx` ~2660-2770, `PickingSummaryModal.tsx` ~183-192). DCV ya usa
  `append_pallet_photo` (`20260925170448`); estas dos no. Una foto tomada en Ship puede borrar la que
  acaba de subir el piso, y desde `ec612bb` el modo vista también fotografía.
- **Al completar un grupo, el carrito copia las fotos de la ancla encima de las de cada hermana**
  (`PickingCartDrawer.tsx` ~885-901, `.update({ pallet_photos }).in('id', siblingIds)`). Las fotos
  propias de una hermana se pierden; las tres de WILMETTE quedaron con las mismas 16.

## 3) Objetivo

**Una sola función decide las tarimas; lo que el piso dice se guarda en un solo sitio; Double Check
y Ship cuentan igual.**

**Métricas** (mismo replay, envíos de 30 días): tarimas de niño sin contar 32 → **0**; `pallets_qty`
≠ filas de Ship 21 → **sólo** donde la estación tecleó otra cosa a propósito (y se ve en ámbar);
unidades de bici en cajas sin medir 20 % → **< 5 %** en 60 días.

## 4) Diseño

**D1 · `planPallets` — la única función de reparto.** Pura, en `src/features/picking/pallets/`, con
tests. Entrada: las líneas, el catálogo (bici / niño / e-bike / medidas) y **lo que dijo el piso**.
Salida: las tarimas, cada una con sus líneas, su tipo (grande / niño) y su ordinal. Reglas, escritas
una vez:

1. Las bicis de niño **nunca** comparten tarima con las grandes. Hasta 2 viajan en el hueco de la
   última grande; pasadas de 2 son su propia tarima, o las que diga el piso (`split`), repartidas
   parejas.
2. Una carga **sin bicis grandes** siempre tiene al menos una tarima (❓2).
3. Las partes viajan encima de la última tarima grande; la e-bike ocupa sitio pero se declara aparte.
4. Lo que dijo el piso (`bikes` por tarima) manda; lo demás conserva lo calculado y la última tarima
   libre absorbe la diferencia, sin pasar nunca del total de la orden (`applyBikeCounts`, en prod).
5. No inventa filas para cuadrar con un número tecleado.
6. No muta su entrada.

La usan **los cinco** sitios de R1. `redistributeWithOverrides` y los `filter(!isParts)` se borran.

**D2 · Un hogar: `picking_lists.pallet_dims`, una entrada por tarima.** Ya comparte DCV ↔ Ship,
fusiona por ordinal entre dispositivos y no escribe por tecla (`usePalletDims`). Guarda lo que dice
el piso de **cada tarima**: `bikes`, `split` (en la de niño), `parts`, medidas. Sin columnas nuevas.
`pallets_qty` sigue siendo la cifra de los cuatro números, pero **derivada** de `planPallets` al
completar (cuenta la de niño).

**D3 · Double Check: el mismo gesto de hoy, ahora guardado.** Tocar la cifra de un pallet y teclear N
ya existe; escribe `pallet_dims[N].bikes` en vez de `useState`. La tarima de niño muestra «+» / «–»
como en Ship.

**D4 · Ship: la estación corrige lo que el piso no dijo.** Tocar la cifra de bicis de una fila abre
el mismo campo (❓1). El «Pallets says N» en ámbar se queda para cuando la estación teclea otro total.

**D5 · El catálogo aprende del piso.** Cuando una tarima lleva menos bicis de las que calculó el
reparto, sus cajas sin medir suben en `/export/measure` con el motivo (❓5). Empezar por las seis de §1.

**D6 · Un catálogo de líneas para las tres pantallas.** `useCartSkuMeta`: una consulta con caché que
entrega los conjuntos de bici / niño / e-bike, las medidas y los pesos, y una bandera `isReady` que
bloquea todo guardado automático hasta que llega (la trampa de bug-021: un render sin catálogo cuenta
una bici como parte). `resolveBikeSets` sale de `bikeDetection.ts` a `picking/api/`, y
`bikeDetection.ts` queda puro.

## 5) Decisiones para Rafael

| ❓  | Pregunta                                                                                         | Default propuesto                                         |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | ¿La estación puede corregir en Ship cuántas bicis lleva una tarima, además de DCV?               | **Sí**, tocando la cifra; mismo campo, mismo guardado     |
| 2   | Una orden sólo de niño con 1–2 bicis (#881450, #881403): ¿una tarima?                            | **Sí**, toda carga regular con bicis declara al menos una |
| 3   | Si la estación teclea un total de Pallets distinto de las filas, ¿quién manda para Audit Source? | **Lo tecleado** (como hoy), con el ámbar a la vista       |
| 4   | ¿Recalcular `pallets_qty` de órdenes ya enviadas?                                                | **No**; sólo desde el deploy                              |
| 5   | ¿El piso corrigiendo una tarima manda sus cajas sin medir arriba en la cola de Measure?          | **Sí**                                                    |

## 6) Plan

**Primero extraer, después arreglar.** Cada extracción se empuja sola y con **paridad exacta**: la
pantalla da lo mismo antes y después. Cada arreglo va en su propio commit, encima de lo extraído, y es
lo único que cambia resultados. Cifras de líneas: estimación del inventario de agy, contadas en el
código.

| Paso                      | Qué                                                                                                                                      | Compuerta                                         | Sale de los monolitos |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------- |
| **A** · arreglo           | Fotos atómicas en Ship y `PickingSummaryModal`; el carrito deja de pisar las fotos de las hermanas                                       | foto de prueba en Ship sin borrar la del piso     | ~116 de Ship          |
| **0** · extraer           | `resolveBikeSets` a `picking/api/`; `bikeDetection.ts` sin Supabase                                                                      | tests actuales                                    | —                     |
| **1** · extraer           | `pallets/planPallets.ts` (hoy: los cinco repartos tal cual, con opciones) en Ship, DCV y el carrito                                      | replay de 90 días: **0** diferencias por pantalla | ~166                  |
| **2** · extraer           | `pallets/weights.ts` (medias, tara, total)                                                                                               | mismos números en 100 órdenes reales              | ~99 de Ship           |
| **3** · extraer + arreglo | `useCartSkuMeta` (D6); aparte, los cinco prefijos de bici en el primer render de DCV                                                     | mismos conjuntos de bici y de niño                | ~167                  |
| **4** · extraer           | Una sola forma de juntar hermanas (R7)                                                                                                   | tests con combinadas reales                       | ~145                  |
| **F0** · arreglo          | Sobre `planPallets`: la tarima de niño cuenta (R2), niño nunca mezclado (R4), carga sin grandes = 1 tarima, el «N» de DCV se guarda (R3) | replay: sólo cambian los casos de §1              | —                     |
| **F1** · arreglo          | D3 y D4: DCV y Ship escriben `bikes` y `split` con el mismo gesto; revisión a 430 px apaisado                                            | una orden real con niño, en los dos lados         | —                     |
| **F2** · continuo         | D5: las seis cajas de §1 a Measure ya; el piso corrigiendo sube cajas en la cola                                                         | % semanal de unidades de bici en cajas sin medir  | —                     |

Unas **~700 líneas** salen de `ShipScreen`, `DoubleCheckView` y `PickingCartDrawer`, y todo lo movido
queda con tests. La lentitud de Ship (idea-226) va aparte: su causa es la carga secuencial de
`fetchOrders`, que bloquea toda la lista, y tiene su propia investigación en el backlog.

## 7) Fuera

Clase NMFC; foto por pallet; FedEx (su tabla de cartones no usa este reparto); combinar órdenes por
cliente (ya arreglado el trigger en `20260926150613`).

## 8) Riesgos

- **Cambiar la cifra de pallets cambia lo que se teclea en Audit Source.** Es el objetivo, pero la
  estación lo va a notar: una línea en What's new cuando salga F0.
- **Merge entre dispositivos:** `bikes` escrito desde DCV y desde Ship sobre el mismo ordinal gana el
  último campo a campo, como ya hacen las medidas.
- **Ordinales:** si la orden se corrige después de teclear, una tarima puede cambiar de contenido y su
  `bikes` quedar viejo. La huella `units` ya existe para las medidas; se usa igual para `bikes` (se
  pinta en ámbar, no se borra).
- **Dependencias ocultas al extraer:** `totalWeight` y `declaredPallets` en Ship cierran sobre
  `formData`, el filtro de sub-orden, `skuMeta` y `palletDimEntries`; una función pura tiene que
  recibirlos todos como argumentos o se pintan números de un render atrás.
