# Edit squares: un solo modo para las cajas y las cifras de cada cuadro (idea-258)

Estudio, 7 oct 2026. Maqueta a 430 px: `docs/design/square-edit-mode.html` (12 frames). Sin código.
Cifras de prod leídas el 7 oct por la tarde (`PROD_DB_URL`, LUDLOW, `location ILIKE 'ROW%'`, activas
con stock).

## 1. Contexto y problema

Rafael, 7 oct: «para editar distribución y cantidades por sublocation **los números están muy
chiquitos**… necesitamos trabajar en diseñar **un modo edit con una vista específica** para que sea más
fácil de hacer, rápido e inteligente al mismo tiempo». Y después: «vamos a trabajar en **un solo modal
y lógica que se reutilice en ambos casos**».

**Hoy hay tres editores de lo mismo, los tres pequeños:**

| Dónde                            | Qué es                                                                                                                                                                                                | Tamaño de la cifra que se toca                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Tarjeta de Stock (idea-253)      | `InventoryCard.tsx` → `SquareBoxes` (número → `BoxEditSheet` `number`; letra/dibujo → `letters` + Split; `+` → `add`); en espera con `StockBoxEditProvider` (anillo ámbar, banner, `confirm`, choque) | **13 px**, y el `×` de 9 px entre dos números que se tocan |
| Hoja Move (idea-255, `aff72b53`) | mantener pulsado un pallet → `FixPallet` (Base / Top / Line pallet / Delete), un EDIT al momento, aparte del MOVE; `SplitAsk` «How many in B?»                                                        | 13 px; la pista «Hold a pallet…» a 11 px                   |
| Item detail                      | ⋯ → Distribution → `SectionEditorSheet` (filas de tipo/cuántas/de cuánto, **sin cuadro**)                                                                                                             | campos de formulario                                       |

**Lo que cuesta hoy, medido en prod.** Jed arregló a mano 03-3983GY (ROW 30 y ROW 31, 105 u) a DS
pallets entre las 16:31 y las 16:34: **5 EDIT y su ristra de PHYSICAL_DISTRIBUTION en 3 minutos para
dos filas**, convirtiendo `TOWER 30` en `base 18 + top 12` pallet por pallet. La regla ya sabía la
respuesta (`palletsFor(30)`); la pantalla no se la ofreció.

**Lo que queda por arreglar (prod, 7 oct, 561 filas ROW con stock):**

| Qué                                                                | Filas                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Bici de adulto, un cuadro, ≤ 30 u, cajas ≠ la regla (`palletsFor`) | **432** (366 de ≤ 12: sólo `LINE` → `line pallet`; 28 de 13–18; 38 de 19–30) |
| Bici de adulto, un cuadro con **más de 30**                        | **47** (03-4034BK `ROW 34 · B` 137)                                          |
| Varios cuadros sin reparto (`?`)                                   | **41** de adulto (43 contando niño)                                          |
| Varios cuadros ya repartidos                                       | 4 (2 cumplen la regla)                                                       |
| Cajas de menos (`+n loose`) / de más (`−n extra`)                  | **100** / **6**                                                              |
| Bici de niño (excepción, se arma a mano)                           | 35                                                                           |
| Sin cuadro                                                         | 2                                                                            |
| Partes en un ROW                                                   | **0** (las partes viven en `D7`, `E23`…)                                     |
| Filas que siguen con tipos viejos (TOWER / LINE / PALLET)          | 555                                                                          |

**Ninguna fila de adulto cumple hoy la regla en un solo cuadro** salvo las 2 repartidas: el F4 de
idea-254 («recalcular los datos») está entero por hacer, y este modo puede ser su herramienta, fila a fila
y con un humano delante.

**Hallazgo de paso:** el EDIT que escribe `updateItem` **no guarda las cajas de antes**
(`snapshot_before` = id, sku, quantity, location; los 5 EDIT de Jed lo confirman). Las cajas viejas sólo
sobreviven troceadas en los PHYSICAL_DISTRIBUTION (`change: removed`). El estudio de idea-253 daba por
hecho lo contrario.

**Lo que existe y se reutiliza** (nada de esto se reescribe):

- `palletsFor` / `towersAndLines` / `calculateBikeDistribution` (`src/utils/distributionCalculator.ts`) — la regla.
- `isSmallBikeSku` (`src/utils/bikeDetection.ts`) — niño = sin regla.
- `rowStock`, `stockUnits`, `rowOccupancy`, `toDistribution` (`inventory/utils/moveLoad.ts`) — lo que
  tiene cada cuadro, el `?`, los demás SKUs del cuadro.
- `squaredGroups`, `groupUnits`, `byShowOrder` (`src/utils/boxSquares.ts`).
- `squareChanges`, `boxesMismatch`, `mismatchLabel`, `setGroupNumber`, `moveGroup`, `boxesToSave`
  (`inventory/utils/squareEdit.ts`).
- `useInventory().updateItem` (EDIT + PHYSICAL_DISTRIBUTION), el trigger `keep_inventory_squares`
  (`sublocation` = los cuadros con cajas), `row_squares` (letras de la fila).
- Del lado de la pantalla: la cabecera de la hoja Move (foto, SKU 24 px, ✕), su cifra grande (`text-7xl`,
  la que Rafael señala como tamaño bueno), `SquareStrip`, `DistributionGlyph`, `useConfirmation`, el
  choque `Changed by … — Reload` de `StockBoxEdit`.

## 2. Objetivo

1. Corregir una fila entera **cuadro por cuadro con cifras que se leen y se tocan con el pulgar**, en la
   Zebra de 8" y a 430 px.
2. **La regla propone, la persona acepta.** Un cuadro que no cumple la regla enseña lo que la regla
   pondría; un toque lo acepta. Corregir no es armar grupos a mano.
3. **Un modo, una lógica**, abierto desde la tarjeta, item detail y la hoja Move con la fila como
   entrada. Los tres editores de hoy se borran.

**Métricas:**

- Una fila de un cuadro que no cumple la regla se arregla en **2 toques** (✓ y SAVE + Confirm) y < 10 s;
  la de Jed (03-3983GY ROW 31, dos DS) en 3 toques en vez de 3 EDIT.
- Filas de adulto que no cumplen la regla: **432 + 47 + 41 = 520 → menos de 100 en dos semanas**, sin
  migración de datos a ciegas.
- Ninguna cifra editable por debajo de 28 px ni ningún blanco por debajo de 48 × 48 px (§7).
- `grep` de `BoxEditSheet`, `FixPallet`, `SectionEditorSheet`, `'box-edit'` = 0 al cerrar P1.

## 3. Conceptos

- **Cuadro.** Una letra de la fila con lo que este SKU tiene ahí. **Su cifra** es lo que hay en el piso;
  sus **pallets** (base 18, top 12 🪜, line pallet 1–12; o tower/line en niño) dicen cómo está armado.
  La cifra arranca de la cantidad de la fila (nunca de las cajas): `inventory.quantity` manda.
- **La regla.** Lo que `palletsFor(cifra)` arma para un cuadro de adulto. Si los pallets del cuadro no
  son eso, el cuadro enseña **la propuesta**: el dibujo de la regla, **punteado**, con un ✓. Niño:
  nunca hay propuesta. Parte: no hay pallets.
- **Corregir no es mover.** Todo en este modo es **ámbar**, espera a SAVE y escribe un **EDIT**: dice
  cómo es el piso. Mover pallets en el piso sigue siendo la hoja Move, **verde**, que escribe un MOVE.

## 4. El gesto

El modo es una pantalla completa (Modal Manager, `square-edit`), una fila. Se lee de arriba abajo: la
fila, sus cuadros, el botón.

1. **Arriba, la fila:** `ROW 29` en grande y la cantidad `29`; debajo la **tira de letras** de la fila
   (`row_squares` + las que la fila ya usa): las de este SKU encendidas en ámbar con su cifra, las de
   otros SKUs apagadas con la suya en gris, las vacías punteadas.
2. **Un bloque por cuadro de este SKU** (A→Z): la letra en una casilla ámbar de 48 px, **la cifra a
   56 px**, y sus pallets dibujados a 64 px de alto con su número a 28 px dentro.
3. **Si el cuadro no cumple la regla**, bajo sus pallets sale la propuesta punteada:
   `Rule  base 18 + top 11  [✓]`. **Tocar ✓** pone la propuesta en ámbar. Es la gran mayoría de los
   casos: **un toque**.
4. **Tocar la cifra** abre el teclado numérico del sistema sobre la misma cifra (como `HOW MANY` en
   Move). Lo tecleado es lo que hay en el cuadro:
   - **adulto:** los pallets se rearman solos con la regla (25 → base 18 + top 7);
   - **niño:** los pallets no se tocan; la diferencia sale como montón punteado `+3` (ver 6);
   - si la suma de cuadros ya no es la cantidad, arriba sale ámbar `Qty 29 → 28` (es un conteo, ❓1).
5. **Tocar un pallet** lo levanta (borde ámbar) y abre su barra, inline bajo el cuadro, sin otra hoja:
   - **tipo:** `Base` · `Top 🪜` · `Line pallet` (niño: + `Tower` · `Line`);
   - **su número** a 28 px, tocable (cuántas bicis tiene ese pallet; `count` si son varios iguales);
   - **mover a otro cuadro de la fila:** con un pallet levantado, **tocar una letra de la tira** lo lleva
     ahí (tocar una cosa, tocar dónde va). Una letra vacía nace como cuadro nuevo;
   - **`Delete`**, rojo, con segundo toque. Lo que tenía queda como montón `loose` de ese cuadro.
6. **El montón `loose`** (cajas de menos) se dibuja punteado dentro de su cuadro. En adulto no se
   propone «line pallet 2» aparte: la regla rearma **el cuadro entero** con su cifra (12 en cajas + 2
   sueltas = 14 → **base 14**), porque dos maderas no comparten cuadro y sobre una base sólo va un top
   (reglas 4 y 5 de idea-254). En niño, tocar el montón lo hace `line 2`.
7. **`SAVE · n`**, el único botón, fijo abajo, ámbar, con el antes → después en una línea
   (`F 29 → 29 · base 18 + top 11`). Abre la confirmación (§4 Guardar).
8. **✕** cierra. Con cambios pregunta `Discard 2 changes?` · `[Keep editing] [Discard]` (el aviso que la
   tarjeta ya construyó).

**Ramas:**

| Caso                                                                                           | Qué pasa                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ya cumple** (03-3983GY ROW 30: C DS 30, D base 15)                                           | Sin propuestas; `SAVE` gris `By the rule ✓`. Se puede editar igual                                                                                                                                                         |
| **Un cuadro, ≤ 30, no cumple** (03-3743GN ROW 29 · F · 29, `TOWER 29`)                         | `Rule base 18 + top 11 [✓]`                                                                                                                                                                                                |
| **Varios cuadros, ninguno cumple** (06-4735BK ROW 30: A `line pallet 13`, B `base 15 + top 6`) | Dos propuestas: A → `base 13`, B → `base 18 + top 3`. Un ✓ cada una                                                                                                                                                        |
| **`?`** — varios cuadros sin reparto (03-3983GY ROW 33 · B,C · 58, cajas 5×5+1×3)              | Cada cuadro `?` y una propuesta de reparto arriba: `B 30 · C 28 [✓]` (30 por cuadro A→Z, el último el resto, ❓4). Al aceptar, cada cuadro se arma con la regla. Tocar un `?` teclea su cifra; la última letra es el resto |
| **`−n extra`** (03-3982BL ROW 30 · F,G · 54, cajas 115)                                        | Las cifras salen de la cantidad (54), no de las cajas: `F 30 · G 24 [✓]` → F DS 30, G base 18 + top 6                                                                                                                      |
| **Más de 30 en un cuadro** (03-3740BK ROW 1 · E · 35)                                          | Cifra en rojo. Propuesta `E 30 · 5 → tap a square`: tocar una letra de la tira lleva las 5 ahí (line pallet 5). `Keep` lo deja como está, rojo, sin bloquear (regla 13)                                                    |
| **Muy por encima** (03-4034BK ROW 34 · B · 137)                                                | `B 30 · 107 → tap squares`: cada letra tocada toma hasta 30 (C 30, D 30, E 30, F 17)                                                                                                                                       |
| **Niño** (07-3742BK ROW 42 · K · 158, towers 28 + 4×30, `+10`)                                 | Sin regla, sin rosa. Se edita pallet a pallet; el montón `10` → `line 10` de un toque                                                                                                                                      |
| **Parte** (32-0557 · D7 · 13 700)                                                              | Sin tira ni pallets: la ubicación y **una cifra** a 72 px. Tocar → teclado. Nada más                                                                                                                                       |
| **Fila fuera de ROW** (CAGE, RETURN TO STOCK, containers)                                      | Como una parte: una cifra                                                                                                                                                                                                  |
| **Una sola unidad**                                                                            | Una cifra `1`, sin pallet (LESSONS: «una sola unidad no dibuja nada»)                                                                                                                                                      |
| **Cuadro que llega a 0**                                                                       | Su bloque queda punteado `0`; al guardar sale de `sublocation` (el trigger)                                                                                                                                                |
| **Fila sin letras en un ROW** (03-3847BL ROW 22)                                               | Tira toda punteada; el primer toque en una letra crea el cuadro con toda la cantidad                                                                                                                                       |
| **Otro SKU en la letra destino**                                                               | Se permite; la letra enseña su cifra gris y el total pasa a rojo si supera 30 (el aviso, no un bloqueo)                                                                                                                    |

### Guardar

1. `SAVE · n` abre **la confirmación** (`useConfirmation`, la de la tarjeta): una línea por cuadro con
   antes → después en cifra y pallets (`F  TOWER 29 → base 18 + top 11`), y `Qty 29 → 29 ✓` o, si se
   contó, `Qty 17 → 16` en ámbar. Un cuadro > 30 sale en rojo `B 137 > 30`. **Nada bloquea.**
2. **`Confirm`** relee la fila. Si `quantity` o `distribution` no son las que se cargaron, no se escribe:
   arriba sale `Changed by Jed · 1 min ago — Reload` (nombre y hora del último `inventory_logs`).
   `Reload` trae la fila y **vuelve a aplicar lo pendiente encima**; nunca se sobrescribe.
3. Escribe con `updateItem`: un **EDIT** (`prev_quantity` → `new_quantity`; con conteo, `quantity_change`
   ≠ 0) y los PHYSICAL_DISTRIBUTION de hoy. **Nuevo:** el `snapshot_before` del EDIT lleva
   `distribution` y `sublocation` de antes, para que un undo y la historia sepan qué había.
4. Vuelve a quien lo abrió (`returnTo`), con la fila fresca.

## 5. Modos y herramientas

**Un solo modo y ninguna herramienta que elegir.** Lo que se toca se edita; lo que no cumple la regla
lo dice; el botón es uno.

| Se ve                                                  | No se ve (y por qué)                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| La fila, la cantidad, la tira de letras                | La ubicación como selector (cambiar de fila es Move)                   |
| Un bloque por cuadro: letra, cifra, pallets, propuesta | Etiquetas de campo (`HOW MANY`, `UNITS EACH`): la cifra es la etiqueta |
| La barra de un pallet levantado (tipo, número, Delete) | La barra cuando no hay pallet levantado                                |
| `SAVE · n`                                             | `Discard` como botón: es ✕ con aviso                                   |
| Peso, medidas, foto grande, notas                      | Son la ficha (item detail)                                             |

**Lenguaje visual** — colores con dueño, ninguno nuevo:

- **Ámbar** = cuadro (letras) y lo pendiente (anillo, cifra cambiada, `SAVE`).
- **Punteado** = lo que no es real todavía: la propuesta de la regla, el montón `loose`, un cuadro vacío.
  Sólido = lo que la base dice hoy. «Separar lo real de lo plan, sin etiqueta».
- **Rosa 🪜** = top. **Rojo** = un cuadro con más de 30, y Delete. **Verde** no aparece: es de Move.

## 6. Datos

**Sin migración.** Todo se escribe con lo que existe.

**Un módulo puro: `inventory/utils/squareEdit.ts` se amplía** (no nace otro; ya es «editar las cajas de
una fila»). Lo nuevo, con test:

- `rowDraft(row, isKid)` → `{ squares: [{ letter, units, pallets, loose }], needsSplit }` — sobre
  `rowStock` (moveLoad), con la cifra de cada cuadro sacada de la cantidad.
- `ruleFor(units, isKid)` → `palletsFor(units)` o `null` (niño); `meetsRule(square)`.
- `proposeSplit(letters, qty)` → `{B: 30, C: 28}`; `proposeOverflow(square)` → `{ keep: 30, rest: 5 }`.
- `setSquareUnits(draft, letter, n, isKid)`, `acceptRule(draft, letter)`, `setPalletType`,
  `setPalletUnits`, `movePallet(draft, letter, index, toLetter)`, `deletePallet`, `addSquare`.
- `draftChanges(base, draft)` (sobre `squareChanges`) y `draftToSave(draft)` (sobre `boxesToSave`).

`setGroupNumber`, `moveGroup`, `splitGroup`, `addGroup` quedan como piezas internas de lo anterior.
`moveLoad.ts` no cambia: Move sigue usando `rowStock`, `takeCount`, `landInRow`.

**Una pantalla: `inventory/components/SquareEditMode.tsx`**, con un hook `useRowSave()` (relectura,
choque, confirmación, `updateItem`) sacado de `StockBoxEdit.tsx`.

**Modal Manager (aditivo):**
`{ type: 'square-edit'; itemId: number; square?: string; pallet?: number; staged?: 'bring-forward'; returnTo?: ModalState }`.
Lee la fila de la caché viva por `itemId`, no de un objeto viejo.

**Las puertas:**

| Desde            | Gesto                                                                                                                                                                          | Abre                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Tarjeta de Stock | tocar el dibujo / los números de la línea de cajas, o la cifra de cantidad (la única puerta de una parte, que no tiene dibujo); el resto de la tarjeta sigue abriendo la ficha | el modo en ese cuadro                                                      |
| Tarjeta de Stock | la píldora `Bring forward · B → A`                                                                                                                                             | el modo con el movimiento ya en ámbar                                      |
| Item detail      | ⋯ → **Boxes** (sustituye a Distribution); con idea-256 P1, tocar el dibujo de un bloque                                                                                        | el modo en esa fila, `returnTo` = la ficha                                 |
| Hoja Move        | mantener pulsado un pallet                                                                                                                                                     | el modo en ese cuadro con ese pallet levantado, `returnTo` = Move          |
| Hoja Move        | fila con `?` (hoy `SplitAsk`)                                                                                                                                                  | el modo con la propuesta de reparto; al guardar vuelve a Move ya repartida |

**Se borra en P1:** `BoxEditSheet.tsx` (las cuatro hojas), el tipo `box-edit` del Modal Manager, la
edición en sitio de la tarjeta (`StockBoxEditProvider`: anillos, banner, `guard`; `SquareBoxes` queda
de sólo lectura), `FixPallet` y su `startHold` en `MoveSheet.tsx` (el gesto se queda, abre el modo),
`SectionEditorSheet.tsx` y el estado `distribution` de `ItemCardView`. `SplitAsk` en P2.

**Cambia (pequeño):** `updateItem` añade `distribution` y `sublocation` al `snapshot_before` del EDIT.

**No se toca:** `palletsFor` y su espejo SQL, `plan_square_picks`, `move_stock_squares`, el mapa,
`row_squares`, `− ⇄ +` de la tarjeta (guardan al momento, como hoy).

**idea-256:** su P2 («corregir por cuadro sobre el dibujo») **queda absorbida** por este modo: la ficha
sólo dibuja y abre el modo. Su P1 (ver y mover) sigue igual.
**idea-254 F4:** en vez de recalcular 520 filas con una migración, el modo es la herramienta; P3 añade la
cola `Next row` para recorrerlas en orden de caminar.

## 7. Pantalla

```
┌──────────────────────────────────────────┐ 430 px
│ [foto] 03-3743GN                      ✕  │ cabecera de Move
│        TRAIL X A1 19 2026 MASH           │
│ ROW 29                              29   │ 36 px · cifra 40 px
│ [A][B][C][D][E][F 29][G][H][I][J][K]     │ tira, 11 × 34 px
│ ┌──────────────────────────────────────┐ │
│ │ [F]   29                             │ │ letra 48 px · cifra 56 px
│ │ ┌────┐                               │ │
│ │ │ 29 │  tower                        │ │ pallet 64 px, número 28 px
│ │ └────┘                               │ │
│ │ ┌┄┄┄┄┐┌┄┄┄┐                          │ │ propuesta punteada
│ │ ┆ 11 ┆┆18 ┆  Rule base 18 + top 11 [✓]│ │ ✓ = 48 × 48
│ └──────────────────────────────────────┘ │
│ …                                        │
├──────────────────────────────────────────┤
│ F 29 → 29 · base 18 + top 11             │
│ [            SAVE · 1               ]    │ 56 px, ámbar
└──────────────────────────────────────────┘
```

**Tamaños mínimos (la regla nueva de LESSONS):** cifra de cuadro **56 px**; número de pallet **28 px**;
número en el teclado/edición **72 px** (la cifra de Move); todo blanco tocable **≥ 48 × 48 px**; nada
editable bajo 28 px. Lo de 11–13 px sólo para etiquetas que no se tocan.

**En el teléfono (430 px):** columna única, `max-w-[480px]`. Un bloque de cuadro mide ~170 px: caben 3
sin bajar; 4 o más se bajan con el dedo (5 filas de 561 tienen más de 2 cuadros). La tira baja a dos
líneas con 12 letras o más. La barra de SAVE fija con `pb-[max(0.75rem,env(safe-area-inset-bottom))]`,
la pantalla en `z-[190]` como Move (encima de la BottomNavigation). La barra de un pallet levantado cabe
en una línea: tres tipos de 96 px + número; Delete en la segunda.

**En la Zebra ET401 (8"):** la misma columna centrada; el teclado es el del sistema
(`inputMode="numeric"`). **A 1400 px:** igual, centrada; no se estira.

## 8. Fases

- **P1 — El modo y sus tres puertas** (lo que pidió).
  - `squareEdit.ts` ampliado con test (los casos del §9 como tabla); `SquareEditMode` + `useRowSave`.
  - Propuestas: regla por cuadro, reparto `?`, más de 30; niño libre; parte una cifra.
  - Puertas: tarjeta (dibujo), item detail (⋯ → Boxes), Move (mantener pulsado). Borrar
    `BoxEditSheet`, `box-edit`, la edición en sitio de la tarjeta, `FixPallet`, `SectionEditorSheet`.
  - `snapshot_before` con las cajas.
  - **Checkpoint:** capturas a 430 y 1400 de los casos 1, 4, 6, 8, 10, 11, 12; los logs de 1 y 9.
- **P2 — Move y la píldora pasan por el modo.**
  - El `?` de Move abre el modo (se borra `SplitAsk`); `Bring forward` abre el modo con el movimiento en
    ámbar.
  - **Checkpoint:** caso 12 y una orden de Move sobre una fila recién repartida.
- **P3 — La cola de F4 (esperando).**
  - `Next row` en el modo tras guardar: la siguiente fila de adulto que no cumple la regla, en orden de
    ROW (el de caminar); contador `518 left`.
  - **Checkpoint:** la cifra 520 → ? al final de cada día.

## 9. Casos de verificación (prod, 7 oct)

Cada guardado deja **un EDIT** (con `snapshot_before.distribution` desde P1) y los PHYSICAL_DISTRIBUTION
de hoy (`removed` / `added` por grupo).

| #   | Fila                                                                                        | Pasos                                                           | Resultado y log                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Un toque.** 03-3743GN · ROW 29 · F · 29, `TOWER 29`                                       | Tarjeta → tocar el dibujo → ✓ → SAVE → Confirm                  | Modo abierto en F; propuesta `base 18 + top 11`. Barra `F 29 → 29 · base 18 + top 11`. EDIT 29→29 (`quantity_change` 0), `snapshot_before.distribution = [TOWER 1×29]`; PD `removed TOWER 29`, `added BASE 18`, `added TOP 11`. 3 toques |
| 2   | **El ejemplo de Rafael.** 03-3732BL · ROW 1 · C · 25, `BASE 25`                             | ✓                                                               | `base 18 + top 7`. EDIT 25→25                                                                                                                                                                                                            |
| 3   | **`+2 loose`.** 06-4453BL · ROW 2 · G · 14 (`LINE 2 + 2×5` = 12)                            | Abrir                                                           | Montón punteado `2`; propuesta **`base 14`** (no `line pallet 2`). ✓ → EDIT 14→14, PD removed ×2, added `BASE 14`                                                                                                                        |
| 4   | **`?`.** 03-3983GY · ROW 33 · B,C · 58 (`5×5 + 1×3` = 28, `+30 loose`)                      | Abrir → ✓ del reparto                                           | `B 30 · C 28`; B DS (base 18 + top 12), C base 18 + top 10. EDIT 58→58; `sublocation {B,C}`; todos los grupos con `square`                                                                                                               |
| 5   | **`−61 extra`.** 03-3982BL · ROW 30 · F,G · 54 (cajas 115)                                  | ✓                                                               | `F 30 · G 24` → F DS 30, G base 18 + top 6. Confirmación `Qty 54 → 54 ✓`. EDIT 54→54                                                                                                                                                     |
| 6   | **Dos propuestas.** 06-4735BK · ROW 30 · A,B · 34 (A `line pallet 13`; B `base 15 + top 6`) | ✓ en A y ✓ en B                                                 | A `base 13`; B `base 18 + top 3`. Barra `2 changes`. EDIT 34→34                                                                                                                                                                          |
| 7   | **Ya cumple.** 03-3983GY · ROW 30 · C,D · 45 (C DS 30, D base 15)                           | Abrir                                                           | Sin propuestas; `By the rule ✓`, SAVE gris. Sin log                                                                                                                                                                                      |
| 8   | **Más de 30.** 03-3740BK · ROW 1 · E · 35 (`TOWER 30 + LINE 3`, `+2`)                       | Abrir → tocar F en la tira → SAVE                               | E rojo `35`; propuesta `E 30 · 5 → tap a square`. E DS 30, F line pallet 5. Confirmación `E 35 → 30 · F 0 → 5`. EDIT 35→35, `sublocation {E,F}`                                                                                          |
| 9   | **Conteo.** 03-4009SL · ROW 14 · F · 17 (`3×5` = 15)                                        | Tocar la cifra → 16 → SAVE                                      | Pallets rearmados `base 16`; arriba `Qty 17 → 16` ámbar; confirmación igual. EDIT 17→16, `quantity_change −1`                                                                                                                            |
| 10  | **Niño.** 07-3742BK · ROW 42 · K · 158 (`TOWER 28 + 4×30` = 148)                            | Tocar el montón `10`                                            | Sin propuesta, sin rosa; `10` → `line 10`. EDIT 158→158, PD `added LINE 10`                                                                                                                                                              |
| 11  | **Parte.** 32-0557 · D7 · 13 700                                                            | Tarjeta → tocar la cifra `13 700`                               | Una cifra `13 700` a 72 px; tocar → 13 650 → SAVE. EDIT 13 700→13 650                                                                                                                                                                    |
| 12  | **Desde Move.** 03-3983GY · ROW 31 · B,C · 60 (DS + DS)                                     | Move → B → mantener pulsado el top 12                           | El modo abre en B con el top levantado; `Line pallet` → propuesta vuelve a ofrecer `base 18 + top 12`. ✕ sin guardar → `Discard 1 change?` → Discard → vuelve a Move con la fila como estaba                                             |
| 13  | **Choque.** 03-3985GY · ROW 25 · A,B · 54                                                   | ✓ reparto `A 30 · B 24`; en otro dispositivo −1; SAVE → Confirm | Nada escrito; `Changed by <user> · 0 min ago — Reload`; Reload → `Qty 53`, reparto re-propuesto `A 30 · B 23` en ámbar                                                                                                                   |
| 14  | **137.** 03-4034BK · ROW 34 · B · 137                                                       | `B 30 · 107 → tap squares`; tocar C, D, E, F                    | C 30, D 30, E 30, F 17, cada uno armado con la regla; las letras con otro SKU enseñan su cifra y el total en rojo si pasa de 30. EDIT 137→137                                                                                            |
| 15  | **430 px.** Casos 4 y 6                                                                     | Captura                                                         | Dos bloques sin bajar; cifras 56 px; SAVE no tapa nada                                                                                                                                                                                   |

## 10. ❓ Preguntas (con respuesta por defecto)

1. **❓ ¿El modo también cuenta?** Por defecto **sí**: la cifra de cada cuadro es lo que hay en el piso;
   si la suma cambia, la cantidad de la fila cambia, ámbar `Qty 17 → 16` arriba y en la confirmación, y
   el EDIT lleva el `quantity_change`. Sin tocar ninguna cifra, guardar nunca cambia la cantidad. La
   alternativa es sólo cajas, con la cantidad bloqueada (y el conteo por − + de la tarjeta).
2. **❓ La tarjeta deja de editar en sitio.** Por defecto **sí**: tocar el dibujo abre el modo; se
   borran el anillo, el banner y las cuatro hojas de idea-253 P1. La alternativa es dejar el teclado
   corto de la tarjeta para un número suelto (dos editores de lo mismo).
3. **❓ Teclear la cifra rearma los pallets solos.** Por defecto **sí en adulto** (25 → base 18 + top 7
   sin otro toque), y el `+n loose` se resuelve rearmando el cuadro entero, no con un line pallet
   aparte. La alternativa es teclear y luego aceptar la propuesta con ✓.
4. **❓ El reparto propuesto de un `?`.** Por defecto **30 por cuadro en orden A→Z y el resto en el
   último** (58 → B 30 · C 28). La alternativa es parejo (29 · 29), que es lo que el mapa supone hoy.
5. **❓ Más de 30 en un cuadro.** Por defecto la propuesta es **30 aquí y el resto a la letra que se
   toque**, con `Keep` para dejarlo rojo sin bloquear (regla 13 de idea-254). La alternativa es no
   proponer nada y sólo marcar rojo.
6. **❓ Move pasa por el modo.** Por defecto **sí**: mantener pulsado un pallet y el `?` de una fila
   abren el modo, y lo que se corrige se guarda como EDIT antes de mover. Se borran `FixPallet` (P1) y
   `SplitAsk` (P2). La alternativa es dejar `SplitAsk` dentro de Move sin guardar el reparto.

## 11. Riesgos

- **Aceptar sin mirar.** Un ✓ escribe lo que dice la regla, no lo que hay en el piso. Mitigación: la
  propuesta nunca se guarda sola, la confirmación enseña antes → después, y P3 recorre las filas en orden
  de caminar (se arregla delante del pallet, no desde la oficina). No hay `Apply to all rows`.
- **Corregir no es mover.** Llevar un pallet a otra letra en el modo escribe EDIT. Si el piso lo usa para
  mover de verdad, la historia dirá EDIT. La pantalla es ámbar y Move verde; Move sigue siendo el único
  botón verde.
- **La relectura y la escritura no son atómicas.** `updateItem` relee y luego escribe en dos pasos (como
  la tarjeta hoy); un pick entre los dos se pisaría. La ventana es de milisegundos; si aparece, P2 pasa la
  escritura a un RPC con `p_expected`, como `move_stock_squares`.
- **Una página con el build viejo** guarda cajas sin `square`; el trigger no toca `sublocation` y el que
  tiene el build nuevo ve el choque. El chequecito ámbar ya avisa del build.
- **Niño mal clasificado.** `isSmallBikeSku` decide si hay regla; un adulto clasificado como niño no
  recibe propuesta (y al revés). Se ve en el modo: sin rosa ni propuesta.
- **La letra destino con otro SKU** no se bloquea; el total rojo > 30 es el único aviso.
- **Filas sin geometría** (ROW 42, ROW 41+, Bay 1): la tira enseña sólo las letras que la fila usa más
  las de A a la más alta; no hay accesible / enterrado aquí.

- **7 oct 2026 — Rafael: «the Stock card no quiero que se modifique visualmente».** ❓2 cambia: la
  tarjeta se ve igual que hoy; sólo cambia a dónde lleva el toque. El estudio sigue esperando el resto.
