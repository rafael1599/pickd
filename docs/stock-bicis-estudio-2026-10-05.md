# Bases del stock de bicis: la bici especial — dos opciones

Estudio de Claude, 5 oct 2026. Lo pidió Rafael tras el de agy (`photo-bikes-agy-2026-10-05.md`) con
la misma consigna: libertad total y solo dos opciones con bases firmes. Los datos se midieron en
prod entre las 13:00 y las 14:30 NY. El AS400 se lee de `sku_metadata.as400_snapshot`, con fechas
del 12 al 24 sep. El código se leyó en `main` @ `70e3df1b`. Contexto del problema: `photo-bikes.md`.

## 0. El hallazgo que ordena todo: el AS400 ya resolvió esto

El AS400 no cuelga la bici especial de su SKU de modelo. **Le da un número de artículo propio.**

| Familia AS400 | Qué es                                                   | Evidencia (5 oct)                                                                                                                                                           |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-NNNN`     | **una S/D = un número**, con el serial en la descripción | «S/D ALLEGRO A3 23 GREY M220308704» (`01-0448`). 141 de las 154 S/D con SKU de catálogo son `01-`, y 135 dicen `S/D` en el AS400. Solo 1 SKU S/D tiene más de 1 u en PickD. |
| `02-NNNNCC`   | **photo y demo**                                         | 29 bicis `02-`: 13 `PHTO`, 4 `PHOTO`, 12 `DEMO` («HARDLINE C2 17 2020 HAZZARD DEMO CAGE NJ»).                                                                               |

PickD ya sigue esa convención a medias: el alta rápida de S/D propone el siguiente `01-NNNN`
(`SDQuickIntakeModal.tsx:68` → `fetchNextSku`, `scratchAndDentApi.ts:116`). La migración de S/D lo
dejó escrito: «Each S/D bike has a unique SKU (1 row per physical unit)»
(`20260417100000_extend_sku_metadata_for_sd.sql:4`).

Los problemas de hoy salen del **hueco entre que la bici se vuelve especial en el piso y que tiene
número propio**:

- **26 PH en PHOTO siguen con su SKU de modelo** (`03-`/`07-`). Comparten nombre y foto con las
  nuevas, y el picking las ve como nuevas (`photo-bikes.md` §5).
- **46 S/D usan el serial como SKU** (40 con stock), sin ningún campo que diga su modelo
  (`createUnit`, `scratchAndDentApi.ts:223-277`, guarda `model` como texto, no el SKU). **5 de ellas ya
  tienen un `01-` en el AS400** con ese serial en la descripción: la misma bici existe con dos
  identidades.
- **Las 12 DEMO `02-` están marcadas S/D** en PickD, y la PH `02-3661GY` (`PHTO` en el AS400) también.
  PickD no tiene dónde decir «demo» ni «photo».
- **bug-055:** reusar un `01-` viejo para una S/D nueva deja al AS400 describiendo la bici anterior.

## 1. Lo que ata cualquier diseño (medido)

- **Toda la identidad cuelga del SKU.** Foto, serial, flags S/D y condición solo existen en
  `sku_metadata`. `image_url` aparece en 19 archivos, `serial_number` en 25 y hay 33 llamadas a
  `from('sku_metadata')`. Ningún lector une por `inventory.id`. La etiqueta codifica el SKU: QR
  `/s/{sku}` (`labelLayout.ts:395`), Code 128 del SKU (`:746`). El lector de etiquetas busca por SKU
  (`catalogLookup.ts:89-104`).
- **El stock se mueve por (sku, warehouse, location), nunca por unidad.** 21 funciones SQL cambian
  `quantity`. 13 de ellas pasan por `adjust_inventory_quantity`
  (`20260924190538_…:20`, busca `WHERE sku = p_sku …` en `:56`, sin id de fila). Además el cliente
  escribe `inventory` directo: `inventory.service.ts` `addItem`/`updateItem`/`deleteItem`
  (:313, :421, :531–:693, :773), que usan Stock Count (`StockCountScreen.tsx:685`), Edit y Add. Y
  `createUnit` inserta S/D con qty 1 (`scratchAndDentApi.ts:262`).
- **El picking ignora el id de fila.** Los ítems lo llevan (`picking.schema.ts:7`), pero
  `process_picking_list` lee solo sku, warehouse, location y qty (`20260927011500_…:566-571`), y el plan
  arma claves `${sku}-${warehouse}-${location}` (`usePickingActions.ts:1097`, `planPick.ts:75,115`).
- **El ledger no ata unidad:** `inventory_logs.item_id` no tiene FK, y `sku` es texto que
  `rename_sku_everywhere` reescribe.
- **El serial todavía no es identidad.** `sku_serials` es único por (sku, serial), no tiene ubicación y
  tiene 23 filas. idea-244 (`docs/prds/scan-serials.md`) le añade «visto en tal ROW» y declara
  **no mover stock nunca**. El serial falla en tres sitios: el QR a veces se repite, el lector confunde
  O con 0, y una bici abierta puede no tener etiqueta.
- **Renombrar un SKU con historial ya existe:** `rename_sku_everywhere(old, new)` reescribe 9 tablas
  (inventory, logs, snapshots, picking_lists.items, cycle counts…), fusiona si el destino existe y
  deja rastro en `sku_canonical_renames` (`20260826220000_canonical_sku.sql:107`).
- Volumen: 9.698 bicis en 694 filas activas. 313 filas tienen 1 sola unidad.

---

## Opción A — La bici especial es su propio artículo, como en el AS400

**En una frase:** toda bici que deja de ser «nueva de catálogo» (S/D, photo, demo) tiene **su propio
SKU y su propia ficha**, igual que en el AS400. Mientras el AS400 no le da número, lleva un SKU
provisional, que se renombra al número del AS400 cuando llega.

**Esquema (aditivo):**

- `sku_metadata.unit_kind` `text check in ('new','sd','photo','demo')`, default `'new'`.
  `is_scratch_dent` se mantiene como espejo de `unit_kind = 'sd'` (trigger), así ningún lector actual
  cambia.
- `sku_metadata.base_sku text` = el SKU del modelo (`03-4229BL`). Llena el hueco de las 46 S/D con
  serial y permite volver al modelo para avisos, peso y medidas.
- `sku_metadata.serial_number` ya existe y en una bici especial es de la unidad. Ahí sí es correcto,
  porque la ficha es de una sola bici.
- El sufijo de nombre (` S/D`, ` PH`, ` DEMO`) se generaliza desde `sd_item_name()` para leer
  `unit_kind`.
- **Una sola RPC nueva:** `split_unit(p_from_sku, p_warehouse, p_location, p_qty, p_kind, p_serial,
p_new_sku)`. Hace tres cosas: (1) crea la ficha copiando la del modelo (peso, medidas, `is_bike`,
  talla, color; no la foto) con `base_sku` y `unit_kind`; (2) mueve las unidades con dos llamadas a
  `adjust_inventory_quantity`; (3) escribe un log. **No toca ninguno de los 21 escritores.**
- **SKU provisional:** el número del AS400 si ya existe (`01-`/`02-`). Si no, el serial. Sin serial
  legible, `03-4229BL-PH1`. Cuando el AS400 asigna número, `rename_sku_everywhere(provisional,
número)`.

**Los casos de hoy:**

| Caso                                             | Qué pasa                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `02-3054TL` (PH, 2 u, `PHTO`)                    | Ya es su artículo: `unit_kind='photo'`, `base_sku` según el modelo («EXPLORER A1 S/T 16 2024», ❓ cuál `03-`). Las 2 u comparten ficha porque el AS400 las agrupa: es la decisión del AS400, no la nuestra. |
| `03-4229BL` (1 PH en PHOTO + 5 nuevas en ROW 37) | `split_unit` → SKU = su serial (o `03-4229BL-PH1`), `photo`, `base_sku=03-4229BL`. Las 5 nuevas no se tocan.                                                                                                |
| S/D `01-0448`                                    | Ya es así: `unit_kind='sd'`, falta `base_sku`.                                                                                                                                                              |
| S/D `Y21I001153` (serial como SKU)               | Se le llena `base_sku`. Si el AS400 ya le dio `01-` (5 casos), `rename_sku_everywhere` → el `01-` y desaparece la doble identidad.                                                                          |
| PH sin serial legible                            | `03-4229BL-PH1`. canonical_sku lo deja intacto (probado). El watchdog no lo genera nunca (su regex no acepta `-`, `parser.py:348-356`).                                                                     |
| 12 DEMO `02-` marcadas S/D                       | `unit_kind='demo'` (❓ si demo es S/D o un tipo propio).                                                                                                                                                    |

**AS400, watchdog, picking, etiquetas, fotos, filtros:**

- **Picking: excluir no cuesta nada.** Una orden de `03-4229BL` nunca ve una PH con otro SKU, porque
  `adjust_inventory_quantity` y el plan buscan por SKU. El aviso «no hay nueva, hay PH» es **un** lugar:
  en `generatePickingPath` (`usePickingActions.ts:1097`), cuando falta stock, buscar por `base_sku`.
  Solo es un aviso; no se asigna.
- **Watchdog:** una orden que pide `02-3054TL` cae directo en su artículo. Sin cambios.
- **AS400:** si la hipótesis del +1 es cierta (5 de 6), sacar la PH de su SKU **arregla** el descuadre.
  Los SKUs provisionales aparecen en `v_inventory_vs_as400` sin contraparte: filtrarlos por
  `unit_kind <> 'new' and sku !~ '^0[12]-'` hasta que tengan número.
- **Etiquetas, fotos, filtros:** salen solas, porque todo ya lee por SKU. El filtro es `cond` en
  `stockFacets.ts` (`src/features/inventory/utils/`) más la pestaña. Las etiquetas imprimen el SKU propio.

**Migración sin parar:** columnas → trigger espejo → backfill (`unit_kind` desde `is_scratch_dent` y
desde `PHTO`/`PHOTO`/`DEMO`; `base_sku` de las 46 a mano o por la descripción) → `split_unit` de las 26
de PHOTO. Cada paso es reversible y ninguno toca filas de bicis nuevas.

**Qué la rompería:**

1. **Que nadie apriete el botón.** Una bici se abre para foto y sigue como nueva. Las 26 de hoy son
   esa prueba. Mitigación: aviso cuando una ubicación PHOTO, o una CAGE de S/D, tiene unidades
   `new`.
2. **La disciplina de números del AS400.** Reusar un `01-` (bug-055) mezcla dos bicis, y PickD no
   puede impedirlo. El rename solo resuelve provisional → definitivo.
3. **Dos unidades bajo un mismo `02-`** comparten ficha. Si hay que separarlas, `split_unit` otra vez.

**Por averiguar:** quién da los números `01-`/`02-` en la oficina y con qué demora. Si el AS400
renumera las PH `03-` (las 26 de PHOTO dicen que a veces no). El conteo actual del AS400 de los 6 SKUs
del +1.

---

## Opción B — Una capa de unidades físicas

**En una frase:** se agrega `bike_units`, **una fila por bici física** (id, sku, serial nullable, kind,
warehouse, location, sublocation, status, overrides de nombre/foto/nota). El SKU vuelve a ser solo
«modelo», y la identidad de cada bici es su unidad.

**Dos alcances posibles:**

- **B1, solo especiales:** unas ~150 filas (110 u S/D + 37 en PHOTO; las demos no tienen stock en PickD).
- **B2, todas:** 9.698 filas, alimentadas por el escaneo de idea-244.

**Lo que exige, medido:**

- **Consistencia unidad ↔ cantidad.** `inventory.quantity` sigue siendo la verdad del picking y de
  21 funciones SQL más los escritores del cliente (Stock Count escribe directo). Hay dos caminos:
  - **Cada escritor nombra la unidad:** se reescriben los 21 y los del cliente, y `process_picking_list`
    pasa a resolver por unidad. Es el rediseño del inventario.
  - **Las unidades se reconcilian aparte:** dos verdades que se separan. Es la familia de bugs que ya
    se pagó: filas fantasma, `qty=0` activa, la migración aplicada antes que su frontend.
- **Separar la PH de verdad** obliga a que el plan de pick reste las unidades especiales del stock del
  SKU en esa ubicación. Eso toca `planPickAcrossLocations` (`pickLocation.ts:287-356`),
  `stockMinusClaims` y `process_picking_list`, que hoy ignora el id.
- **Ver la foto o el nombre de la PH** obliga a que cada lector consulte la unidad: 19 archivos de
  `image_url`, 33 de `sku_metadata`, la etiqueta (`/s/{sku}` → `/u/{unit}`) y el lector de etiquetas.
- **El serial como llave** hereda sus tres fallas. B2 depende de idea-244, que hoy es un P0 de 20 cajas
  en ROW 38.

**Lo que da:**

- Trazabilidad por bici: dónde está la de tal serial y quién la movió.
- Ningún SKU inventado ni nada que renombrar; el AS400 ve el mismo SKU.
- Es la base para la pistola y para garantías y devoluciones por serial.

**Qué la rompería:** cualquier escritor que no pase por la unidad. Hoy hay al menos 3 en el cliente y
la deducción del picking. Basta uno para que las unidades y la cantidad digan cosas distintas, y ya no
hay a quién creerle.

---

## Comparación

|                                           | A — artículo propio                              | B — capa de unidades                                     |
| ----------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| Encaja con el AS400                       | **Igual que él** (`01-`/`02-`)                   | El AS400 sigue por SKU; PickD tendría más detalle que él |
| Separa la PH de la nueva                  | Sí, por SKU                                      | Sí, por unidad                                           |
| Picking                                   | Excluye gratis; 1 aviso nuevo                    | Reescribir plan + deducción                              |
| Escritores de stock tocados               | 0 de 21 (+1 RPC nueva)                           | 21 + cliente, o dos verdades                             |
| Lectores tocados (foto, nombre, etiqueta) | 0                                                | ~50 sitios                                               |
| Serial                                    | Opcional (provisional)                           | Llave; hereda sus fallas                                 |
| Futuro (pistola, idea-244)                | Compatible: los seriales siguen en `sku_serials` | Es su destino natural                                    |
| Tamaño                                    | Días                                             | Semanas a meses, con riesgo en picking                   |

## Recomendación: A ahora, sin cerrarle la puerta a B

A sigue la convención que el AS400 ya usa para 170 bicis y que PickD empezó a copiar
(`fetchNextSku`). No toca ninguno de los 21 escritores ni los ~50 lectores, y la exclusión del picking
sale gratis. B es la base correcta **cuando el serial sea fiable y esté escaneado**, y eso es lo que
idea-244 empieza a medir. Hacer B antes sería apostar el picking a una llave que hoy falla en tres
sitios.

A además prepara a B. `base_sku` + `unit_kind` + serial son exactamente los atributos que tendría una
fila de `bike_units`. El día que la pistola tenga cobertura, B se construye primero como capa de
**lectura** sobre `sku_serials` (dónde está cada serial), sin tocar la cantidad. Solo después, si se
justifica, pasa a mover el stock.

## ❓ Para Rafael

1. ¿**DEMO** es una S/D o un tipo propio? (12 bicis `02-` DEMO marcadas S/D.)
2. ¿Quién da los números `01-`/`02-` en el AS400? ¿Se le puede pedir uno para cada PH `03-`?
3. ¿El AS400 cuenta hoy las 6 PH `03-` con stock nuevo? Basta mirar `03-4229BL` en NJ: si dice 5, la
   PH está fuera.
