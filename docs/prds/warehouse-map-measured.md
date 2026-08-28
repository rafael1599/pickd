# PRD: El mapa con medidas reemplaza por completo la vista Warehouse Map

**Estado:** F1 y F2 construidas 2026-08-28 — Rafael aprobó las cinco propuestas por defecto ("ok todo, arranca F1") · **Fecha:** 2026-08-28 · **Autor:**
Rafael + PickD · **Backlog:** idea-170 · **Relacionado:** `docs/warehouse-floor-plans.md` (la decisión
del 11 ago de tenerlos separados, que este PRD revierte), `public/warehouse/` (el mapa que funciona),
`src/features/warehouse-management/` (la vista que se va), PRD `warehouse-real-stock-map.md` (la
pestaña Live, absorbida aquí)

---

## 1) Contexto y problema

Hoy hay **dos mapas del almacén que no se hablan**:

- **`/warehouse-map` (la app, menú → Map).** Dos pestañas. _Plan_: el plan de pallets DS de tres
  bloques (ROW 31–33) con no-movers, guardado en `warehouse_overstock_plans`. _Live_: una fila a la
  vez (`ROW n`) como cuadrícula de sublocaciones A–F con el stock real. Ninguna sabe dónde está la
  fila en el edificio, cuánto mide, ni cuántos pallets caben: dibuja letras en una tabla.
- **`/warehouse/…` (HTML estático, `public/warehouse/`).** El edificio medido: tres bahías a escala,
  seis zonas, `PalletEngine` que calcula pallets · bikes · fast picking · hits con el tamaño de pallet
  en los sliders, toggles N–S / E–W y de halls, postes, editor de obstáculos. **Las filas del motor ya
  llevan el número de la base de datos** (`rowRange` 33→18 en Bay 3 Norte, 34→40 en Bay 3 Sureste,
  11→17 en Bay 2 Sur, 10→1 en Bay 2 Norte, 41+ en Bay 1) y cada slot se llama `ROW n · letra`, igual
  que `inventory.location` + `sublocation`. Es la geometría que falta en la app, con la llave puesta.

Además, `zone.html` ya tiene un **SLOTTING VIEW** (`de574c5`, 19 ago) que llena Bay 3 con SKUs reales
por velocidad, con heatmap, pines y lista de movimientos — pero apunta a `http://127.0.0.1:54321` y a
una RPC `get_bay3_fill_candidates` que **solo existe en la DB local** (no está en
`supabase/migrations/` ni en prod). Funciona en un solo Mac con el stack levantado.

Rafael (28 ago 2026): "la vista warehouse map será reemplazada por completo por el mapa con las medidas
que ya tenemos funcionando".

## 2) Objetivo

**Un solo mapa**, el medido, dentro de la app: se abre desde el menú, dibuja el edificio con sus
números (los cuatro contadores de `WAREHOUSE-UI-RULES.md`), y sobre cada slot pinta lo que la base de
datos dice que hay ahí. Lo que hoy hace Live (stock real por sublocación) y lo que hoy hace Plan
(proponer dónde va cada SKU) pasan a ser capas de ese mapa, no pantallas aparte.

**Métrica:** cero pantallas de mapa sin medidas; un slot del dibujo = una `location`/`sublocation` de
la DB, en las dos direcciones.

## 3) Usuarios

Rafael y quien planifique el piso (mapa + propuesta); pickers y stackers en el teléfono (¿qué hay en
ROW 33 D?, ¿cuál está libre?); Carine por enlace público (la propuesta de Bay 3 se compartió así).

## 4) Alcance

**Dentro:** la geometría en la app; los cuatro contadores; toggles y sliders; stock real por slot;
retirar Plan y Live; `/public-warehouse-map` sigue siendo el enlace para compartir.
**Fuera (esta fase):** la propuesta automática (slotting) en prod — es la fase 2 y necesita su
migración; mover inventario desde el mapa (eso sigue en Consolidation / Movement); borrar tablas.

## 5) Lo que hay hoy, verificado (28 ago 2026)

| Qué                     | Dónde                                                                                                                       | Estado                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Geometría + motor       | `public/warehouse/zones.js`, `PalletEngine.js` (1.090 l.)                                                                   | Funciona. Sin tests: los 10 cross-checks viven en el HTML del blueprint                                                        |
| Zonas                   | `bay3_north`, `bay3_se`, `bay2_north`, `bay2_south`, `bay1_north`, `bay1_office_gap`                                        | Bay 1 Norte y el office gap repiten `rowRange` 41→100 (etiquetas duplicadas)                                                   |
| Slotting (propuesta)    | `zone.html` líneas 784–1160                                                                                                 | Solo Bay 3, solo local: URL y llave de `127.0.0.1` a mano, RPC sin migración                                                   |
| Editor de piso, configs | `zone.html` + `localStorage`                                                                                                | Por navegador; nada llega a la DB                                                                                              |
| Móvil                   | `zone.html`: 1 `@media`; `warehouse_map.html`: 0                                                                            | Se hicieron para escritorio                                                                                                    |
| Plan (app)              | `DsPalletPlanView` + 7 hooks + `src/utils/dsPalletPlanner.ts`                                                               | Prod: `warehouse_overstock_plans` 3 filas, `warehouse_no_movers` 36, `warehouse_block_settings` 3, `warehouse_excluded_skus` 0 |
| Live (app)              | `WarehouseLiveMap` + `WarehouseGrid` + `useRealInventoryMap`                                                                | Una fila a la vez; letras A–F + las que aparezcan                                                                              |
| Filas con stock en prod | ROW 1–10, 15–17, 20–30, 32–34, 37–38, 41–43, 51                                                                             | Más `ROW 20B`, `ROW 42 BURIED`, `ROW X EP`, que no son filas del motor                                                         |
| Sublocaciones en prod   | A–K                                                                                                                         | K en ROW 27–33; el motor dibuja A–J en Bay 3 Norte (10 de fondo)                                                               |
| Sin sublocación         | ROW 10 (16 de 18 líneas), ROW 32 (10 de 11)                                                                                 | Hoy Live los lista en un aviso ámbar                                                                                           |
| Se queda sí o sí        | `LocationList`, `LocationEditorModal`, `UserManagement`, reports (Settings); `get_sku_movement_stats_batch` (Consolidation) | No son el mapa aunque vivan en la misma carpeta                                                                                |

## 6) Requerimientos

| ID     | Requerimiento                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-001 | `/warehouse-map` (menú → Map) abre el **mapa maestro**: tres bahías a escala, espacio libre por zona, tocar una zona abre su layout. Mismos números que hoy imprime `warehouse_map.html`.                                                                     |
| RF-002 | Cada zona muestra **PALLETS · TOTAL BIKES · FAST PICKING** anclados arriba (y **HITS** si hay postes), sliders de pallet (60" D × 62" W por defecto), toggles N–S / E–W y de halls, hover, postes en rojo, **← MAP**. Es `WAREHOUSE-UI-RULES.md` sin cambios. |
| RF-003 | El motor vive **una sola vez**, en TypeScript puro (`engine/`), con tests: los diez cross-checks del blueprint y los totales de cada zona son casos de test, no texto bajo un dibujo.                                                                         |
| RF-004 | **Stock real por slot:** cada `ROW n · letra` del dibujo pinta las filas de `inventory` con `location = 'ROW n'` y esa letra en `sublocation` (SKU, unidades, color por familia como hoy). Un slot vacío se ve vacío. Reemplaza a Live.                       |
| RF-005 | Tocar un slot con stock abre el detalle que ya existe (`sku-locations` / `item-detail` por el Modal Manager); nada de paneles propios.                                                                                                                        |
| RF-006 | Lo que la DB dice y el dibujo no tiene sitio (letra K, `ROW 20B`, `ROW 42 BURIED`, `ROW X EP`, líneas sin sublocación) se **lista junto a la fila**, con unidades — nunca se inventa un slot ni se esconde (ver ❓ Q5).                                       |
| RF-007 | Plan y Live se **eliminan** con sus hooks y `dsPalletPlanner.ts` cuando RF-004 esté en prod; las tablas `warehouse_*` se quedan (regla aditiva). `IntegratedMapManager` y lo de Settings no se tocan.                                                         |
| RF-008 | `/public-warehouse-map` muestra el mismo mapa sin sesión (geometría y contadores; sin stock si RLS no deja) — es el enlace que se manda a Carine.                                                                                                             |
| RF-009 | Se revisa en **teléfono apaisado (~430 px)**: el mapa maestro y una zona tienen que poder verse y tocarse ahí (pan/zoom), sin HUD fijo que tape el dibujo.                                                                                                    |
| RF-010 | **Fase 2 — propuesta:** el slotting de `zone.html` pasa a la app como capa "Propuesta" sobre RF-004, con `get_bay3_fill_candidates` en una migración y sin URL a mano. Heatmap, pines y lista de movimientos vienen con él. No bloquea la fase 1.             |

## 7) Casos de verificación (números exactos)

| #   | Caso                                             | Esperado                                                                                 |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| V1  | Bay 3 Norte, N–S, west hall puesto, pallet 60×62 | 138 pallets · 4.140 bikes · 90 fast · 2 hits (postes)                                    |
| V2  | Bay 3 Norte, west hall quitado                   | 157 · 4.710 · 109 · 3 hits; halls 78" → 67"                                              |
| V3  | Bay 3 Sureste                                    | 29 pallets · 870 bikes · south hall 114"                                                 |
| V4  | Bay 2 Norte                                      | 94 de 96 brutos · 3.108 bikes · fast = 94                                                |
| V5  | Mapa maestro                                     | Bay 1 7.830 · Bay 2 5.928 · Bay 3 9.779 sq ft libres; total 37.478 / 23.536              |
| V6  | ROW 33 en prod (845 u en A, B, D, E, K)          | A, B, D, E pintadas en la fila 33 de Bay 3 Norte; K listada como "sin sitio en el plano" |
| V7  | ROW 10 (16 líneas sin sublocación)               | Fila 10 de Bay 2 Norte con sus 2 líneas en D y un aviso con las 16 restantes             |
| V8  | ROW 43 (1.028 u en A, B, D, E, F)                | En Bay 1 Norte, fila 43                                                                  |
| V9  | Cambiar el slider a 65" D                        | Los cuatro contadores cambian en el acto; el stock sigue en su `ROW n · letra`           |

## 8) Fases

- **F0 ✅ (28 ago):** este PRD + idea-170. "ok todo" a las cinco ❓.
- **F1 ✅ (28 ago) — Motor a TS con tests.** `src/features/warehouse-map/engine/`: `zones.ts`,
  `palletEngine.ts` (`calculateLayout`, puro), `blueprint.ts` (la tabla `M` en pulgadas, la geometría,
  las 8 zonas libres, las 3 bahías y los diez checks) y `types.ts`. 55 tests: V1–V5 y V9 con los
  números exactos, los toggles de cada página, qué es un slot. **Paridad verificada** contra el JS:
  54 casos (6 zonas × 9 estados) idénticos celda a celda (posición, letra, fast, distancia). Un
  cambio a propósito: el reparto aleatorio de halls alrededor de un poste corre con semilla fija.
  Cero UI; nada de lo que se usa se toca.
- **F2 ✅ (28 ago) — Pantalla.** `src/features/warehouse-map/`: `WarehouseMapScreen` en
  `/warehouse-map` (menú → Map) y en `/public-warehouse-map` (sin sesión, el enlace para Carine);
  Plan/Live siguen en `/warehouse-map/legacy` hasta F4. `MasterMap` (tres bahías, HUD con los
  números al pasar o tocar, tocar una zona abre su layout, RACK MOVE = el `?move=rack` de antes) y
  `ZoneView` (los cuatro contadores arriba, línea de specs, sliders D × W, N–S / E–W, los halls que
  la zona tiene como `toggleable`, HALLS / 1 CENTER / 0 HALLS, tocar un hall lo redimensiona, zoom,
  leyenda) sobre `ZoneSvg` (el `renderSVG` del JS, colores explícitos, `<title>` + línea de medida
  para el teléfono). **El estado va en la URL** (`?zone=bay3_north&west=0&pd=65`; los defaults no se
  escriben) — un layout es un enlace. Revisado por CDP a 430 × 932, 932 × 430 y 1400: sin desbordes.
  **Fuera de F2, a propósito:** el editor de piso y las configs guardadas de `zone.html` (vivían en
  `localStorage` de un navegador) y el slotting (F5).
- **F3 — Stock real.** RF-004/005/006 (V6–V8). Una consulta por zona (`location ILIKE 'ROW %'`).
- **F4 — Retirar.** Plan, Live y sus hooks; `/public-warehouse-map` apunta a la pantalla nueva;
  `docs/warehouse-floor-plans.md` se reescribe (la decisión del 11 ago queda como historia).
- **F5 — Propuesta (fase 2).** RF-010.

## 9) Preguntas — cerradas el 28 ago 2026 con la respuesta por defecto ("ok todo")

- **Q1 — ¿Dónde vive el mapa nuevo?** _Default:_ **se porta a React** (`src/features/warehouse-map/`),
  motor y zonas en TypeScript puro con tests; `/warehouse-map` lo abre. La alternativa rápida —un
  iframe de `/warehouse/…` dentro de la app— no tiene sesión (sin stock real), no se ve en el teléfono
  y deja dos temas visuales; solo vale si lo único que quieres es el acceso desde el menú.
- **Q2 — ¿Qué pasa con `public/warehouse/`?** _Default:_ **se congela hoy y se retira en F4**, cuando
  la app cubra las seis zonas y el blueprint. `WAREHOUSE-MEASUREMENTS.md` y `WAREHOUSE-UI-RULES.md`
  se mudan a `docs/`. Una sola fuente de la geometría: corregir una medida es editar `zones.ts` con
  el mismo diff de siempre, y `bay3_combined.html` (el esquemático a mano) se pierde salvo que se
  redibuje con el motor.
- **Q3 — ¿Qué muestra primero: stock real o propuesta?** _Default:_ **stock real (F3) primero**,
  propuesta después (F5), porque el stock real es lo que usan pickers y stackers cada día y no
  necesita migración; la propuesta necesita `get_bay3_fill_candidates` en prod y decidir su regla
  (hoy: velocidad de 45 días sobre `inventory_logs`, bloques este → oeste, ≥ 90 u al fondo).
- **Q4 — ¿Se borran Plan y Live?** _Default:_ **sí, en F4**, con `dsPalletPlanner.ts` y los siete
  hooks; las tablas `warehouse_*` se quedan (36 no-movers en prod), por si la propuesta las reusa. Lo
  de Settings no se toca.
- **Q5 — Lo que no cabe en el dibujo.** ROW 27–33 usan la letra **K** y Bay 3 Norte dibuja A–J;
  `ROW 20B`, `ROW 42 BURIED` y `ROW X EP` no son filas del motor. _Default:_ **se listan junto a la
  fila** con sus unidades, sin inventar un slot — y si la K existe en el piso, es una medida que falta
  (la profundidad real de esas filas), no un caso del código.

Sin análisis profundo aparte: este PRD es el análisis. F1 (motor a TS con tests) solo depende de Q1 —
si la respuesta es React, arranca sin esperar las otras cuatro.

## 10) Riesgos

- **Dos motores durante F1–F3** (el JS en `public/` y el TS en `src/`). Se acepta porque el de
  `public/` está congelado (última medida: 20 ago); si alguien corrige una medida ahí en ese lapso,
  hay que copiarla. Se cierra en F4.
- **RLS en la ruta pública:** `/public-warehouse-map` con anon no verá `inventory`; la geometría sí.
  Si Carine necesita ver stock, es una decisión aparte (una vista pública recortada), no un bypass.
- **La letra K y las filas fuera del motor** (Q5) son datos que el dibujo no puede representar sin
  otra medida; ocultarlos sería mentir con el mapa.
