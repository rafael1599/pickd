# PRD: Un pallet, una cuenta — lo que arma el piso, contado igual en Double Check y en Ship

**Estado:** Propuesto, esperando las ❓ de Rafael · **Fecha:** 2026-09-26 · **Autor:** Rafael + PickD
(estudio de agy verificado y corregido por Claude contra prod) · **Backlog:** bug-045; toca idea-226 ·
**Continúa:** `ship-pallet-dimensions.md` (su D1, «persistir el reparto de pallets como entidad
real», quedó fuera del MVP; este PRD es eso) · **Relacionado:** `ship-ebike-declaration.md`,
`/export/measure`, `docs/warehouse-ui-rules.md`

---

## 1) Contexto y problema

Ship existe por cuatro números —pallets, bikes, parts, weight— y por la tabla de pallets que pide el
portal del carrier (tamaño y peso por bulto). Un número mal es un envío mal.

**El 25 sep, WILMETTE** (#881735 / #881644 / #881645, 56 bicis: 31 grandes + 25 de niño) salió en
**5 tarimas**: grandes 11 / 10 / 10 y de niño 13 / 12. Ship declaraba **4**: 12 / 12 / 7 y un bulto
de niño de 25. Hubo que corregirlo a mano en la base (`0229a43`, `2d51f83`).

No fue un caso raro. **Medido en prod con las funciones reales del repo** (envíos regulares
completados; un envío = una orden suelta o un grupo `general`/`pickup`):

| Últimos 30 días (214 envíos con bicis)                                                   |       Cifra |    % |
| ---------------------------------------------------------------------------------------- | ----------: | ---: |
| Llevan **tarima de niño** (más de 2 de niño) y Double Check **no la cuenta** como pallet |          32 | 15 % |
| `pallets_qty` guardado ≠ filas que declara Ship                                          |          21 | 10 % |
| Unidades de bici despachadas en **cajas sin medir**                                      | 242 / 1.207 | 20 % |
| Unidades de bici con el **peso por defecto** (45 lb, sin báscula)                        | 192 / 1.207 | 16 % |

A 90 días (656 envíos, 3.494 unidades de bici): 42 envíos con tarima de niño, las 42 sin contar;
755 unidades en cajas sin medir (22 %); 564 con 45 lb de defecto. Las cajas sin medir que más salen
son **las de WILMETTE**: CITIZEN 2 S/T `03-3990TL` (51 u en 30 días), `03-3989GY` (36), y después
`03-4703GY` (19), `03-4706GY` (17), `03-4709BR` (15), `03-4712BR` (10).

Casos concretos que el replay encontró: **#881418** (22 de niño, ninguna grande) — Double Check cuenta
**0 pallets**; **#881450** (2 de niño) y **#881403** (1) — ni Double Check ni Ship declaran **ninguna**
tarima; #881568/#881662, #881449/#881468, #881623, #881373/#881622 — la tarima de niño no entra en
`pallets_qty`.

## 2) Las causas, no los síntomas

**R1 · El reparto se calcula en tres sitios, con tres reglas.**

| Dónde                      | Qué hace                                                                                                                     | Archivo                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Double Check, pantalla     | `calculatePalletsWithBikeAwareness` + los «este pallet lleva N» del picker                                                   | `DoubleCheckView.tsx` ~820       |
| Double Check, al completar | `getOptimizedPickingPath` → `calculatePalletsWithBikeAwareness` → `filter(!isParts).length` → `pallets_qty`                  | `PickingCartDrawer.tsx` ~800-830 |
| Ship, tabla                | `calculatePalletsWithBikeAwareness` → `applyBikeCounts` → `buildPalletDeclaration` (niño con fila propia pasadas 2, `split`) | `ShipScreen.tsx` ~915            |

Mismo hecho —cuántas tarimas y qué lleva cada una—, tres respuestas.

**R2 · La tarima de niño no cuenta como pallet.** El contenedor de niño sale del reparto con
`isParts: true` (`containerKind: 'smallBikes'`), así que `physicalPalletCount = pallets.filter(p =>
!p.isParts).length` (DCV ~846) y el cálculo al completar la dejan fuera. Ship sí la declara. Una orden
**sólo de niño** llega a tener 0 pallets.

**R3 · Lo que dice el piso no tiene un solo hogar.** El «este pallet lleva N» de DCV es `useState`
(~626) y muere al cerrar; el número total de pallets viaja por `overriddenPalletCountRef` sólo al
completar; las tarimas de niño (`split`) y las bicis por pallet (`bikes`) viven desde ayer en
`pallet_dims` pero sólo Ship las lee y **ninguna pantalla** permite teclear `bikes`.

**R4 · Corregir un pallet en DCV rompe el reparto.** `redistributeWithOverrides`
(`utils/pickingLogic.ts` ~195) junta todas las líneas en un montón, llena los pallets fijados en orden
y reparte el resto con `calculatePallets` —sin reglas de bici—: en WILMETTE metió **4 de niño** en un
pallet grande.

**R5 · El reparto adivina sobre cajas sin medir.** La geometría supone 55 × 8.5 × 30.5 para una caja
que nadie midió y le caben 12 bicis donde el piso mete 10. El piso lo corrige cada vez; el catálogo
no se entera.

> Lo que el estudio de agy dijo y **no** se sostiene: que Ship es lenta por el cálculo de pallets
> (la investigación de idea-226 la atribuye a la carga secuencial de `fetchOrders`, que bloquea toda
> la lista); que bug-038 trata de combinadas (son gemelas de color en el archivo de FedEx); y sus
> cifras de «142 órdenes / 5 de 38», que no reprodujo nadie.

## 3) Objetivo

**Una sola función decide las tarimas; lo que el piso dice se guarda en un solo sitio; Double Check
y Ship cuentan igual.**

**Métricas** (mismo replay, envíos de 30 días): tarimas de niño sin contar 32 → **0**; `pallets_qty`
≠ filas de Ship 21 → **solo** donde la estación tecleó otra cosa a propósito (y se ve en ámbar);
unidades de bici en cajas sin medir 20 % → **< 5 %** en 60 días.

## 4) Diseño

**D1 · `planPallets` — la única función de reparto.** Pura, en `src/utils/palletPlan.ts`, con tests.
Entrada: las líneas, el catálogo (bici / niño / e-bike / medidas) y **lo que dijo el piso**. Salida:
las tarimas, cada una con sus líneas, su tipo (grande / niño) y su ordinal. Reglas, escritas una vez:

1. Las bicis de niño **nunca** comparten tarima con las grandes. Hasta 2 viajan en el hueco de la
   última grande (la regla de hoy); pasadas de 2 son su propia tarima, o las que diga el piso
   (`split`), repartidas parejas.
2. Una carga **sin bicis grandes** siempre tiene al menos una tarima (❓2).
3. Las partes viajan encima de la última tarima grande; la e-bike ocupa sitio pero se declara aparte
   (sin cambio).
4. Lo que dijo el piso (`bikes` por tarima) manda; lo demás conserva lo calculado y la última tarima
   libre absorbe la diferencia, sin pasar nunca del total de la orden (`applyBikeCounts`, ya en prod).
5. No inventa filas para cuadrar con un número tecleado.

La usan **las tres**: la pantalla de DCV, el `pallets_qty` al completar y la tabla de Ship.
`redistributeWithOverrides` y el `filter(!isParts)` se borran.

**D2 · Un hogar: `picking_lists.pallet_dims`, una entrada por tarima.** Ya comparte DCV ↔ Ship,
fusiona por ordinal entre dispositivos y no escribe por tecla (`usePalletDims`). Se queda con lo que
dice el piso de **cada tarima**: `bikes`, `split` (en la de niño), `parts`, medidas. Sin columnas
nuevas; `bikes` y `split` ya existen. `pallets_qty` sigue siendo la cifra de los cuatro números, pero
**derivada** de `planPallets` al completar (cuenta la de niño).

**D3 · Double Check: el mismo gesto de hoy, ahora guardado.** Tocar la cifra de un pallet y teclear N
ya existe; en vez de `useState` escribe `pallet_dims[N].bikes`. La tarima de niño muestra «+» / «–»
como en Ship. Nada nuevo que aprender.

**D4 · Ship: la estación corrige lo que el piso no dijo.** Tocar la cifra de bicis de una fila abre
el mismo campo (❓1). El «Pallets says N» en ámbar se queda para cuando la estación teclea otro total.

**D5 · El catálogo aprende del piso.** Cuando una tarima lleva menos bicis de las que calculó el
reparto, sus cajas sin medir suben en `/export/measure` con el motivo («el piso metió 10 donde el
cálculo decía 12») (❓5). Empezar por las seis de la tabla de §1.

## 5) Decisiones para Rafael

| ❓  | Pregunta                                                                                         | Default propuesto                                         |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | ¿La estación puede corregir en Ship cuántas bicis lleva una tarima, además de DCV?               | **Sí**, tocando la cifra; mismo campo, mismo guardado     |
| 2   | Una orden sólo de niño con 1–2 bicis (#881450, #881403): ¿una tarima?                            | **Sí**, toda carga regular con bicis declara al menos una |
| 3   | Si la estación teclea un total de Pallets distinto de las filas, ¿quién manda para Audit Source? | **Lo tecleado** (como hoy), con el ámbar a la vista       |
| 4   | ¿Recalcular `pallets_qty` de órdenes ya enviadas?                                                | **No**; sólo desde el deploy                              |
| 5   | ¿El piso corrigiendo una tarima manda sus cajas sin medir arriba en la cola de Measure?          | **Sí**                                                    |

## 6) Plan por fases

**F0 · Hoy duele (1 día).** Arregla R2, R4 y la mitad de R3 sin reescribir nada:

- La tarima de niño cuenta: `physicalPalletCount` y el cálculo al completar cuentan lo mismo que las
  filas de Ship. Carga sin grandes = al menos una tarima.
- `redistributeWithOverrides` deja intacto el bulto de niño y reparte el resto con reglas de bici.
- El «este pallet lleva N» de DCV se guarda en `pallet_dims[].bikes` (un `setBikes` en
  `usePalletDims`); Ship ya lo aplica.
- Tests con WILMETTE, #881418 y #881450. Se verifica abriendo una orden real con niño en DCV y en Ship.

**F1 · Una sola función (2–3 días).** `planPallets` (D1) y las tres llamadas pasan a ella. Se borran
`redistributeWithOverrides` y los conteos duplicados. **Compuerta:** el replay de 90 días
(`label-bench/ship-plan/scripts/ship-stats-claude.mts`) da las mismas filas que Ship hoy salvo los
casos de §1, que tienen que quedar corregidos.

**F2 · Ship edita (1 día).** D4, y revisión a 430 px apaisado.

**F3 · Catálogo (continuo, desde F0).** Las seis cajas de §1 a la cola de Measure esta semana; D5
cuando F1 esté. Métrica semanal: % de unidades de bici despachadas en cajas sin medir.

**F4 · Ship rápida (idea-226, aparte).** Su causa es la carga, no el cálculo: pintar la lista con una
proyección ligera y traer `items` y `sku_metadata` detrás. Tiene su propia investigación en el
backlog y va en su propio PRD; no depende de F0–F3.

## 7) Fuera

Clase NMFC; foto por pallet; FedEx (su tabla de cartones no usa este reparto); combinar órdenes
(`label-bench/agrupado/`, ya arreglado el trigger en `20260926150613`).

## 8) Riesgos

- **Cambiar la cifra de pallets cambia lo que se teclea en Audit Source.** Es el objetivo, pero la
  estación lo va a notar: una línea en What's new cuando salga F0.
- **Merge entre dispositivos:** `bikes` escrito desde DCV y desde Ship sobre el mismo ordinal gana el
  último campo a campo, como ya hacen las medidas. Aceptable; lo contrario es un bloqueo.
- **Ordinales:** si la orden se corrige después de teclear, una tarima puede cambiar de contenido y su
  `bikes` quedar viejo. La huella `units` ya existe para las medidas; se usa igual para `bikes` (se
  pinta en ámbar, no se borra).
