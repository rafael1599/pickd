# Move: mover stock con números exactos por cuadro (idea-255)

Estudio, 7 oct 2026. Rediseño completo de «Relocate Stock»
(`src/features/inventory/components/MovementModal.tsx`). Maqueta a 430 px:
`docs/design/relocate-stock.html`. Nada construido. Las ❓ (§10) llevan su respuesta por defecto.

Rafael, 7 oct: «necesitamos antes de continuar darles la herramienta para que los usuarios en el
piso hagan los movimientos con los números exactos por sublocation, así vamos a ir llevando todo en
orden y hasta se puede entender mejor la lógica… quita LUDLOW porque todo es en este mismo almacén
de Ludlow, no se necesita mencionar. El rediseño debe ser completo, no quiero ver un parecido al
anterior, debe ser fácil de entender como item detail pero te puedes lucir más si quieres».

## 1. Contexto y problema

**Hoy el mover pierde las cajas.** `move_inventory_stock` suma la cantidad en el destino y no le
lleva ningún grupo (`adjust_inventory_quantity` sólo toca `distribution` al **restar**). Cada
movimiento a una fila donde el SKU ya estaba deja unidades sueltas:

| Prod, 7 oct (filas ROW activas con stock)             | Cifra           |
| ----------------------------------------------------- | --------------- |
| Filas con cajas de menos (`+n loose`)                 | **104** (994 u) |
| … de ellas, que recibieron un MOVE alguna vez         | **98**          |
| Filas con cajas de más (`−n extra`)                   | 6               |
| Filas cuyos grupos llevan cuadro (`square`, idea-253) | **0** de 561    |
| Filas con un solo cuadro / con varios                 | 514 / 47        |

Es la causa de casi todo el desajuste que idea-253 enseña como chip ámbar: la tarjeta lo deja
corregir, pero el mover lo vuelve a crear. Ejemplo vivo: **03-3982BL · ROW 33 · E,F,G = 90 u y
cajas 1×30** — Jed movió 60 ahí el 6 oct y las cajas no llegaron.

**Y pisa los cuadros del destino** (bug, lectura del código de `20261005234857`): tras sumar hace
`UPDATE inventory SET sublocation = p_sublocation` sobre la fila de destino. Mover 5 a una fila que
ya estaba en `F,G` eligiendo `H` deja `{H}`: F y G desaparecen. Con `p_sublocation` NULL (el mapa
cuando el destino no tiene letras) la deja sin cuadros.

**Uso real (prod, 30 días hasta el 7 oct): 531 MOVE.**

| Quién          | Movimientos | Unidades |
| -------------- | ----------- | -------- |
| Rafael         | 289         | 2 999    |
| Jed            | 169         | 3 462    |
| Roman          | 52          | 591      |
| sistema/intake | 21          | 78       |

- Destino: **460 a un ROW**, 33 PHOTO, 18 FDX RETURNS, 8 RETURN TO STOCK, 6 CAGE, el resto racks.
- **507 de 531 son parciales** (no se lleva toda la fila): se mueve un pallet, no una fila.
- **Notas: 27 de 531**; 14 las escribe el mapa (`Live BAY 3 NORTH: …`), ~8 son el nombre de la bici
  y **unas 3 las escribió una persona**. Rafael el 1 oct: «QUITA LAS NOTAS, NO QUIERO NINGUNA NOTA
  EN LOS MOVIMIENTOS».
- **Un solo almacén:** las 2 462 filas activas son `LUDLOW`. El selector «Target Warehouse» tiene
  una sola opción.
- El 6 oct hubo **85 MOVE**, el día con más; el piso empieza a mover con PickD.

**Lo que tiene hoy el sheet y sobra:** el almacén (dos veces), «picks/day», el banner «Merge
Opportunity», la nota con su texto de ayuda, el diálogo «Note Conflict» con cuatro botones, el
chip «Auto Distribution» (`4T×30`, una cifra que el piso no reconoce) y el `SublocationPicker`
A–F, que no sabe qué hay en cada cuadro.

**Lo que ya existe y se reutiliza (no se reinventa):**

- **La ficha (item detail)** — `ItemDetailView/ItemCardView.tsx` + `ItemCardParts.tsx`: tiles
  `#161920`, etiqueta pequeña en mayúsculas y cifra enorme (`WhereTile`, `HowManyTile`), y
  **`WherePicker` + `useWhereChoices`** (chips sugeridos, búsqueda con `predictLocation`, y la rejilla
  de cuadros del ROW con lo que hay en cada uno). Es el destino de este rediseño, casi tal cual.
- **Cuadros:** `utils/boxSquares.ts` (`unitsPerSquare`, `squaredGroups`, `groupUnits`),
  `squareEdit.ts`, `squaresForRow` (A–K + las que la fila ya usa), `unitsBySquare` (reparto parejo
  para filas sin cuadro por grupo), tabla `row_squares(location, letter, is_fast)`.
- **Pallets:** `palletsFor` (regla 9 de idea-254) y `towersAndLines` (niño) en
  `utils/distributionCalculator.ts`; glifos de `DistributionJengaViz` (`StrappedPalletGlyph`);
  `isSmallBikeSku`; el descuento top → base → line pallet (`deduct_from_groups`, idea-254 F2).
- **El choque al guardar** de la tarjeta (idea-253: `updated_at` + último `inventory_logs` →
  `Changed by Jed · 0 min ago — Reload`).
- **Undo:** `undo_inventory_action` (con `snapshot_before` restaura el origen y resta del destino;
  el destino **no** recupera sus cajas).
- **Modal Manager** (`useModal()`), `showConfirmation`, `useInventory().moveItem`.

## 2. Objetivo

Que quien está en el piso mueva **lo que tiene delante** —este pallet, de este cuadro, a ese
cuadro— en tres toques, y que la fila de origen y la de destino queden con sus pallets y sus
cuadros bien escritos, sin chip ámbar nuevo.

**Métricas:**

1. Un MOVE hecho con el sheet nuevo **no crea ni una unidad suelta**: el destino recibe sus grupos.
   Se comprueba con `move_detail` en el log (§6) contra la fila después.
2. Las filas con `+n loose` bajan de **104 a menos de 50** en dos semanas (las que el piso toque).
3. Las filas con grupos por cuadro suben de **0** a lo que se mueva: cada movimiento deja origen y
   destino con `square` en todos sus grupos.

## 3. Conceptos

- **Pallet.** Un grupo de `distribution` con su cuadro: `base 18`, `top 12` (siempre sobre una base,
  rosa 🪜), `line pallet 1–12`; los datos viejos siguen como `tower`, `line`, `pallet` hasta F4. Las
  unidades que las cajas no cubren se ven como un montón punteado **`loose`**, tocable como un
  pallet.
- **Carga.** Lo que se mueve: uno o varios pallets enteros (tocados) o un número (tecleado) sacado
  de un cuadro. Siempre de **un** cuadro de **una** fila; una cifra grande la resume.
- **Aterrizaje.** Dónde cae la carga: una ubicación y, si es ROW, uno o varios cuadros. **Cada
  cuadro tocado se llena hasta 30**; lo que no cabe pasa al siguiente que se toque.

## 4. El gesto

Se abre desde **⇄** de la tarjeta de Stock (como hoy), con la fila de la tarjeta como origen.

1. **Origen (arriba, ya puesto).** `ROW 1` en grande, y debajo la tira de cuadros de la fila con
   **sólo los de este SKU encendidos** en ámbar con sus unidades. Con un cuadro, ya está elegido. Con
   varios, tocar uno.
2. **La carga.** Bajo la tira se dibujan los pallets del cuadro elegido, compactos («compactar,
   nunca quitar»: `4×5` es un dibujo con `4×`).
   - **Tocar un pallet** lo levanta (anillo verde) y su número se suma a la cifra grande. Tocar más
     pallets suma; tocar de nuevo lo suelta.
   - **Tocar la cifra grande** abre el teclado numérico: un número que no coincide con pallets
     enteros se saca **en el orden de recoger** (top → base → line pallet; en los viejos, el orden de
     `deduct_from_groups`), y `loose` al final. La línea bajo la cifra dice de dónde sale, en cifras:
     `5 from top 🪜 · top 12 → 7`.
   - **`All`** junto a la cifra: todo el cuadro.
3. **Destino (abajo).** Un campo grande con el cursor ya puesto: **la Zebra escanea o se teclea**.
   `30`, `ROW 30`, `r30` → `ROW 30`; `30F`, `30 F`, `ROW 30-F` → `ROW 30` **y** el cuadro F. Debajo,
   los chips de `useWhereChoices` (las otras filas de este SKU primero, `same SKU`).
4. **El cuadro.** Si el destino es ROW aparece su tira de cuadros (las letras de `row_squares`, más
   las que la fila ya usa) con lo que hay en cada uno:
   - **vacío** — borde punteado, `·`; un punto verde si es accesible (`is_fast`);
   - **este SKU** — ámbar, con sus unidades;
   - **otro SKU** — gris con rayas, sus unidades y `+2` si hay más de uno;
   - **más de 30** — la cifra en rojo.

   **Tocar cuadros** reparte la carga: el primero se llena hasta 30, el resto pasa al siguiente que se
   toque. Cada cuadro tocado enseña `+30` y el resultado (`→ 30 DS`).

5. **El botón**, fijo abajo, es la confirmación: dice el movimiento entero en cifras, y encima las
   dos filas antes → después.

   ```
   ROW 1 · E   35 → 5        ROW 34 · A   0 → 30 DS
   [            Move 30  →  ROW 34 · A            ]
   ```

   Un toque escribe. Toast `Moved 30 · ROW 1 E → ROW 34 A` con **Undo** 8 s.

**Ramas:**

| Caso                                                                           | Qué pasa                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Origen con varios cuadros sin reparto** (47 filas: 03-3983GY · ROW 33 · B,C) | Al tocar un cuadro, una sola pregunta: `How many in B?` (teclado). El otro cuadro = el resto. Los grupos existentes se asignan a los cuadros hasta cubrir cada cifra; lo que falte queda `loose` en su cuadro. El reparto viaja con el movimiento: no hay que guardarlo aparte |
| **Origen con `+n loose`** (03-4666BR · ROW 1 · B: 41 u, cajas 22)              | El montón punteado `loose 19` se dibuja junto a los pallets y se toca como uno                                                                                                                                                                                                 |
| **Origen con `−n extra`** (6 filas)                                            | Chip ámbar `−7 extra` en el origen; no bloquea. La cifra máxima es la cantidad, no las cajas                                                                                                                                                                                   |
| **Mover una DS entera**                                                        | Tocar el dibujo de la DS levanta base + top juntos (una madera); aterriza igual en un cuadro vacío                                                                                                                                                                             |
| **Mover parte de un top**                                                      | Teclear 5 → `5 from top 🪜 · top 12 → 7`. Aterriza como line pallet 5 (o se junta, abajo)                                                                                                                                                                                      |
| **Destino vacío**                                                              | Un pallet entero cae como es. Unidades sueltas caen armadas por la regla 9 (`palletsFor`)                                                                                                                                                                                      |
| **Destino con el mismo SKU** (03-4466BR: ROW 3 · C → ROW 25 · C, que tiene 9)  | El cuadro se rearma con la regla 9 desde sus unidades mientras sea ≤ 30: 9 + 4 = **base 13** (una line pallet que crece pasa a base); 19 + 6 sería base 18 + top 7. `→ 13 base` en el cuadro                                                                                   |
| **Más de 30 en un cuadro**                                                     | El primero tocado se llena hasta 30 y la cifra que falta parpadea ámbar (`6 left`) pidiendo otro cuadro. Si se pulsa Move así, el cuadro queda en rojo `36 > 30` en la confirmación y **se escribe igual**: es aviso, no compuerta                                             |
| **Destino con otro SKU** (ROW 34 · E tiene 9 SKUs de 1)                        | Se puede: el cuadro sale rayado y la línea de antes → después dice `shared`. Nunca se sugiere: los chips sólo proponen cuadros vacíos o del mismo SKU                                                                                                                          |
| **Misma fila, otro cuadro** (Bring forward: B → A)                             | Destino = la fila de origen; su cuadro de origen sale bloqueado. El log es un MOVE con origen y destino iguales y `move_detail` `B → A`                                                                                                                                        |
| **Fila sin medir** (Bay 1, ROW 41+, `ROW 42 BURIED`)                           | Tira A–K + las que use la fila (`squaresForRow`), sin puntos de acceso                                                                                                                                                                                                         |
| **Destino que no es ROW** (CAGE, PHOTO, FDX RETURNS, containers, racks D/E)    | No hay paso de cuadro ni pallets (regla 11): el botón sale tras el destino. La fila nueva no lleva grupos                                                                                                                                                                      |
| **Bicis de niño** (`isSmallBikeSku`, 07-3742BK)                                | Se mueven pallets enteros como están; un número tecleado cae como **un** grupo del tipo de origen. PickD nunca rearma lo de niño                                                                                                                                               |
| **Partes** (32-0557 · D7 · 13 700)                                             | Sin tira, sin dibujos: la cifra y el destino. La pantalla se reduce a dos tiles                                                                                                                                                                                                |
| **Destino = origen sin cambiar de cuadro**                                     | El botón se apaga y dice `Same place`                                                                                                                                                                                                                                          |
| **Alguien cambió la fila mientras**                                            | No se escribe nada: `Changed by Jed · 0 min ago — Reload`, igual que la tarjeta. Reload conserva la carga si sigue cabiendo                                                                                                                                                    |

## 5. Modos y herramientas

Un solo modo. Lo que está y lo que no:

| Está                                                    | No está (y por qué)                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Foto, SKU, nombre (la cabecera de la ficha, en pequeño) | Almacén / LUDLOW — hay uno solo                                                                                                  |
| Origen: fila grande, tira de cuadros, pallets dibujados | `picks/day` — no decide nada al mover                                                                                            |
| La cifra grande con `All`                               | La nota — 3 de 531 la usaron; Rafael pidió quitarlas. Se sigue pudiendo añadir después en History (❓1)                          |
| Destino: campo de escaneo, chips, tira de cuadros       | «Merge Opportunity» — es el chip `same SKU`                                                                                      |
| Antes → después y el botón Move                         | «Note Conflict» — la nota interna del destino se queda; una fila nueva hereda la del origen (lo que ya hace la RPC). Sin diálogo |
|                                                         | «Auto Distribution» — se ve dibujado en el cuadro de destino                                                                     |

**Lenguaje visual** (los colores con dueño, ninguno nuevo):

- **Ámbar** = cuadro (las letras, los cuadros de este SKU), y lo que falta por colocar (`6 left`).
- **Rosa 🪜** = un top: la carga que sale de un top lleva el rosa.
- **Verde** = lo real que se mueve: el anillo del pallet levantado, el botón Move, el punto de
  cuadro accesible.
- **Rojo** = un cuadro que pasa de 30.
- **Gris rayado** = otro SKU. **Punteado** = vacío, y `loose`.
- Origen arriba y destino abajo, unidos por la cifra: se lee como una frase — _de ROW 1 · E, 30, a
  ROW 34 · A_.

## 6. Datos

**Se reutiliza sin cambios:** `row_squares`, `palletsFor`, `towersAndLines`, `isSmallBikeSku`,
`unitsPerSquare`/`squaredGroups`/`unitsBySquare`, `useWhereChoices`, `predictLocation`,
`keep_inventory_squares` (deriva `sublocation` cuando todos los grupos llevan cuadro), el choque de
idea-253, Modal Manager.

**Nuevo (aditivo):**

1. **RPC `move_stock_squares`** (una transacción, `SECURITY DEFINER`, una fila de origen):

   ```
   move_stock_squares(
     p_item_id bigint,                 -- la fila de origen (su almacén, implícito)
     p_expected_updated_at timestamptz,-- choque: distinto → error con quién y cuándo
     p_take jsonb,   -- [{square:'E', group:{type,units_each}, units:30}] | [{square:'B', units:11}] | [{square:'B', loose:true, units:19}]
     p_origin_split jsonb DEFAULT NULL,-- {B:28, C:30} cuando el origen no tenía reparto
     p_to_location text,
     p_land jsonb,   -- [{square:'A', units:30}, …]; [] fuera de ROW
     p_performed_by text, p_user_id uuid
   ) RETURNS jsonb  -- {log_id, from:{square:before→after}, to:{square:before→after}}
   ```

   - **Origen:** sella todos sus grupos con cuadro (un cuadro: ese; varios: `p_origin_split`), y
     descuenta lo que dice `p_take` — un grupo entero, o unidades en el orden de recoger dentro del
     cuadro, `loose` al final.
   - **Destino:** crea o suma la fila (sin `p_merge_note`, sin escribir nombre como nota). Escribe
     los grupos que llegan con su cuadro: entero → tal cual; parcial de adulto → la regla 9 sobre el
     total del cuadro mientras sea ≤ 30; de niño → un grupo del tipo de origen. Si el destino aún no
     tenía grupos con cuadro y tiene **una** letra, sus grupos se sellan con ella; con varias sin
     reparto, sus grupos quedan como estaban y `sublocation` = **unión** (nunca reemplazo).
   - Misma ubicación con otro cuadro **se permite** (hoy se rechaza).
   - Fuera de ROW: sin cuadros ni grupos (regla 11).
   - **Un** log `MOVE` (como hoy: `quantity_change`, prev/new del origen, `snapshot_before` del
     origen), más la columna nueva:

2. **`inventory_logs.move_detail jsonb`** (nullable): `{take, land, origin_split,
dest_item_id, dest_snapshot_before}`. History la lee para escribir `ROW 1 · E → ROW 34 · A ·
30` sin nota.
3. **`undo_inventory_action`**: si el log tiene `move_detail`, restaura **las dos** fotos (origen y
   destino) en vez de restar del destino; si el destino no existía, lo desactiva. La regla LIFO de
   hoy se mantiene (no se deshace si hubo otro movimiento después en esas filas).
4. **Arreglo en `move_inventory_stock`** (lo siguen usando intake, devoluciones, el mapa hasta P2):
   `sublocation` del destino = unión con lo que tenía, nunca reemplazo. Una línea.

**Front:** un componente nuevo `MoveSheet` (Modal Manager, no dentro de la tarjeta), con su parte
pura `moveLoad.ts` (la carga, el orden de recoger, el reparto en cuadros hasta 30, el antes →
después) con test. `inventoryService.moveSquares()` + `useInventory().moveSquares` con update
optimista y rollback. `MovementModal`, `useMovementForm`, la rama de sugerencias de
`useLocationSuggestions` y el diálogo de notas se borran en P2, cuando nada los llame.

**No se toca:** `inventory.quantity` sigue mandando; `plan_square_picks`; `row_squares`; la tarjeta.

## 7. Pantalla (430 px)

```
┌──────────────────────────────────────────┐
│ [foto] 03-3740BK                      ✕  │  cabecera de la ficha, en pequeño
│        DIVIDE 17" 2026 …                 │
├──────────────────────────────────────────┤
│ FROM                                     │
│ ROW 1                                    │  cifra de ficha
│ [A][B][C][D][E35][F][G][H]               │  sólo E encendido (ámbar)
│  E ▤tower 30 (levantado, verde)  ▯ 3  ⋮2 │  pallets dibujados + loose punteado
├──────────────────────────────────────────┤
│                30      [All]             │  la carga, enorme
│           1 tower · E 35 → 5             │
├──────────────────────────────────────────┤
│ TO                                       │
│ [ ROW 34                     ⌁ scan ]    │  cursor para la Zebra
│ (ROW 33 same SKU) (CAGE) (PHOTO)         │
│ [A·+30][B137][C45][D18][E9≡][F82]        │  A vacío y accesible
├──────────────────────────────────────────┤
│ ROW 1 · E  35 → 5    ROW 34 · A  0 → 30  │
│ [        Move 30  →  ROW 34 · A        ] │  verde, fijo, safe area
└──────────────────────────────────────────┘
```

- **En el teléfono:** hoja a pantalla completa (`z-[110]`, `pb-[env(safe-area-inset-bottom)]`), el
  botón fijo abajo, el contenido con su propio scroll. La tira de cuadros es una rejilla de tantas
  columnas como letras (11 en ROW 18–33: 34 px cada una a 430); con 12 o más baja a dos líneas.
- **En la Zebra (8"):** igual, `max-w-md` centrado; el campo TO recibe el foco al elegir la carga,
  así el escaneo cae ahí sin tocar nada.
- **A 1400 px:** la misma hoja, centrada, `max-w-md`; no se estira.

## 8. Fases

- **P1 — El sheet y la RPC.** `move_stock_squares`, `move_detail`, undo con dos fotos, el arreglo de
  unión en `move_inventory_stock`; `MoveSheet` abierto desde ⇄ de la tarjeta. Validado con rollback
  contra prod en los casos 1–12. **Checkpoint:** capturas 430 y 1400 de los casos 1, 3, 4, 7, 8, y
  la cifra de filas `loose` el día siguiente.
- **P2 — Un solo mover.** Lo usan también: el mapa (LIVE `runMove` y PLAN COMPLETED, que dejan de
  escribir nota), la píldora «Bring forward» (abre el sheet con `B → A` puesto) y Consolidation. Se
  borran `MovementModal` y lo que sólo él usaba. **Checkpoint:** grep sin llamadas a
  `move_inventory_stock` desde el front salvo intake/devoluciones.
- **P3 — Esperando.** Etiquetas de cuadro en el piso (`ROW 30 · F` con código) para que la Zebra
  ponga fila y cuadro de un escaneo. El parser de P1 ya las entiende.

## 9. Casos de verificación (prod, 7 oct)

| #   | Caso                                                                                                             | Pasos                                                                                               | Resultado y log                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **DS entera.** 03-3740BK · ROW 1 · E · 35 u (tower 30 + line 3, `+2 loose`)                                      | Tocar la torre; escanear `34`; tocar A (vacío, accesible); Move                                     | ROW 1: 35 → 5, grupos `line 3 · E`, `+2 loose`, `sublocation {E}`. ROW 34 nueva: 30, `tower 30 · A`, `{A}`. Log MOVE −30, prev 35 new 5, `move_detail.take [{E, TOWER 30, 30}]`, `land [{A, 30}]`, `dest_snapshot_before` null |
| 2   | **Número tecleado + loose.** 03-4666BR · ROW 1 · B · 41 (4×5 + 1×2, `+19 loose`)                                 | Cifra → 11; `20`; B                                                                                 | Sale en orden de recoger: line 2 + line 5 + 4 de otra line 5 → origen `line 1×1 · 2×5`, 30 u, `+19 loose`. ROW 20 · B: `line pallet 11`. Log MOVE −11, 41 → 30                                                                 |
| 3   | **Juntar mismo SKU.** 03-4466BR (Renegade C4 GRX) · ROW 3 · C · 4 (line 4) → ROW 25 · C · 9 (line 4, `+5 loose`) | Tocar la line 4; `25C`                                                                              | ROW 3: 4 → 0, inactiva. ROW 25 C: 9 → 13, rearmado **base 13** (el `+5 loose` desaparece: se arma desde las unidades). Antes → después `ROW 25 · C 9 → 13 base`. Log MOVE −4, `dest_snapshot_before.distribution = [line 4]`   |
| 4   | **Varios cuadros.** 03-3980BL · ROW 34 · F · 82 (tower 16 + 2×30, `+6 loose`)                                    | `All`; `20`; tocar B, C, E                                                                          | B `tower 30`, C `tower 30`, E 22 = tower 16 + 6 → **base 18 + top 4**. ROW 34 F: 82 → 0, fila inactiva. Un log MOVE −82, `land [{B,30},{C,30},{E,22}]`                                                                         |
| 5   | **Más de 30.** 06-4588BL · ROW 30 · K · 36 → ROW 31 · K (vacío)                                                  | `All`; `31`; K; Move sin tocar otro                                                                 | K se llena a 30 y `6 left` parpadea; Move escribe 36 en K con `K 36 > 30` en rojo. No bloquea                                                                                                                                  |
| 6   | **Otro SKU.** 03-4666BR 11 → ROW 34 · E (9 SKUs de 1 u)                                                          | Teclear 11; `34`; E                                                                                 | E rayado `9 · 9 SKUs`; antes → después `ROW 34 · E 9 → 20 shared`. Se escribe                                                                                                                                                  |
| 7   | **Misma fila.** 03-3740BK · ROW 1 · E: line 3 → ROW 1 · F (vacío)                                                | Tocar line 3; `1F`                                                                                  | Una fila: `tower 30 · E`, `line 3 · F`, `{E,F}`, 35 u. Log MOVE origen = destino = ROW 1, `move_detail E → F`, prev 35 new 35                                                                                                  |
| 8   | **Origen sin reparto.** 03-3983GY · ROW 33 · B,C · 58 (5×5 + 1×3 = 28, `+30 loose`)                              | Tocar C → `How many in B?` 28; `All` (30); `31K`                                                    | Origen: B `5×5 + 1×3` (28 ✓), C fuera, `{B}`, 28 u, **sin chip**. ROW 31 · K: 30 = **base 18 + top 12**. `move_detail.origin_split {B:28, C:30}`                                                                               |
| 9   | **Parte de un top** (fila sembrada en local hasta F4: base 18 + top 12 en un cuadro)                             | Teclear 5                                                                                           | Línea rosa `5 from top 🪜 · top 12 → 7`; destino vacío: `line pallet 5`                                                                                                                                                        |
| 10  | **No ROW.** 03-4666BR 2 → CAGE                                                                                   | `cage`                                                                                              | Sin tira de cuadros. CAGE: 2 u, sin grupos. Log MOVE −2                                                                                                                                                                        |
| 11  | **Niño.** 07-3742BK · ROW 42 · K · 158 (tower 28 + 4×30) → ROW 20 · F                                            | Tocar una tower 30; `20F`                                                                           | ROW 20 · F: `tower 30` tal cual; nada rearmado. Y tecleando 10: `tower 10`                                                                                                                                                     |
| 12  | **Parte.** 32-0557 · D7 · 13 700 → E21                                                                           | Teclear 200; `e21`                                                                                  | Dos tiles, sin dibujos. E21 +200. Log MOVE −200                                                                                                                                                                                |
| 13  | **Choque.** Abrir el caso 1; en otro dispositivo, −1 a 03-3740BK                                                 | Move                                                                                                | Nada escrito; `Changed by Jed · 0 min ago — Reload`; Reload enseña 34 y conserva la torre levantada                                                                                                                            |
| 14  | **Undo.** Tras el caso 3                                                                                         | Undo del toast                                                                                      | ROW 3 · C vuelve a 4 (`line 4`, activa); ROW 25 · C vuelve a 9 con `line 4` y su `+5 loose`. Log `is_reversed = true`                                                                                                          |
| 15  | **Bug de unión** (RPC vieja)                                                                                     | `move_inventory_stock` de 1 u de 03-3983GY a ROW 30 con `p_sublocation {H}` (la fila tiene `{C,D}`) | `sublocation {C,D,H}`; hoy quedaría `{H}`                                                                                                                                                                                      |

## 10. ❓ Preguntas (con respuesta por defecto)

1. **❓ La nota.** Por defecto **fuera del sheet**: el log sale sin nota, y quien la quiera la pone
   después en History (ya existe). La alternativa es un `+ note` pequeño y cerrado.
2. **❓ Juntar en un cuadro con el mismo SKU.** Por defecto **se rearma con la regla 9** desde las
   unidades del cuadro mientras sea ≤ 30 (9 + 4 = base 13; 19 + 6 = base 18 + top 7). La alternativa es dejar lo que
   llega como su propio pallet encima, sin rearmar.
3. **❓ Un cuadro con otro SKU.** Por defecto **se permite, rayado y con `shared`**, nunca
   sugerido: hoy ROW 1 · E tiene 3 SKUs y ROW 34 · E nueve de 1 u. La alternativa es bloquearlo
   salvo para bicis de 1 unidad.
4. **❓ Un número tecleado sale en el orden de recoger** (top → base → line pallet, `loose` al
   final). Por defecto sí: una regla, un motor. La alternativa es sacar primero lo `loose`.
5. **❓ El reparto del origen sin cuadros** (47 filas). Por defecto **una pregunta `How many in B?`
   la primera vez**, y viaja con el movimiento. La alternativa es repartir parejo sin preguntar.
6. **❓ Bring forward y el mapa usan este sheet** (P2). Por defecto sí: la píldora abre el sheet con
   `B → A` puesto en vez de preparar el cambio en la tarjeta, y el mapa deja de escribir su nota
   `Live BAY 3 NORTH: …`.

## 11. Riesgos

- **La regla 9 al juntar describe un pallet que el piso no armó** (19 + 6 no es físicamente base 18
  - top 7 hasta que alguien pase 1 caja). Es la misma idealización que F4 aceptó; el dibujo lo dice y
    la tarjeta lo corrige. Si Rafael dice no en ❓2, cae como pallet aparte.
- **Un build viejo sigue llamando a `move_inventory_stock`** y crea `loose`. El arreglo de unión
  evita lo peor (perder cuadros); el chequecito ámbar de `useAppUpdate` pide recargar.
- **El reparto por cuadro de otros SKUs es parejo** (`unitsBySquare`) mientras sus filas no tengan
  grupos con cuadro: la tira puede decir `≈`. Se marca así, no se esconde.
- **Escanear depende de cómo escribe la Zebra.** Sin etiquetas de cuadro en el piso (P3) se escanea
  sólo lo que exista impreso; el teclado numérico es el camino de siempre.
- **Undo con dos fotos** pisa cambios posteriores en el destino; la regla LIFO de hoy lo impide y lo
  dice (`Moved again after — undo that first`).

## Decisiones

- **7 oct 2026 — Estudio escrito**, con las cifras de prod del día. Esperando «ok».
