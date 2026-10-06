# Editar la distribución desde la tarjeta de Stock, y de qué cuadro se recoge

Estudio, 6 oct 2026 (idea-253). Extiende la tarjeta C (`docs/prds/stock-card-photo-first.md`, ya
construida). Maqueta a 430 px: `docs/design/stock-card-edit.html`. Tres partes, **las tres decididas
por Rafael el 6 oct**; lo que queda abierto va en §10 con su respuesta por defecto.

- **A.** Editar las cajas y la cantidad de cada cuadro **desde la tarjeta**, con los cambios en espera
  y un banner de confirmación, como la barra SAVE de la ficha.
- **B.** De qué cuadro de un ROW recoge Double Check: **el accesible con menos unidades**.
- **C.** Un SKU **activo** cuyo cuadro accesible se vacía con stock enterrado detrás avisa
  **«Bring forward»**.

## 1. Contexto y problema

**Hoy, para corregir las cajas de una fila hay que salir de la lista.** La tarjeta enseña la
distribución compacta (`8×30 │ 1×5`), pero cambiarla es ⋯ → Distribution, o abrir la ficha. Y los
números dicen que hace falta: hoy mismo Jed movió 03-3982BL de ROW 30 a ROW 31–33 (tres MOVE entre
las 19:03 y las 19:05, y un EDIT a las 19:16) y **las cajas no lo siguieron**:

| Fila               | Cuadros | Cantidad | Cajas dicen       | Diferencia     |
| ------------------ | ------- | -------- | ----------------- | -------------- |
| 03-3982BL · ROW 30 | F,G     | **54**   | 1×25 + 3×30 = 115 | **61 de más**  |
| 03-3982BL · ROW 33 | E,F,G   | **90**   | 1×30 = 30         | **60 sueltas** |
| 03-3983GY · ROW 33 | B,C     | **58**   | 5×5 + 1×3 = 28    | 30 sueltas     |
| 03-3983GY · ROW 30 | C,D     | 45       | 1×15 + 1×30 = 45  | —              |

**Cifras de prod (6 oct, 19:30, LUDLOW, `location ILIKE 'ROW%'`, activas con stock).** Rafael citó
546 / 106 / 37 por la mañana; los movimientos de la tarde las subieron:

| Qué                                           | Filas                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Filas ROW con stock (8 796 u)                 | **561**                                                               |
| … con distribución                            | 561                                                                   |
| … donde la suma de cajas ≠ la cantidad        | **111** (20 %)                                                        |
| … de ellas, cajas de menos (`+n loose`)       | 105                                                                   |
| … de ellas, cajas de más (`−n extra`)         | 6                                                                     |
| … con más de un cuadro                        | **47** (42 con 2, 3 con 3, 2 con 4)                                   |
| … de ellas, con cajas ≠ cantidad              | 23                                                                    |
| … sin cuadro                                  | 2 (03-3931BK `ROW 42 BURIED`, 03-3847BL `ROW 22`)                     |
| … con más de 45 u por cuadro (reparto parejo) | 30 (03-4034BK `ROW 34 · B` 137 u en un cuadro)                        |
| Grupos de cajas (`DistributionItem`)          | 737: 546 LINE, 146 TOWER, 44 PALLET, 1 OTHER; **ninguno usa `label`** |

La diferencia más común es pequeña: +1 (29 filas), +2 (16), +3 (13).

**Lo que existe y se reutiliza:**

- **La barra SAVE de la ficha** (`ItemDetailView/ItemCardView.tsx`, `utils/itemCardEdit.ts`): baseline
  y `cur`, un punto ámbar en lo que cambió, `SAVE · n changes` fija abajo, «Undo all», y un
  `showConfirmation('Unsaved changes', …)` al cerrar con cambios. Es el patrón que Rafael quiere aquí.
- **`InventoryCard`** con `compactDistribution` (`inventory/utils/stockCard.ts`) y los glifos de
  `DistributionJengaViz`.
- **`useInventory().updateItem`** — guarda la fila (cantidad, cuadros, cajas) con su log `EDIT` y su
  `snapshot_before`.
- **El motor del mapa** (`warehouse-map/engine/palletEngine.ts:599`):
  `isFast = edgeRow || d === 0 || d === rowDeep - 1`. Es la misma respuesta que usa DISTRIBUTE.
- **`pickSquare`** (`src/utils/pickingLogic.ts:64`, regla del 18 sep: la letra más alta). La usan
  `getOptimizedPickingPath`, `sortByLocation` (`liveResolution.ts:106`) y la letra que imprime
  Double Check (`DoubleCheckView.tsx:3499`).
- **`get_sku_movement_stats`** y **`get_promotion_candidates`** (migración `20260528111035`,
  «Bring to active» de /consolidation: picking_order ideal = `min + clamp(orders/5) × (max − min)`).

**Lo que falta en el modelo:** un grupo de cajas (`DistributionItem` = `{type, count, units_each,
label?}`) no sabe en qué cuadro está, e `inventory.sublocation` es `text[]` sin cantidad por cuadro.
Por eso el mapa reparte parejo (`allocate`: 159 u en 4 cuadros = 40/40/40/39) y Double Check no
puede saber cuál de los cuadros tiene menos unidades.

## 2. Objetivo

1. Corregir las cajas de una fila **sin salir de la lista**, en unos 10 s, viendo antes de guardar
   qué cambia y si las cajas cuadran con la cantidad.
2. Double Check manda al picker al **cuadro accesible con menos unidades**: primero se vacía la
   torre abierta, y los cuadros enterrados quedan de reserva.
3. **Métricas:**
   - las filas con cajas ≠ cantidad bajan de **111 a menos de 20** en dos semanas;
   - las 47 filas de varios cuadros tienen la cantidad de cada cuadro;
   - ninguna orden recoge de un cuadro enterrado si hay uno accesible con stock (se comprueba con el
     log, ver §9).

## 3. Conceptos

- **Grupo.** Lo que ya existe en `distribution`: `count` cajas de `units_each` del mismo tipo.
  **Ahora lleva su cuadro:** `{type, count, units_each, square: 'F'}`.
- **Cuadro.** Un cuadro del ROW (`ROW 30 · F`): un pallet, 30 u lo normal, **45 el tope**. **Su
  cantidad no se guarda: es la suma de sus grupos.** Así hay una sola fuente de verdad, y
  `sublocation` es la lista de cuadros que tienen grupos.
- **Accesible.** Un cuadro al que se llega sin mover otro pallet. Lo decide el `isFast` del motor:
  - la **A** (da al main hall);
  - la **última letra** (la cara del fondo; la K en ROW 18–33);
  - **cualquier cuadro de una fila de borde de bloque**.

  En prod, eso deja **enterrados** sólo los cuadros de las filas del medio de un bloque:
  - ROW 21, 24, 27, 28, 31 y 32: B–J;
  - ROW 37: B–E.

  En Bay 2 todos los cuadros son accesibles. Bay 1 y ROW 41+ no los usa el motor (§4.B).

- **Activo.** Un SKU con **≥ 2 órdenes completadas en 90 días**, **o** que /consolidation pondría en
  «Bring to active». En prod hoy:
  - 205 de 529 bicis con stock en ROW cumplen lo primero;
  - **311** cumplen una de las dos.

## 4. El gesto

### A. Editar desde la tarjeta

1. **Tocar un número de la línea de cajas** (el `30` de `2×30`, o el `2`) abre el **teclado
   numérico** en una hoja corta (Modal Manager). Escribir y aceptar. El número queda con **anillo
   ámbar** y la tarjeta también. El resto de la tarjeta sigue abriendo la ficha.
2. **Tocar la letra de un grupo** (la `F` delante de `2×30`) abre las letras del ROW en una fila:
   - **tocar otra letra** mueve el grupo entero;
   - si el grupo tiene más de una caja, **`Split`** separa `count − 1` cajas y luego se toca su
     letra (2×30 en F → 1×30 en F + 1×30 en G).
3. **`+`** al final de la línea de cajas añade un grupo:
   - tipo (Tower / Line / Pallet), cuántas, de cuánto y cuadro;
   - el cuadro por defecto es el primero de la fila.
4. **El banner** aparece fijo abajo con el primer cambio:
   `03-3982BL · 2 changes · F 90→60 · G 54→84   [Discard] [SAVE]`.
   - Las cifras son la cantidad por cuadro, antes→después.
   - Si no caben, se corta con `…` y el número de cambios sigue a la vista.
5. **`SAVE`** abre la confirmación (Modal Manager):
   - una línea por cuadro con antes → después;
   - **Boxes** contra **Qty**;
   - si no cuadran, un aviso ámbar **`+7 loose`** / **`−7 extra`**, que **no bloquea**;
   - **`Confirm`** escribe.
6. **`Discard`** descarta sin preguntar.
7. **Una tarjeta a la vez.** Con cambios pendientes, tocar otra tarjeta (o su número) pregunta
   `Unsaved changes · 2 changes on 03-3982BL` con `[Discard] [Save]`. Es el mismo
   `showConfirmation` que la ficha.
8. **Choque al guardar.** Antes de escribir se relee la fila:
   - si `updated_at` no es el que se cargó, no se escribe nada y el banner dice
     **`Changed by Jed · 1 min ago — Reload`**;
   - el nombre y la hora salen del último `inventory_logs` de esa fila;
   - `Reload` trae la fila nueva y **vuelve a aplicar encima los cambios pendientes**, que siguen en
     ámbar;
   - **nunca se sobrescribe**.

**Ramas:**

- **Sin grupos** (`no boxes`). El `+` es lo único que hay.
- **Fila de varios cuadros sin reparto** (las 47 de hoy). Al primer toque todos los grupos se ponen
  en el **primer cuadro** (`F` de `F,G`) y la línea enseña el chip **`split?`** sobre los demás
  cuadros, que salen con `0`. Guardar así se puede, con aviso ámbar en la confirmación.
- **La cantidad llega a 0** (− hasta 0, o una orden). Se vacían los grupos y los cuadros, y la
  tarjeta queda punteada como hoy.

### B. De qué cuadro recoge Double Check

Para una línea de N unidades en un ROW con varios cuadros de ese SKU:

1. **Primero los accesibles** (el `isFast` del motor).
2. **Entre los accesibles, gana el que tiene menos unidades.** Rafael: «la sublocation que es
   accesible y tiene la cantidad más baja gana».
3. **Desempate: la letra más alta**, que es la regla del 18 sep. Rafael: «no se reemplaza, se
   complementa y ahora ya no es ley».
4. **Si todos están enterrados:**
   - primero el que está **al lado de un accesible** (§10 ❓1);
   - luego el de menos unidades;
   - luego la letra más alta.
5. **Dentro del cuadro: la línea abierta antes que la torre llena.** Es el orden en que
   `adjust_distribution` descuenta (PALLET → LINE → TOWER, la más pequeña primero), pero **filtrado
   al cuadro elegido**.
6. **Si N es más de lo que tiene el cuadro, se vacía y se sigue con la misma regla:**
   - **`J 4 + A 2`** si J tiene 4 y A tiene más;
   - Double Check imprime los dos.

**Casos que salen de la regla:**

- **Antes de que exista la cantidad por cuadro** (o en una fila que aún no se ha repartido), el paso
  2 se salta: accesible → al lado de un accesible → la letra más alta.
- **Filas que el motor no dibuja o no están medidas** (Bay 1 / ROW 41+, ROW 18–19, `ROW 42 BURIED`,
  `ROW 20B`): **la A primero**, y después la letra más baja.

**En pantalla.** La letra que hoy pone Double Check junto al ROW pasa a ser la elegida, con la
cantidad que se toma de ella entre paréntesis y el porqué en dos palabras, en gris:

- `ROW 30 · C (1)  open · fewest`
- `ROW 31 · B (1)  next to A`
- `ROW 30 · J (4) + A (2)`

El porqué se oculta con la línea marcada, como hoy la letra.

### C. «Bring forward»

1. **Cuándo.** Una orden completada deja **en 0 el último cuadro accesible** de un SKU **activo**
   en esa fila, y quedan unidades en un cuadro enterrado de la misma fila. Es lo contrario de
   DISTRIBUTE, que entierra lo lento y deja las caras libres.
2. **Dónde.** La tarjeta de Stock de esa fila enseña una **píldora ámbar** que palpita, sin frase:
   `Bring forward · B → A`.
3. **Tocarla** abre ⇄ (el mover de hoy) con el cuadro enterrado como origen y el accesible vacío
   como destino.
4. **Se apaga sola** cuando un cuadro accesible vuelve a tener stock de ese SKU. No hay botón de
   descartar: es ayuda insistente, nunca un bloqueo (LESSONS, 6 oct).

## 5. Modos y herramientas

| Estado de la tarjeta | Qué se ve                                                                                                                                   | Qué no                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Reposo               | La C de hoy. Cada cuadro lleva **su letra** delante de sus grupos (`F ▤2×30 │ G ▤1×24`), y el chip `+n loose` / `−n extra` cuando no cuadra | Anillos, banner        |
| Con cambios          | Anillo ámbar en cada número cambiado y en la tarjeta, y el banner abajo                                                                     | − ⇄ + (atenuados, ❓2) |
| Teclado / letras     | Hoja corta del Modal Manager sobre la lista                                                                                                 | —                      |
| Confirmación         | Antes → después por cuadro, Boxes / Qty, el aviso ámbar si no cuadra                                                                        | —                      |

**El lenguaje visual:**

- El **ámbar** es lo pendiente, como en la ficha.
- El **verde** es la cantidad guardada.
- El chip de desajuste también es ámbar, pero **sin anillo**: es un hecho, no un cambio pendiente.
- La letra de cada grupo es la misma casilla ámbar del ROW, en pequeño.

## 6. Datos

**Reutilizado sin cambios:**

- `updateItem` (escribe `distribution` y `sublocation` en una sola llamada, con log `EDIT` y
  `snapshot_before`);
- `showConfirmation`, Modal Manager;
- `get_sku_movement_stats_batch`, `get_promotion_candidates`;
- `inventory.updated_at` (lo pone `adjust_distribution` y todo writer), `inventory_logs`.

**Nuevo o cambiado:**

1. **`DistributionItem.square?: string`.**
   - `distribution` es `jsonb`: la clave nueva no toca el esquema, es aditiva por naturaleza.
   - Hay que añadirla al **Zod** (`inventory.schema.ts`), porque `z.object` **quita las claves que
     no conoce** y la primera lectura borraría los cuadros.
   - También a los tipos ×2.
2. **Migración aditiva: los writers de `distribution` conservan `square`.** Hoy
   `adjust_distribution` reconstruye cada grupo con `jsonb_build_object(type, count, units_each[,
label])`, así que **el primer pick borraría el cuadro**. Hay que repasar:
   - `adjust_distribution` (más un `p_square text DEFAULT NULL` que limita el descuento a ese
     cuadro);
   - `adjust_inventory_quantity` (pasa los cuadros elegidos);
   - `move_inventory_stock`, `calculate_bike_distribution` (al fundir);
   - `split_unit`, `undo_inventory_action`, `rename_sku_everywhere`;
   - el trigger `set_default_inventory_distribution` (un grupo nuevo nace sin cuadro).

   Se valida con rollback contra prod antes de aplicarla, como `20261006181655`.

3. **`sublocation` se deriva.**
   - Un trigger `BEFORE UPDATE`: si todos los grupos llevan cuadro, `sublocation` = los cuadros
     distintos, ordenados.
   - Si algún grupo no lleva cuadro (las 561 filas de hoy), `sublocation` no se toca.
   - Ningún writer viejo se rompe.
4. **Puro y con test** (`inventory/utils/stockCard.ts`):
   - `squareTotals(distribution, sublocation)` → `{F: 60, G: 84}`;
   - `distributionChanges(base, cur)` → las líneas del banner;
   - `mismatch(distribution, qty)` → `+7` / `−7`.
5. **`pickPlan(row, squares, need)`** en `src/utils/pickingLogic.ts`, junto a `pickSquare`:
   - devuelve `[{letter, take, why}]` y aplica §4.B;
   - `pickSquare` se queda como el desempate (paso 3), no se borra;
   - `getOptimizedPickingPath`, `sortByLocation` y Double Check leen `pickPlan`.
6. **`squareAccess(location)`**, un solo motor:
   - se construye una vez por zona con `calculateLayout(zone, defaultEngineState())` (memo), y devuelve
     por letra `{fast, nextToFast}`;
   - vive en el motor (`warehouse-map/engine/`, puro, sin React) y `src/utils/` lo reexpone, para
     que picking no importe de otra feature;
   - Bay 1 devuelve `null`, y `null` = «la A primero».
7. **El mapa lee la cantidad por cuadro** cuando los grupos de la fila llevan cuadro, y `allocate`
   (reparto parejo) queda para las filas sin reparto. LIVE `runMove` mueve **los grupos del cuadro**
   junto con la letra; si no, el mapa volvería a desordenar lo que la tarjeta ordenó.
8. **Activo** (`isActiveSku`):
   - un batch: `get_sku_movement_stats_batch(skus, now() − 90 d)` ∪ los SKUs de
     `get_promotion_candidates(2, true, NULL)`;
   - una consulta por pantalla de Stock, `staleTime` 10 min;
   - **ni una regla nueva de velocidad**: las dos que ya existen, unidas.

**No se toca:** `inventory.quantity` sigue siendo el stock (las cajas describen, no mandan); `−` y
`+` de la tarjeta siguen guardando al momento; `locations`, `slot_plans`.

## 7. Pantalla (430 px)

```
┌──────────┬──────────────────────────────────┐
│          │ 03-3982BL              [F,G]  54 │
│  foto    │ CITIZEN 2 21" 2026 MONTEREY BLUE │
│          │ F ▤⁽¹×30⁾ │ G ▤⁽¹×24⁾ │ +        │   ← números con anillo ámbar
│          │ [ − ]   [ ⇄ ]   [ + ]      [⋯]   │   ← atenuados mientras hay cambios
└──────────┴──────────────────────────────────┘
          …lista…
┌─────────────────────────────────────────────┐   fixed, encima de la BottomNavigation
│ 03-3982BL · 2 changes · F 115→30 · G 0→24   │
│ [ Discard ]                    [   SAVE   ] │
└─────────────────────────────────────────────┘

Confirmación (hoja)                 Teclado (hoja)            Letras (hoja)
 03-3982BL · ROW 30                  F · Tower · units each    Move 1×30 tower
 F   115 → 30                        [  30  ]                  [A][B][C][D][F][G][H][I][J][K]
 G     0 → 24                        1 2 3 / 4 5 6 / 7 8 9     (sin E: ROW 30 no tiene E)
 Boxes 54 · Qty 54  ✓                ⌫ 0 OK                    [ Split 2×30 → 1 + 1 ]
 [ Cancel ]  [ Confirm ]
```

**En el teléfono:**

- El banner tiene dos líneas: los cambios arriba y los botones abajo, a todo el ancho, con
  `pb-[env(safe-area-inset-bottom)]`.
- La lista suma el alto del banner a su `pb-32`, para que la última tarjeta no quede tapada.
- La línea de cajas cabe en una línea con hasta tres grupos y el chip (~300 px de los ~316 que deja
  la foto). Con más grupos, **pasa a una segunda línea**, nunca se corta: «compactar, nunca quitar».
  La letra va **una vez por cuadro**, delante de sus grupos (`F ▤3×30 ▤1×25`).
- El teclado es el **numérico del sistema** (`inputMode="numeric"`) dentro de la hoja. En la Zebra
  ET401 es el mismo.

## 8. Fases

- **P1 — Editar con cuadro (A).**
  - `square` en Zod, tipos y writers (migración).
  - El trigger de `sublocation`.
  - La tarjeta: letra por grupo, teclado, letras/Split, `+`, banner, confirmación, choque.
  - El mapa lee la cantidad por cuadro y `runMove` mueve los grupos.
  - **Checkpoint:** capturas a 430 y 1400 de los casos 1–4 y la cifra 111 → ? al día siguiente.
- **P2 — El cuadro que se recoge (B).**
  - `squareAccess`, `pickPlan`, Double Check con letra (cantidad) y porqué.
  - El descuento por cuadro (`p_square`).
  - **Checkpoint:** casos 5–10 en local con una orden sembrada, y el log de cada uno.
- **P3 — Bring forward (C).**
  - `isActiveSku` y la píldora en la tarjeta.
  - **Checkpoint:** caso 11 y cuántas píldoras saldrían hoy.

## 9. Casos de verificación (prod, 6 oct)

| #   | Caso                                                                                                                  | Pasos                                                                                 | Resultado y log                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 03-3982BL · ROW 30 · F,G · 54 u · cajas 1×25 + 3×30                                                                   | En reposo                                                                             | Chip **`−61 extra`**. Al tocar, todo cae en F (115) y G sale `0` con `split?`                                                                                                      |
| 2   | La misma                                                                                                              | Grupos → F 1×30, G 1×24; SAVE → Confirm                                               | Banner `2 changes · F 115→30 · G 0→24`; confirmación `Boxes 54 · Qty 54 ✓`. Log **EDIT** 54→54, `snapshot_before.distribution` = 1×25+3×30; `sublocation` = `{F,G}` por el trigger |
| 3   | 03-3982BL · ROW 33 · E,F,G · 90 u · 1×30                                                                              | Chip **`+60 loose`**; `+` tower 1×30 en F y `+` 1×30 en G                             | Banner `E 30 · F 0→30 · G 0→30`, 2 changes; confirmación ✓ 90/90. Log EDIT                                                                                                         |
| 4   | Choque                                                                                                                | Abrir 03-3983GY ROW 33 (58 u, 5×5+1×3); en otro dispositivo, − 1; en el primero, SAVE | Nada se escribe; banner `Changed by <user> · 0 min ago — Reload`; Reload enseña 57 y conserva el cambio pendiente                                                                  |
| 5   | 03-3983GY · ROW 30 · C,D · 45 u, repartido C 1×15 · D 1×30                                                            | Orden de 1                                                                            | ROW 30 es fila de borde: C y D accesibles. **Gana C (15)**; antes ganaba D. DC: `ROW 30 · C (1) open · fewest`. Log **DEDUCT** 45→44; C queda 1×14, D 1×30                         |
| 6   | 03-3983GY · ROW 31 · B,C · 60 u                                                                                       | Orden de 1, sin reparto                                                               | ROW 31 es fila del medio: B y C enterrados; B está al lado de A. **Gana B** (antes, C). DC: `ROW 31 · B (1) next to A`                                                             |
| 7   | 03-3982BL · ROW 31 · F,G · 2×30, repartido 30/30                                                                      | Orden de 1                                                                            | Enterrados y ninguno al lado de un accesible; mismas unidades → letra más alta, **G**, igual que antes. G queda 1×29 (TOWER)                                                       |
| 8   | La misma, segunda orden de 1                                                                                          | —                                                                                     | **G otra vez** (29 < 30): primero la torre abierta. G 1×28                                                                                                                         |
| 9   | Partido entre cuadros (ejemplo de Rafael)                                                                             | ROW 30 con J 4 y A 30; orden de 6                                                     | `ROW 30 · J (4) + A (2)`; log DEDUCT 34→28; J vacío y fuera de `sublocation`                                                                                                       |
| 10  | 03-4035BL · ROW 43 · A,B · 195 u (Bay 1)                                                                              | Orden de 1                                                                            | Sin motor: **A** (antes, B)                                                                                                                                                        |
| 11  | 06-4735BK (7 órdenes en 90 d, activa) · ROW 32 · A,B · 25 u (cajas 1×3 + 1×5: `+17 loose`), corregida a A 1×5 · B 4×5 | Órdenes hasta vaciar A                                                                | Píldora **`Bring forward · B → A`** en la tarjeta; tocarla abre ⇄ B→A; tras el MOVE, la píldora se apaga                                                                           |
| 12  | 03-4034BK · ROW 34 · B · 137 u                                                                                        | Abrir para editar                                                                     | La confirmación avisa en ámbar **`B 137 > 45`**; no bloquea                                                                                                                        |
| 13  | ROW 30 · E (no la dibuja el motor; hoy 03-4038BL tiene 7 u ahí)                                                       | Letras de un grupo de ROW 30                                                          | La E sale **sólo** en la fila que ya la usa; en las demás no se ofrece                                                                                                             |
| 14  | Dos tarjetas                                                                                                          | Cambios en 03-3982BL; tocar 03-3978BL                                                 | `Unsaved changes · 2 changes on 03-3982BL`, con [Discard] [Save]                                                                                                                   |

## 10. ❓ Preguntas (con respuesta por defecto)

1. **❓ «Al lado de un accesible» (§4.B paso 4).** Por defecto, **en la misma fila**, la letra
   contigua: en ROW 31 la B (junto a la A) y la J (junto a la K). El cuadro de al lado en la fila de
   borde no cuenta, porque para llegar hay que sacar ese otro pallet. La alternativa es contar
   también los de la fila de al lado.
2. **❓ − ⇄ + con cambios pendientes.** Por defecto **atenuados**: tocar uno dice `Save or discard
first`, como la ficha. Si no, un `+` guardado al momento movería la base de lo pendiente.
3. **❓ La letra por grupo en reposo.** Por defecto **siempre visible** (`F ▤2×30`): una fila de un
   solo cuadro también la lleva, y ocupa 12 px. La alternativa es enseñarla sólo cuando la fila
   tiene varios cuadros.
4. **❓ Dónde avisa «Bring forward».** Por defecto **sólo en la tarjeta de Stock**. La alternativa es
   avisar también al picker en Double Check, en la línea que vacía el cuadro.
5. **❓ La palabra del botón.** Rafael aceptó `Discard`; la ficha dice `Undo all`. Por defecto las
   dos dicen **`Discard`**, con un cambio de una palabra en la ficha.
6. **❓ Activo = 311 de 529.** Con la unión, un SKU con 2 órdenes en julio cuenta (03-4035BL: 1 en
   90 días, pero está en «Bring to active»). Por defecto, **la unión tal como se decidió**: la
   píldora sólo sale cuando de verdad se vacía una cara con stock detrás, así que no hace ruido. La
   alternativa es sólo los 205 de 90 días.

## 11. Riesgos

- **Un writer que olvide `square` borra los cuadros sin avisar.** Mitigación:
  - un test de SQL que pasa una fila con cuadros por cada writer de la lista y comprueba que
    salen;
  - un test de Zod.
- **Una página con el build viejo guarda `distribution` sin `square`.** El trigger de `sublocation`
  no la toca (algún grupo sin cuadro) y el `UPDATE` cambia `updated_at`. El que tiene el build
  nuevo ve el choque. `useAppUpdate` ya pone el chequecito en ámbar.
- **La geometría es estática (v1).** Un cuadro enterrado no pasa a accesible cuando se vacía el de
  delante. En ROW 31, con la A vacía, la B sigue contando como enterrada; el paso 4 la elige igual,
  porque está al lado de un accesible. Lo dinámico (que la B sea accesible si la A está vacía) es
  v2, en Fuera.
- **Las cajas no mandan sobre la cantidad.** Un conteo o el AS400 cambia `quantity` sin tocar las
  cajas, y sale el chip. Es a propósito: el chip pide corregir, no corrige solo.
- **Un SKU lento en una cara rápida** no es asunto de Double Check ni de esta tarjeta: es Clear row /
  «Send to slow» en /consolidation.

### Casos límite (con su default)

| Caso                                              | Default                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cajas ≠ cantidad                                  | Chip ámbar `+7 loose` / `−7 extra` en la tarjeta y aviso en la confirmación; nunca bloquea     |
| Una orden toma 1 de una torre de 8×30 en F        | F queda 7×30 + 1×29 (TOWER), los dos en F                                                      |
| `+` sin cuadro                                    | El grupo nace en el primer cuadro de la fila; sin cuadros (2 filas), pide la letra             |
| Mover parte del stock a otra ubicación            | ⇄ de hoy (`moveItem`); los grupos que salen se descuentan del cuadro elegido con la regla §4.B |
| Un cuadro con más de 45                           | Aviso ámbar en la confirmación (`B 137 > 45`); no bloquea                                      |
| Una letra que la fila no tiene                    | No se ofrece. Si ya la usa (ROW 30 · E), se conserva y el mapa la lista en «NOT ON THIS PLAN»  |
| Conteo / AS400 cambia la cantidad, no las cajas   | Sale el chip                                                                                   |
| La cantidad llega a 0                             | Grupos y cuadros vacíos; tarjeta punteada                                                      |
| Las 47 filas de varios cuadros sin reparto        | Al primer toque todo cae en el primer cuadro y el chip `split?` lo pide                        |
| Un cuadro enterrado cuando el de delante se vacía | v1 geometría fija (paso 4 lo cubre); v2 dinámica                                               |
| SKU lento en un cuadro rápido                     | Lo resuelve Clear row, no Double Check                                                         |

## 12. Fuera

- La geometría dinámica (v2).
- Editar cajas desde el mapa (sigue moviendo pallets).
- Cambiar `−` / `+`.
- Reabrir la regla de velocidad de /consolidation.
- Las partes, que no tienen cuadros.

## Decisiones

- **6 oct 2026 — Rafael decide las tres partes:**
  - **A:** editar en espera con banner y confirmación, una tarjeta a la vez, Discard sin preguntar,
    y nunca sobrescribir un cambio ajeno.
  - **B:** accesible → menos unidades → letra más alta → al lado de un accesible → línea abierta
    antes que torre → vaciar y seguir. La regla del 18 sep «se complementa y ya no es ley».
  - **C:** activo = ≥ 2 órdenes en 90 días o «Bring to active».
- **6 oct 2026 — Estudio escrito** con las cifras de la tarde, que ya no son las de la mañana: los
  movimientos de Jed en 03-3982BL subieron las filas con desajuste de 106 a 111 y las de varios
  cuadros de 37 a 47.
- **6 oct 2026 — Rafael: «me gusta, impleméntalo»**: los seis ❓ con su respuesta por defecto. El
  mismo día anuncia el modelo siguiente (idea-254): **todo es pallet** — la DS pallet (base ~18 + top
  ~12 = 30; menos de 19 pasa a base), la line sólo sobre una pallet, sin torres. Esta entrega usa los
  tipos de hoy (TOWER / LINE / PALLET); el `square` de cada grupo no depende del tipo, así que sirve
  igual cuando los tipos cambien.
- **6 oct 2026 — P1 hecho.** Migraciones `20261006212938` (writers conservan `square`, trigger de
  `sublocation`) y `20261006222431` (reetiquetar un cuadro no arrastra a los demás: el mover del
  mapa que lleva F a H en una fila F,G movía también G por posición), validadas con rollback contra
  prod y aplicadas. La tarjeta: letra por cuadro, número → teclado, dibujo o letra → mover / Split,
  `+`, chip `−61 extra`, anillo ámbar, banner, confirmación y choque (`Changed by Jed · 0 min ago`,
  Reload conserva lo pendiente). El mapa lee la cantidad de cada cuadro de las cajas cuando cuadran.
  Revisado a 430 px en local con el caso 1–2 (03-3982BL ROW 30: `F 115→30 · G 0→24`, Boxes 54 · Qty
  54 ✓, guardado F 1×30 · G 1×24) y el 4 (choque). **Desvío:** el aviso al tocar otra tarjeta dice
  `[Keep editing] [Discard]` en vez de `[Discard] [Save]` — guardar se hace con la barra, y cerrar el
  aviso por accidente no descarta nada.
