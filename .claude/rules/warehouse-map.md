---
paths:
  - 'src/features/warehouse-map/**'
  - 'docs/warehouse-*.md'
  - 'public/warehouse/**'
---

# El mapa del almacén (`src/features/warehouse-map/`)

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

- `src/features/warehouse-map/` — **El mapa del almacén** (MAP en la barra de navegación —solo
  escritorio, 31 ago 2026— y menú → Map, `/warehouse-map`; sin sesión
  en `/public-warehouse-map`). Mide el edificio real: `engine/blueprint.ts` (la tabla `M` en pulgadas,
  la geometría, las 8 zonas libres, las 3 bahías y los **diez cross-checks, que son tests**),
  `engine/zones.ts` (las seis zonas, cada cifra comentada con su medida), `engine/palletEngine.ts`
  (filas, bloques, halls, slots, postes — puro, 54 casos de paridad con el JS original),
  `stock/rowStock.ts` (el stock de `inventory` sobre cada `ROW n · letra`; lo que no cabe se lista,
  nunca se esconde), `plan/slotPlan.ts` + `hooks/useZoneEditor.ts` (**PLAN**, idea-173: levantar **el
  pallet de un cuadro** y soltarlo en otro — vacío va, una línea intercambia, varias se une; una
  línea repartida en varios cuadros se mueve cuadro a cuadro (la mano lleva el `qtyHere` del cuadro
  tocado y un ghost se re-identifica por el id de su move — nunca por `inventoryId`, que era el bug
  del 31 ago donde el segundo move del mismo SKU redirigía al primero); `PLAN COMPLETED` lo
  ejecuta con `updateItem` en la misma fila / `moveItem` a otra, revalidando cada línea; tablas
  `slot_plans` / `slot_plan_moves`, un borrador por zona; **cada move tiene autor**
  (`origin`, migración `20260831194416`): **`hand`** es un gesto de Rafael y queda **fijo** —los
  pases planean _alrededor_, solo él lo cambia volviéndolo a mover— y **`auto`** (DISTRIBUTE y las
  reparaciones) es lo único que el plan puede reescribir; un pallet grande **se despliega al
  soltarlo** (`spreadDrop`, la fila que señaló primero) porque después queda bloqueado, y el dibujo
  pinta lo suyo con borde sólido y lo calculado punteado. **MAS se dibuja**: el pasillo sur es un
  sitio, no una lista — soltar ahí aparca la línea y cada una tiene su propia pieza, del ancho de
  los pallets que necesita, una al lado de otra y delante de su bloque (`plan/masLayout.ts`, dos
  carriles de 60" en los 120" del pasillo; nunca se mezclan). **Con una línea en la mano** el
  dibujo se apaga al 30 %, solo se ilumina el cuadro bajo el puntero y la pieza sigue al cursor;
  el resaltado por SKU se retira mientras tanto para que los dos gestos no se pisen. Precedente: _lock delay_ de Tetris,
  `Lock Assignment` de Siebel y el booking lock de Dynamics —el optimizador incluye lo bloqueado en
  el horario, no lo ignora—; **LIVE** = mismo gesto + confirmación;
  **30 u por cuadro es la norma y 45 el tope duro** — `PALLET_UNITS` = 30 (DISTRIBUTE reparte a 30,
  la capacidad cuenta 30), `SQUARE_MAX` = 45 (Rafael, 31 ago 2026: "no puede haber un cuadro con 46
  o más"): entre 31 y 45 un cuadro pesa pero no alarma; **sobre 45 sale la `!` y PLAN lo reparte
  solo** (efecto en `useZoneEditor` — ghosts en el draft, nada se mueve hasta PLAN COMPLETED).
  `repairOverCap` son tres pases, cada uno un paso asentado (el primero con algo que decir manda y
  el siguiente render ve el resultado): **A** un aterrizaje que necesita más cuadros de los que
  nombra (soltar a mano lleva el pallet entero), **B** un cuadro sobre el tope porque **dos líneas
  distintas lo comparten** (nadie es grande solo: se manda la más pequeña a otro cuadro) y **C** lo
  aparcado en MAS mientras haya cuadros libres. `distribute` cubre la línea viva que nunca cupo, y
  **ya no salta las líneas que tienen un move**: planea sobre lo que queda (`remainingAt`), que es
  lo que hace idempotente correrlo dos veces. **`allocate` reparte parejo** (159 u en 4 cuadros =
  40/40/40/39): metía 30 en cada uno y el resto en el último, e inventaba cuadros de 69 que nadie
  veía en el piso — era la raíz del 31 ago;
  **el espacio va primero y lo que no encuentra cuadro va a `MAS`**, el suelo del
  pasillo principal sur delante de su bloque (Rafael, 31 ago 2026: "el algoritmo debería priorizar
  llenar el espacio primero"; `OVERFLOW_LOCATION` en `plan/slotPlan.ts`, la ubicación se renombró de
  `MAIN HALL` en `20260831165650`) — nunca un segundo SKU apretado en un cuadro ocupado, ni MAS con
  cuadros libres: `repairOverCap` rescata lo aparcado en MAS en cuanto hay sitio) y las
  pantallas (`MasterMap`, `ZoneView`, `ZoneSvg`; estado y
  modo en la URL; hover o tap en un cuadro ilumina todos los cuadros de ese SKU, vivos y planeados). **Dos botones solamente desde el 31 ago 2026: PLAN y LIVE** (Rafael: "compactar a
  2… lo menos compleja posible la interfaz"); el reposo es VIEW (el stock, sin botón — tocar el modo
  activo lo apaga) y **LAYOUT** (las medidas) solo se alcanza con `?mode=layout`. **Las pulgadas van en el hover en todos los modos, VIEW incluido** (6 oct 2026: primero PLAN y LIVE, luego "en cuanto entre a la vista de una bay, sin que tenga que hacer click en live o plan") (6 oct 2026, Rafael: "modo live y modo plan que me muestren medidas en hover"): cuadro, fila e isla al final del texto del cuadro, el bloque de bicis y, el mismo día, los pasillos ("has que se pueda hacer hover en los mismos") — `hoverMeasures` en `ZoneSvg`, sin dibujar medidas y sin redimensionar un pasillo (eso es LAYOUT); dibujadas en el plano, solo en LAYOUT. La orientación, el
  WEST HALL y los presets salieron de la interfaz igual que los sliders del pallet: viven en la URL
  (`rows=ew`, `west=1`, `preset=center|solid`) con default N–S y **west hall apagado**
  (`TOGGLE_DEFAULT` en `hooks/useZoneState.ts`). Nació como
  HTML estático en `public/warehouse/` (11 ago) y reemplazó por completo la vista Plan/Live el 28 ago
  2026 (idea-170; historia en `docs/warehouse-floor-plans.md`). **CRÍTICO:** todo layout cumple
  `docs/warehouse-ui-rules.md` (los cuatro contadores, pallet `60×62` fijo — **sin sliders** desde el 28 ago —, "hall" nunca
  "aisle") y se guía por `docs/warehouse-measurements.md`. **Bay 1 no está medido** (Rafael, 28 ago:
  "todo el que se ve no es el real"): sus contadores no se citan hasta tener las medidas.
