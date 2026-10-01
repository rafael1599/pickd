# Item Detail reinventado: la ficha de la caja

Estudio, 1 oct 2026. Prototipo: https://claude.ai/artifact/5MtSR6mv7Emzwr2Anf4w5A (430 px,
botones «Register» / «Existing item» arriba). Nada de esto está construido.

Rafael: «reinventa la vista item detail en base a un registro intuitivo, tienes libre creatividad».

## El problema, medido en la vista de hoy

`ItemDetailView.tsx` tiene 1.913 líneas, y registrar una caja hoy pasa por:

1. una **puerta de tipo a pantalla completa** (Bike / Part) antes de ver nada;
2. si hay etiqueta, **otra hoja** (`LabelScanSheet`) que la lee y después abre el formulario;
3. un formulario de **~8 tarjetas** (identidad, cantidad, info, ubicación + letras, nota,
   distribución, caja, otras ubicaciones, historial) en el mismo orden para registrar y para
   mirar;
4. en un ítem existente, un botón **Edit / View** que cambia toda la pantalla de modo.

Se registra en tres preguntas — **qué es, dónde está, cuántas hay** — y la pantalla no las
dice: las reparte entre tarjetas que también existen para otras cosas (distribución, historial).

## La idea

**La pantalla es la etiqueta de la caja.** Arriba, una pegatina dibujada como la del cartón
(SKU grande, modelo, talla, color, serial, UPC, código de barras, BIKE/PART, NEW o `S/D #n`).
Debajo, dos respuestas en cifras: **WHERE** (`ROW 24 · F`) y **HOW MANY** (`7`). Debajo, la
caja (`55 × 8.5 × 30.5 · 45 lb` con `DEFAULT` o `MEASURED`). Abajo, **un solo botón**.

La misma pantalla sirve para registrar y para un ítem existente; lo único que cambia es el
botón de abajo.

## Requisitos

1. **Registrar empieza por la cámara.** La pantalla abre con «Shoot the carton label» y, debajo,
   «No label — type the SKU». La foto se lee **en la misma pantalla**: los campos de la pegatina
   se pintan con el estado que ya usa el lector — punto verde leído, ámbar con las dos lecturas
   como botones, rojo vacío («tap to add»). Se retira `LabelScanSheet` como paso aparte; su
   lógica (`buildSkuLabelDraft`, `settleDraftField`, `serialLooksReal`) se reutiliza tal cual.
2. **BIKE / PART vive en la pegatina, sin valor por defecto.** Sustituye a la puerta a pantalla
   completa: mientras nadie lo elija, el par parpadea en ámbar y REGISTER no se habilita. Si la
   etiqueta lo dijo, viene marcado (el lector ya lo devuelve). Se mantiene la regla de que un
   tipo equivocado por defecto corrompe `is_bike`.
3. **Tocar un valor es editarlo.** Desaparece el botón Edit / View: cada campo de la pegatina,
   WHERE y HOW MANY son tocables y abren una hoja corta con un campo y **Done**. El SKU de un
   ítem existente no se edita ahí: renombrar reescribe historial y va en ⋯ → Rename SKU.
4. **WHERE en dos toques.** Tocar WHERE abre: chips de sugerencia (`predictLocation`: la fila
   del mismo modelo, una con hueco, `RETURN TO STOCK`, `UNKNOWN`), un buscador para otra, y, si
   es una ROW, **sus cuadros A–K con las unidades que ya hay en cada uno** (el mismo dato que
   pinta el mapa). Tocar el cuadro cierra el selector. Lo lleno (≥ 30) en ámbar; en un ítem
   existente, el cuadro actual marcado.
5. **HOW MANY es una cifra.** Número grande, − y + a los lados, tocar el número para teclearlo.
   En un ítem existente, al cambiar enseña la diferencia (`+3`); ese delta es lo que se escribe
   con `adjust_inventory_quantity` (ADD / DEDUCT), igual que hoy.
6. **Un solo botón abajo.** Registrando: tres marcas `What · Where · How many` que se ponen en
   verde y `REGISTER +12 → ROW 24 · F`, deshabilitado hasta que las tres estén. En un ítem
   existente no hay botón hasta que algo cambia; entonces `SAVE · 2 changes` y «Undo all». Cada
   valor cambiado lleva un punto ámbar y dice lo que era (`was ROW 24 · F`).
7. **La caja es una línea con su verdad.** `55 × 8.5 × 30.5 in · 45 lb` + `DEFAULT` (punteado) o
   `MEASURED` (verde), leído de `dimensions_verified` / `weight_verified`. Tocarla abre la misma
   captura de `useUpdateCartonDimensions` que Measure y Double Check. Una parte enseña solo el
   peso. Al registrar no se piden: el trigger pone el default y la bandera queda en false.
8. **S/D es un estado de la pegatina.** Esquina inferior: `NEW`, o `S/D #147` grande. Marcar o
   desmarcar va en ⋯ (y en el `NEW` de la esquina al registrar); con S/D aparece la tarjeta
   `SdDetailsCard` debajo, sin cambios.
9. **Lo demás de un ítem existente son hechos, en una lista bajo «Also»**: otras ubicaciones del
   SKU (`22 · ROW 25 · D`), reservado por órdenes abiertas (`3 · #881702 · #881715`), y los
   últimos movimientos (`−2 · Picked for #881690`). Cifra a la izquierda, una línea, toca para
   abrir. Sustituye a `OtherLocationsCard`, `StockReservationBreakdown` e `InlineItemHistory`
   como tarjetas; los datos y consultas son los mismos.
10. **⋯ guarda lo ocasional**: Print label, Photo, Rename SKU, Shelf note, Mark as S/D, Delete.
11. **Distribución (TOWER / LINE / PALLET) sale de la pantalla.** Se sigue calculando con
    `calculateBikeDistribution` al guardar; quien quiera cambiarla la tiene en ⋯ (fase 2).
12. **Palabras en inglés en pantalla**, nombres de la base (`ROW 24 · F`, `UNKNOWN`), 430 px y
    1.400 px revisados antes de pedir el ok.

## Lo que no cambia

Las escrituras: `executeSave` (modo `add`: inventario primero, metadata después; no mandar
dimensiones ni peso si son el default del tipo), `normalizeSkuOnRegister`, la letra de cuadro
solo en ROW, `register_new_sku`, `zz_touch_open_orders_for_sku`. La reinvención es de la
pantalla; ningún contrato con la base se toca.

## Casos de verificación

| #   | Caso                                        | Esperado                                                                                                                             |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| V1  | Foto de RENEGADE C2 con talla ambigua 54/56 | SKU, modelo, color verdes; talla ámbar con `54cm` y `56cm`; serial rojo; REGISTER deshabilitado hasta elegir talla, WHERE y cantidad |
| V2  | Sin etiqueta, teclear `03-0288`             | Se guarda `03-0288` (canónico); BIKE/PART parpadea sin selección                                                                     |
| V3  | WHERE → ROW 24                              | Cuadros A–K con `30 28 12 · · 7 30 · · · ·`; tocar F cierra y el tile dice `ROW 24 · F`                                              |
| V4  | Existente 03-3982BL, qty 7 → 10             | Tile con `+3` y punto ámbar; `SAVE · 1 change`; escribe un ADD de 3                                                                  |
| V5  | Existente, mover F → ROW 25 · D             | `was ROW 24 · F`; guardar hace `moveItem`, no editar + ajustar                                                                       |
| V6  | Undo all tras 2 cambios                     | Todo vuelve, el botón desaparece, nada escrito                                                                                       |
| V7  | Registrar parte                             | Caja dice `1 lb · DEFAULT`, sin cuadros si la ubicación no es ROW                                                                    |
| V8  | Tocar SKU de un existente                   | No edita; indica ⋯ → Rename SKU                                                                                                      |
| V9  | 430 px                                      | Nada se parte: `ROW 24 · F` y la cifra caben; pegatina sin scroll horizontal                                                         |

## Fases

- **F1** — Pantalla nueva para **registrar** (requisitos 1–7, 12), detrás de la misma ruta de
  alta. El detalle de un existente sigue con la vista vieja.
- **F2** — Ítem **existente** (3, 5, 6, 8–11). Se borra la vista vieja, `TappableField` /
  `useActiveField` (hoy no los importa nadie) y `LabelScanSheet` como hoja.
- **F3** — El lote por fotos (`/batch`) usa la misma pegatina para cada tarjeta.

## ❓ Preguntas abiertas (con default)

1. ❓ **¿La pegatina imita el cartón (papel claro sobre fondo oscuro)?** Es la única superficie
   clara de la vista. _Default: sí_ — es lo que el operario compara con la caja que tiene delante.
2. ❓ **¿Registrar abre la cámara directamente** en vez de enseñar el botón? _Default: no_, botón
   grande; abrir la cámara sola sorprende cuando no hay etiqueta.
3. ❓ **Al guardar un ítem existente, ¿confirmación?** _Default: no_ — el botón ya dice cuántos
   cambios y el historial permite deshacer.
4. ❓ **¿La distribución TOWER/LINE/PALLET sigue haciendo falta en pantalla?** _Default: no_, va
   a ⋯ (requisito 11).
5. ❓ **¿REGISTER exige WHERE?** _Default: sí_, pero `UNKNOWN` es un chip de primera fila para
   quien no lo sepa todavía.
6. ❓ **Cantidad 0 al registrar** (placeholder). _Default: permitida_, el botón dice `+0`.

## Decisiones

- **1 oct 2026 — «go»: los seis ❓ con su default.** F1 construida el mismo día:
  `RegisterItemView` (`components/ItemDetailView/`) atiende todo `mode = 'add'` —Stock, el
  alta desde Double Check y `useOpenSkuDetail`—; un ítem existente sigue en la vista vieja
  hasta F2. La lógica pura vive en `utils/registerItem.ts` (con tests). `LabelScanSheet` se
  retiró: «Add SKU · Foto» abre la misma pantalla directo en la cámara. Tres cosas que el
  estudio no decía y que salieron al probarla:
  - un SKU tecleado o leído que el catálogo ya tiene **rellena lo que el catálogo sabe**
    (tipo, modelo, talla, color, UPC), solo donde está vacío;
  - el «CONFLICTO: a ≠ b» del lector no se ofrece como opción, y un serial que no pasa
    `serialLooksReal` (`BICYCLING`) sale en rojo, no en verde;
  - el catálogo **solo recibe lo que alguien dijo**: un campo vacío no se manda (registrar un SKU
    conocido en una segunda ubicación ya no le borra el modelo), el serial va a `sku_serials`
    salvo en una S/D, y el UPC de la etiqueta sí entra (el formulario viejo lo perdía).
  - El cuadro no es obligatorio (como antes): la ROW queda abierta pidiendo uno, y Register
    acepta la ROW sola.
- **1 oct 2026 — F2 construida.** Un ítem existente abre `ItemCardView`: la misma pegatina
  (piezas comunes en `ItemCardParts.tsx` / `itemCardShared.ts`), WHERE y HOW MANY con el
  punto ámbar y «was …», `SAVE · n changes` / «Undo all», y «Also» con otras ubicaciones,
  reservas y los últimos cuatro movimientos. ⋯ = Print label, foto, Shelf note, Distribution,
  Rename SKU, S/D, Full history, Delete. La lógica pura en `utils/itemCardEdit.ts` (con tests).
  Lo que no estaba escrito:
  - **La caja se guarda al momento**, no con SAVE: una medida es un hecho cuando se lee. Va por
    `useUpdateCartonDimensions`, que sella `dimensions_verified` / `weight_verified`.
  - **El catálogo recibe solo lo que cambió** (la vista vieja reescribía la fila entera,
    medidas incluidas). Modelo, talla y color van juntos porque juntos nombran la fila; un
    rename escribe la fila completa bajo el nombre nuevo, con medidas solo si eran medidas.
  - Se retiraron `TappableField`, `useActiveField`, `SectionRow`, `DetailToolbar`,
    `DistributionPreview`, `QuantityControl`, `PhotoHero`, `useDominantColor`,
    `StockReservationBreakdown`, `OtherLocationsCard` e `InlineItemHistory`.
  - **Pendiente F3**: el lote por fotos (`/batch`) con la misma pegatina.
- **1 oct 2026 — el año del nombre.** Rehacer el nombre tiraba el año (`c76658bc` lo conserva
  ahora). La migración `20261001163539` devolvió el año a **707 filas de 314 SKUs** (Rafael:
  «as400 gana, después la uno»: el de `as400_description`, si no el de otra fila del mismo
  SKU), en el sitio donde lo escribe el AS400, entre talla y color. Cada cambio está en
  `item_name_year_restores` (append-only, lectura admin) con el nombre anterior. Quedan sin
  año 426 filas: 357 sin fuente (sobre todo S/D `01-`) y 69 con talla compuesta o nombre roto
  que no se pudieron ubicar. Un mismo SKU puede quedar con dos años en dos filas (2025 en una
  tanda vieja, 2026 en el AS400): se dejó así a propósito.
