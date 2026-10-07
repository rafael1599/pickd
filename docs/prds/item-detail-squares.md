# Item detail: el SKU cuadro por cuadro, y moverlo desde ahí (idea-256)

Estudio, 7 oct 2026. Maqueta a 430 px: `docs/design/item-detail-squares.html` (10 frames). Nada
construido. Las ❓ (§10) llevan su respuesta por defecto.

Rafael, 7 oct: «Ya mejoramos el flujo pero en item detail no tenía esas mejoras aún». Eligió las tres
cosas: que enseñe **cuadro por cuadro con sus pallets dibujados**, **mover desde ahí con la hoja
nueva**, y un estudio con maqueta a 430 px antes de código.

## 1. Contexto y problema

En dos días la tarjeta de Stock aprendió los cuadros (idea-253), los pallets pasaron a base / top /
line pallet (idea-254) y mover se volvió una hoja con números por cuadro (idea-255). **La ficha no
aprendió nada de eso.** Hoy (`ItemDetailView/ItemCardView.tsx`, ficha F2 del 1 oct):

| Lo que hace la ficha hoy                                                                                   | Lo que ya existe en otra pantalla                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Enseña **una fila** (la que se tocó): `WHERE ROW 30 · F,G` y `HOW MANY 54`                                 | La tarjeta enseña los grupos **por cuadro** con su dibujo (`SquareBoxes` en `InventoryCard.tsx`)            |
| Las demás filas del SKU son una línea de texto bajo «Also» (`60 · ROW 31 · F,G`)                           | La hoja Move dibuja la tira de cuadros de la fila y los pallets del cuadro (`MoveSheet.tsx`, `SquareStrip`) |
| Las cajas se editan en ⋯ → Distribution (`SectionEditorSheet`): tipo / cuántas / de cuánto, **sin cuadro** | La tarjeta las edita por cuadro, en espera, con confirmación y choque (`StockBoxEdit.tsx`, `squareEdit.ts`) |
| **Mover = tocar WHERE, elegir otra fila, SAVE** → `updateItem` (rama de cambio de ubicación)               | Mover = ⇄ → `MoveSheet` → `move_stock_squares`, con cajas y cuadros en las dos filas                        |

**Bug encontrado al leer el código** (`features/inventory/api/inventory.service.ts`, `updateItem`,
rama «collision merge»): cuando la ficha mueve una fila a otra donde el SKU ya está, el destino recibe
`quantity = suma` y **`distribution = las cajas del origen`**: las cajas del destino desaparecen. Es el
mismo daño que idea-255 encontró en `move_inventory_stock` (unidades sin cajas), por otra puerta.

**Cifras de prod (7 oct, LUDLOW, filas activas con stock):**

| Qué                                                                              | Cifra                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| SKUs de bici con stock                                                           | **684** en 723 filas (561 en ROW)                             |
| … en **una** fila / en 2 / 3 / 4                                                 | 658 / 19 / 1 / **6**                                          |
| Unidades de bici en SKUs de varias filas                                         | **1 922** de 9 704 (20 %)                                     |
| Partes en varias filas                                                           | 74 SKUs (58 en 2, 10 en 3, 6 en 4–5)                          |
| Filas ROW con cajas de menos (`+n loose`) / de más (`−n extra`)                  | **102** / 6                                                   |
| Filas ROW con varios cuadros (la ficha no sabe cuánto hay en cada uno)           | **47**                                                        |
| Filas cuyos grupos llevan cuadro                                                 | 2 (03-4666BR, 03-3732BL: las editó Rafael esta mañana)        |
| MOVE de 30 días por el camino de la ficha (`snapshot_before` sin `distribution`) | **24** (512 u): Rafael 12, Jed 9, Roman 1, sin nombre 2       |
| MOVE con la hoja nueva (`move_detail`) en las últimas 24 h                       | 0 — P1 de idea-255 está en `main`; el piso aún no la ha usado |

El caso que lo resume: **03-3982BL (CITIZEN 2 21")** está en **4 filas, 264 u**. La ficha abierta
desde ROW 30 dice `ROW 30 · F,G · 54` y debajo tres líneas de texto. Lo que el piso necesita leer —
ROW 30 tiene cajas para 115 (`−61 extra`), ROW 33 tiene 90 con cajas para 30 (`+60 loose`), y ninguna
de las cuatro filas dice cuánto hay en cada cuadro— no está en la pantalla.

**Lo que se reutiliza (nada se reinventa):**

- `utils/boxSquares.ts` (`squaredGroups`, `unitsPerSquare`, `groupUnits`), `utils/squareEdit.ts`
  (`squareChanges`, `boxesMismatch`, `mismatchLabel`, `setGroupNumber`, `moveGroup`, `splitGroup`,
  `addGroup`, `boxesToSave`).
- `utils/moveLoad.ts`: **`rowStock(row, split)`** — lo que tiene cada cuadro y si la fila
  `needsSplit` — es exactamente la lectura que la ficha necesita, y `SplitAsk` de `MoveSheet` la
  pregunta que falta.
- `SquareBoxes` (`InventoryCard.tsx`), `DistributionGlyph` (`DistributionJengaViz.tsx`), `SquareStrip`
  (`MoveSheet.tsx`), `BoxEditSheet` (Modal Manager `box-edit`: teclado, letras / Split, `+`).
- La confirmación y el choque de `StockBoxEdit.tsx` (relee `updated_at` + último `inventory_logs`).
- `MoveSheet` (Modal Manager `move`), `move_stock_squares`, `useRowSquares` (`row_squares`).
- La barra `SAVE · n changes` / «Undo all» de la propia ficha, y `useStockReservations`,
  `get_inventory_logs_for_sku` para «Also».

## 2. Objetivo

Que quien abre un SKU vea **dónde está todo, cuadro por cuadro y pallet por pallet**, y lo mueva o lo
corrija **desde ahí**, con el mismo motor que la tarjeta y la hoja Move.

**Métricas:**

1. Ningún MOVE nuevo con `snapshot_before` sin `distribution` (hoy 24 en 30 días): mover desde la
   ficha deja `move_detail` como la hoja.
2. Las 47 filas de varios cuadros bajan a menos de 25 en dos semanas: la ficha pregunta la cifra de
   cada cuadro donde hoy no se ve.
3. El `+n loose` (102 filas) sigue bajando; la ficha no crea ninguna fila nueva con desajuste.

## 3. Conceptos

- **Fila.** Una ubicación del SKU (`inventory`: `ROW 33`, `CAGE`, `D7`). La ficha deja de ser «una
  fila con notas al pie» y pasa a ser **el SKU con todas sus filas**; la que se tocó va primero.
- **Cuadro.** Una letra de un ROW con lo que el SKU tiene ahí: sus pallets (base 18, top 12 🪜, line
  pallet; o los tipos viejos hasta F4) y, si las cajas no cubren la cantidad, el montón punteado
  `loose`. Su cifra es la suma de sus grupos; si la fila nunca se repartió entre sus letras, la cifra
  es un **`?` ámbar**.
- **Cambio en espera vs. movimiento.** Corregir lo que dice la base (las cajas, la cantidad, la cifra
  de un cuadro) es **ámbar**, espera a SAVE y escribe un EDIT. Mover pallets en el piso es la **hoja
  Move**, verde, inmediata, y escribe un MOVE. Los dos colores ya tienen ese dueño.

## 4. El gesto

Se abre como hoy: tocando una tarjeta de Stock, un SKU en Ship, Double Check o el mapa
(`useOpenSkuDetail`). La pegatina de arriba no cambia.

1. **Debajo de la pegatina, `STOCK` con una cifra** (todas las filas) y, si son varias, `4 rows`.
2. **Un bloque por fila** — la tocada primero (borde blanco), las demás por número de ROW (el orden de
   caminar). Cada bloque:
   - **Cabecera:** la ubicación en grande (`ROW 33`), la cantidad de la fila en grande con − y + (lo
     que hoy es HOW MANY), y **⇄**.
   - **La tira de cuadros** (`SquareStrip`, las letras de `row_squares` + las que la fila usa): sólo
     los de este SKU encendidos en ámbar con su cifra; las demás apagadas. Más de 30 en rojo.
   - **Bajo la tira, cuadro por cuadro:** la letra una vez y sus pallets dibujados, compactos
     (`2×30`), con `count × units` al lado; el montón `loose` punteado donde corresponda; el chip
     `−n extra` si las cajas pasan la cantidad.
3. **⇄ abre la hoja Move** con esa fila como origen (y su cuadro ya elegido si tiene uno). Se mueve
   como en la hoja. **Al cerrar o al mover, se vuelve a la ficha**, que enseña las cifras nuevas con
   un destello verde en lo que cambió (y el bloque de la fila destino si es nueva).
4. **Tocar un número** del dibujo (`30` o el `2` de `2×30`) abre el teclado (`box-edit`, `number`);
   **tocar el dibujo o la letra** abre las letras (mover el grupo a otro cuadro de la fila, `Split`);
   **`+`** añade un grupo. Todo queda en ámbar, como en la tarjeta.
5. **Tocar un `?`** pregunta `How many in F?` (`SplitAsk`, la misma de Move); la última letra es el
   resto. Las cajas se reparten con `rowStock(row, split)` y queda en ámbar.
6. **Tocar el montón `loose`** abre `+` con el cuadro y la cifra puestos (`line pallet 2 · E`, armado
   con `palletsFor` si es adulto; `line 2` si es de niño).
7. **La barra de abajo es la de la ficha:** `ROW 33 · 2 changes · F ?→30 · G ?→30` y **Save** /
   `Discard`. Si los cambios tocan cajas o cantidad, Save abre **la confirmación de la tarjeta**
   (antes → después por cuadro, `Boxes 90 · Qty 90 ✓`, aviso ámbar si no cuadra, nunca bloquea) y
   relee la fila antes de escribir (`Changed by Jed · 0 min ago — Reload`). Si sólo cambió la
   pegatina, guarda sin preguntar, como hoy.

**Ramas:**

| Caso                                                                       | Qué pasa                                                                                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Varias filas** (03-3982BL, 4 filas, 264 u)                               | Cuatro bloques; la tocada primero con borde blanco. Nada plegado: «compactar, nunca quitar»                                                                           |
| **Fila sin reparto** (03-3985GY · ROW 25 · A,B · 54)                       | A y B con `?` ámbar; las cajas se dibujan una vez para la fila; tocar un `?` pregunta la cifra                                                                        |
| **Cajas de menos** (03-3740BK · ROW 1 · E · 35: tower 30 + line 3)         | Montón punteado `2` junto a los pallets de E; tocarlo da cajas a esas 2                                                                                               |
| **Cajas de más** (03-3982BL · ROW 30 · 54, cajas 115)                      | Chip `−61 extra`; F y G con `?` hasta repartir. La cantidad (54) manda; las cajas describen                                                                           |
| **DS** (base 18 + top 12)                                                  | Dibujo de dos maderas; el top en rosa 🪜 con su cifra. `DS 30` debajo                                                                                                 |
| **Bici de niño** (07-3742BK · ROW 42 · K · 158)                            | Se dibuja lo que hay (towers `4×30` + `28`); sin rosa, sin `palletsFor`; editar es libre (regla 10 de idea-254)                                                       |
| **Fila fuera de ROW** (CAGE, PHOTO, RETURN TO STOCK, containers)           | Sin tira ni dibujo: ubicación y cifra. ⇄ abre Move igual                                                                                                              |
| **Parte** (32-0557 · D7 · 13 700)                                          | Sin tira, sin dibujo, sin Distribution: `D7 · 13 700` y ⇄                                                                                                             |
| **Una sola unidad** (S/D 01-1998 #82 · ROW 12 · I · 1)                     | «Una unidad no dibuja nada»: `ROW 12 · I` y `1`, sin tira ni pallet. La pegatina S/D y `SdDetailsCard` no cambian                                                     |
| **Fila sin letras en un ROW** (03-3847BL · ROW 22)                         | Tira apagada y un `?` en la cabecera: `+` pide la letra                                                                                                               |
| **⇄ con cambios en espera**                                                | ⇄ atenuado; tocarlo dice `Save or discard first` (como la tarjeta)                                                                                                    |
| **Cambios en dos filas**                                                   | Una fila con cambios a la vez: tocar otra pregunta `Unsaved changes · 2 changes on ROW 33` con `[Keep editing] [Discard]` (el aviso que la tarjeta construyó)         |
| **Abierta desde Ship / Double Check / mapa** (Modal Manager `item-detail`) | El Modal Manager tiene un solo hueco: ⇄ abre `move` con `returnTo` = la ficha; al cerrar Move, el gestor la reabre. Así no se cae a Ship                              |
| **Una fila llega a 0** (se movió entera)                                   | Su bloque desaparece al volver; si era la tocada, la primera pasa a ser la de más unidades. Con 0 en todas, un bloque punteado `0` de la fila tocada, como la tarjeta |
| **Return / PH**                                                            | Sin cambios: un return es una unidad con RESOLVE; un PH es una unidad                                                                                                 |

## 5. Modos y herramientas

Un solo modo, el de la ficha: en reposo no hay botones salvo ⇄ y − +; lo que se toca se edita.

| Está                                                               | Sale (y por qué)                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| La pegatina, la caja (`CartonLine`), S/D, la nota de estante       | **WHERE como selector de otra fila** (`WherePicker` en una fila existente): mover pasa por ⇄. El de Register no se toca            |
| `STOCK` con la cifra total y un bloque por fila                    | **«Also» → otras ubicaciones**: son bloques ahora. «Also» se queda con las reservas (de todas las filas) y los últimos movimientos |
| Por fila: ubicación, cantidad con − +, ⇄, tira, pallets por cuadro | **⋯ → Distribution** (`SectionEditorSheet`): era un tercer editor de cajas, sin cuadro. Se edita en el dibujo                      |
| La barra Save / Discard y la confirmación de la tarjeta            | —                                                                                                                                  |

**Lenguaje visual** (colores con dueño, ninguno nuevo; el de la tarjeta y la hoja Move):

- **Ámbar** = cuadro (las letras, los cuadros encendidos) y lo pendiente (anillo, punto, barra), y el
  `?` de lo que no se sabe. El chip `+n loose` / `−n extra` es ámbar **sin anillo**: un hecho.
- **Rosa 🪜** = top. **Verde** = la hoja Move y el destello de lo que se acaba de mover.
- **Rojo** = un cuadro con más de 30. **Punteado** = `loose`, y un cuadro sin nada.
- **Borde blanco** = la fila que se tocó (el mismo blanco del tile abierto de la ficha).

## 6. Datos

**Sin migración.** Todo lo que la ficha escribe ya tiene su RPC.

**Se reutiliza tal cual:** `rowStock`, `squaredGroups`, `squareEdit.ts`, `palletsFor`,
`isSmallBikeSku`, `move_stock_squares`, `row_squares`, `updateItem` (EDIT con `snapshot_before`),
`keep_inventory_squares`, `useStockReservations` (con las llaves de todas las filas),
`get_inventory_logs_for_sku`.

**Se mueve de sitio para compartirse (sin lógica nueva):**

1. `SquareBoxes` sale de `InventoryCard.tsx` a `components/SquareBoxes.tsx` (tarjeta y ficha), con un
   tamaño `size="lg"` para la ficha (los glifos a 40 px en vez de 30).
2. `SquareStrip` y `SplitAsk` salen de `MoveSheet.tsx` a `components/SquareStrip.tsx` (Move y ficha).
3. La confirmación y el choque de `StockBoxEdit.tsx` pasan a un hook `useRowBoxSave()` (relee la fila,
   arma el antes → después con `squareChanges`, abre la confirmación, escribe con `updateItem`). La
   tarjeta y la ficha lo llaman; el contexto de la lista sigue siendo de la lista.

**Cambia (aditivo):**

4. **Modal Manager `move`**: `{ type: 'move', item, square?, returnTo? }`. `square` preselecciona el
   cuadro en `MoveSheet` (`fromSquare` inicial); `returnTo` es el estado de modal a reabrir al cerrar.
   Abierta desde Stock (la ficha vive en `InventoryScreen`, z-180), Move ya se apila encima (z-190) y
   `returnTo` no hace falta.
5. **La ficha lee sus filas de la caché viva**, no del `item` con que se abrió: las filas del SKU en
   `ludlowData` (como ya hace `elsewhere`), que el realtime refresca tras el MOVE. Si no, al volver de
   Move enseñaría las cifras de antes.
6. **`ItemCardView`**: el estado en espera de cajas pasa de un `distribution` de la fila abierta a
   `{ rowId, base, cur }` de la fila con cambios (una a la vez). Lo de la pegatina sigue igual.

**Se borra cuando nada lo llame:** `SectionEditorSheet.tsx` y la rama de cambio de ubicación de
`updateItem` (el «collision merge» que pisa las cajas del destino). La segunda se confirma con un grep
en P1; si algo más la usa, se le pone el arreglo (sumar cajas, unir letras) en vez de borrarla.

**No se toca:** `inventory.quantity` manda; las cajas describen. `RegisterItemView` y su
`WherePicker`. `plan_square_picks`. El mapa.

## 7. Pantalla (430 px)

```
┌──────────────────────────────────────────┐
│ ←  ITEM                               ⋯  │
│ ┌──────────────────────────────────────┐ │
│ │ 03-3982BL   (pegatina, sin cambios)  │ │
│ │ CITIZEN 2 · 21" · MONTEREY BLUE  NEW │ │
│ └──────────────────────────────────────┘ │
│ STOCK                       264 · 4 rows │
│ ┌──────────────────────────────────────┐ │  borde blanco = la fila tocada
│ │ ROW 30                 54   − +   ⇄  │ │
│ │ [A][B][C][D][E][F?][G?][H][I][J][K]  │ │  11 × 34 px
│ │ F,G ▤ 3×30  ▤ 1×25        −61 extra  │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ ROW 31                 60   − +   ⇄  │ │
│ │ [ ][ ][ ][ ][ ][F?][G?][ ][ ][ ][ ]  │ │
│ │ F,G ▤ 2×30                    split? │ │
│ └──────────────────────────────────────┘ │
│   …ROW 32, ROW 33…                       │
│ 55 × 9 × 30 in · 46 lb   MEASURED        │
│ ALSO  3 · #881702 reserved …             │
├──────────────────────────────────────────┤
│ ROW 33 · 2 changes · F ?→30 · G ?→30     │  sólo con cambios
│ [ Discard ]                  [  Save  ]  │
└──────────────────────────────────────────┘
```

- **En el teléfono:** la ficha es la de hoy (`max-w-[430px]`, `pb-48`, barra fija con
  `pb-[max(0.75rem,env(safe-area-inset-bottom))]`). La tira es una rejilla de tantas columnas como
  letras (11 en ROW 18–33: 34 px a 430); con 12 o más baja a dos líneas (`SquareStrip`). La línea de
  pallets de un cuadro cabe con tres grupos; con más, pasa a otra línea, nunca se corta.
- **La cabecera del bloque cabe en 398 px:** ubicación a 30 px (`ROW 33` ≈ 120 px), cifra a 40 px,
  − + apilados (como HOW MANY hoy) y ⇄ de 40 px.
- **En la Zebra (8"):** igual. Move abre con el cursor en TO, así el escaneo cae ahí.
- **A 1400 px:** la misma columna centrada; no se estira.

## 8. Fases

- **P1 — Ver y mover** (lo que pidió).
  - Bloques por fila con tira y pallets dibujados (sólo lectura del dibujo), `?` y `loose` a la
    vista; − + sólo en la fila tocada, como hoy.
  - ⇄ → `MoveSheet` con `square` / `returnTo`; vuelta a la ficha con cifras frescas.
  - WHERE deja de mover (❓1); «Also» sin otras ubicaciones; reservas de todas las filas.
  - **Checkpoint:** capturas 430 y 1400 de los casos 1, 2, 3, 7, 8, 9, 10; grep de la rama de
    `updateItem` sin llamadas.
- **P2 — Corregir por cuadro.** `SquareBoxes` editable en cada bloque, `?` → `SplitAsk`, `loose` →
  `+`, `useRowBoxSave` (confirmación y choque), − + en todas las filas (una con cambios a la vez); se
  borra ⋯ → Distribution y `SectionEditorSheet`.
  - **Checkpoint:** casos 4, 5, 6, 11, 12 con su log; cifra de filas con varios cuadros sin reparto
    (47 → ?) al día siguiente.
- **P3 — Esperando.**
  - El cuadro del que se recogerá lo siguiente (`plan_square_picks`) marcado en la tira (`next`).
  - La píldora Bring forward en el bloque, cuando idea-255 P2 la pase a la hoja Move.
  - Register: su `WherePicker` con los pallets del cuadro elegido.

## 9. Casos de verificación (prod, 7 oct)

| #   | Caso                                                                                              | Pasos                                                                     | Resultado y log                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Varias filas.** 03-3982BL desde la tarjeta de ROW 30                                            | Abrir                                                                     | `STOCK 264 · 4 rows`. Bloques ROW 30 (borde blanco), 31, 32, 33. ROW 30: F,G `?`, `1×25 + 3×30`, `−61 extra`. ROW 31 y 32: F,G `?` con `2×30`, `split?`. ROW 33: E,F,G `?`, `1×30`, `+60 loose`. Sin log                                                        |
| 2   | **Loose.** 03-3740BK · ROW 1 · E · 35 (tower 30 + line 3)                                         | Abrir                                                                     | Tira A–H, E `35` en rojo (>30). Torre 30, line 3 y montón punteado `2`. Sin log                                                                                                                                                                                 |
| 3   | **Mover desde la ficha.** La misma                                                                | ⇄ → (E ya elegido) tocar la torre; `34`; A; Move                          | Vuelve a la ficha: ROW 1 · E `35 → 5` con destello verde (line 3 + `2` loose), bloque nuevo **ROW 34 · A `30`: base 18 + top 12 🪜**. `STOCK 35 · 2 rows`. Log MOVE −30 con `move_detail.take [{E, TOWER 30}]`, `land [{A, 30}]`                                |
| 4   | **El bug que se cierra.** 03-4466BR · ROW 3 · C · 4 (line 4) → ROW 25 · C (9: line 4, `+5 loose`) | Hoy: WHERE → ROW 25 → Save. Con P1: ⇄, tocar la line 4, `25C`, Move       | Hoy: ROW 25 = 13 con cajas `[line 4]` (`+9 loose`), las del destino perdidas. Con P1: ROW 25 · C = **base 13**, sin loose; log MOVE −4 con `dest_snapshot_before.distribution = [line 4]` (caso 3 de idea-255)                                                  |
| 5   | **Reparto.** 03-3985GY · ROW 25 · A,B · 54 (tower 30 + 4×5 + 1×2, `+2 loose`)                     | Tocar el `?` de A → 30                                                    | Ámbar: A `tower 30`, B `4×5 + 1×2` y `2` loose. Barra `ROW 25 · 1 change · A ?→30 · B ?→24`. Save → `Boxes 52 · Qty 54 · +2 loose` (ámbar, no bloquea) → Confirm. Log EDIT 54→54, `snapshot_before.distribution` = los 3 grupos sin cuadro; `sublocation {A,B}` |
| 6   | **Dar cajas al loose.** 03-3740BK · ROW 1 · E (tras el caso 3: line 3 + 2 loose)                  | Tocar el `2` punteado → `+` con `line pallet 2 · E` → Add; Save → Confirm | `Boxes 5 · Qty 5 ✓`. Log EDIT 5→5; el montón desaparece                                                                                                                                                                                                         |
| 7   | **Niño.** 07-3742BK · ROW 42 · K · 158 (tower 28 + 4×30)                                          | Abrir                                                                     | Tira A–K sin geometría (ROW 42 no está en `row_squares`), K `158` rojo. Towers `4×30` y `28`, sin rosa. Sin log                                                                                                                                                 |
| 8   | **Parte.** 32-0557 · D7 · 13 700                                                                  | Abrir; ⇄                                                                  | Un bloque `D7 · 13 700`, sin tira ni dibujo; ⋯ sin Distribution. Move abre en dos tiles                                                                                                                                                                         |
| 9   | **S/D.** 01-1998 · 2011 XENITH T 54 SILVER S/D · #82 · ROW 12 · I · 1                             | Abrir                                                                     | Pegatina `S/D #82`; bloque `ROW 12 · I · 1` sin tira ni pallet; `SdDetailsCard` igual                                                                                                                                                                           |
| 10  | **Desde Ship.** Orden con 03-3740BK; tocar la línea                                               | Ficha → ⇄ → ✕                                                             | Vuelve a la ficha (no a Ship); ← vuelve a Ship                                                                                                                                                                                                                  |
| 11  | **⇄ con cambios.** 03-3740BK, − en ROW 1 (35 → 34 en ámbar)                                       | Tocar ⇄                                                                   | Nada se abre; `Save or discard first`                                                                                                                                                                                                                           |
| 12  | **Choque.** 03-3983GY · ROW 33 · B,C · 58 (5×5 + 1×3)                                             | `?` de B → 28; en otro dispositivo −1; Save                               | Nada escrito; `Changed by Jed · 0 min ago — Reload`; Reload enseña 57 y conserva `B 28` en ámbar                                                                                                                                                                |
| 13  | **430 px.** 03-3982BL y 03-3978BL (ROW 30 · H,I · 67, 9+2×30)                                     | Captura                                                                   | Once cuadros de 34 px; `ROW 30` y `67` en una línea con − + ⇄; la barra no tapa el último bloque                                                                                                                                                                |

## 10. ❓ Preguntas (con respuesta por defecto)

1. **❓ WHERE deja de mover.** Por defecto **sí**: en un ítem existente, mover es ⇄ → la hoja Move;
   el tile WHERE pasa a ser la cabecera del bloque. El camino de hoy pisa las cajas del destino (24
   MOVE, 512 u en 30 días). La alternativa es que tocar la ubicación abra también Move (dos puertas a
   lo mismo).
2. **❓ Todas las filas abiertas.** Por defecto **sí, todas desplegadas**: la tocada primero con borde
   blanco, las demás por número de ROW; «Also» deja de listar ubicaciones. La alternativa es plegar las
   que no se tocaron a una línea (`ROW 31 · F,G · 60`) que se abre al tocarla.
3. **❓ Un ⇄ por fila.** Por defecto **uno por fila**: la hoja ya enseña la tira y con un cuadro lo
   elige sola. La alternativa es un ⇄ por cuadro (un botón más por letra).
4. **❓ Al cerrar Move se vuelve a la ficha.** Por defecto **sí**, también abierta desde Ship, Double
   Check o el mapa, con destello verde en lo que cambió. La alternativa es cerrar las dos.
5. **❓ Una barra para todo.** Por defecto **la barra Save de la ficha** (una sola, ahora con el antes
   → después por cuadro) y, si cambian cajas o cantidad, **la confirmación de la tarjeta**; una fila con
   cambios a la vez. Los botones dicen `Discard` / `Save` (la ficha decía `Undo all`; ❓5 de idea-253 ya
   lo cambió en la tarjeta). La alternativa es guardar la pegatina y las cajas por separado.
6. **❓ El `?` de una fila sin reparto.** Por defecto **se enseña `?` ámbar y tocarlo pregunta `How
many in F?`** (la `SplitAsk` de Move), que queda en espera; y el montón `loose` se toca para darle
   cajas. La alternativa es repartir parejo sin preguntar (`≈30`), que es lo que el mapa hace hoy.

## 11. Riesgos

- **El Modal Manager tiene un hueco.** Si `returnTo` falla, abrir Move desde una ficha abierta en
  Ship deja al usuario en Ship sin la ficha. El caso 10 lo prueba; el test del modal también.
- **Cifras viejas al volver.** Si la ficha lee el `item` con que se abrió en vez de la caché, enseña
  35 tras mover 30. El destello verde depende de leer la fila nueva; el caso 3 lo comprueba.
- **Una ficha larga.** 03-3982BL son cuatro bloques (~170 px cada uno) bajo la pegatina: se baja con
  el dedo. Sólo 6 SKUs tienen 4 filas; 658 de 684 tienen una. Plegar es ❓2.
- **Datos raros se dibujan como están.** 03-4666BR · ROW 1 · B tiene `base 27 + line pallet 12 + line
pallet 2` en un cuadro (dos maderas de line pallet en un cuadro y una base de más de 18): la ficha lo
  dibuja así, no lo arregla. Avisar de una DS mal armada es F3/F4 de idea-254.
- **Corregir no es mover.** Las letras (`moveGroup`) corrigen dónde dice la base que está un grupo (EDIT);
  ⇄ registra un movimiento (MOVE). Si el piso usa las letras para mover, el log dirá EDIT. La
  confirmación lo deja claro (`Fix boxes`) y Move es el único botón verde.
- **HOW MANY es violeta desde el 1 oct** y el morado es de FedEx. La cifra del bloque hereda el
  violeta sin cambio; no se pidió tocarlo.
