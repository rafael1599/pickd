# S/D: reusar el SKU de una S/D vendida sin perder su historia (idea-257)

Estudio, 7 oct 2026. Nada construido, ninguna migración. Las ❓ (§10) llevan su respuesta por
defecto: un «ok todo» las cierra. Cifras leídas de prod el 7 oct (SELECT de solo lectura).

Rafael, 7 oct: «los SKU de S/D vendidas sí se reutilizan. Quiero una lógica que nos permita
mantener el historial y a la vez reutilizar SKUs de bicis ya vendidas… así evito tener que ponerle
01-8496NV a los 01-8496». Llave de una unidad: **su `#`**, que nunca se recicla (`sdCode`,
`sd_code()`, `20261007144844`). Decidido el mismo día: los sufijos que ya existen (01-0357XE,
01-0376TR, 01-0169CO, 01-8496NV) se quedan; una S/D cuyo modelo tiene stock nuevo lleva **su serial
como SKU** con `base_sku` = el modelo (#74 `Y21K012242` → `03-3606BL`), en vez de `-SD1`.

## 1. Contexto y problema

**Toda la identidad de una S/D cuelga del SKU.** Serial, `#`, foto, condición, precios, For sale, PDF,
descripción del AS400 y medidas viven en la fila de `sku_metadata`; las fotos extra en `sku_photos`
(por `sku`); la historia en `inventory_logs` (por `sku`); las ediciones del Sheet en `sd_sheet_edits`
(por `sku`). Una sola fila de catálogo por SKU, así que **reusar el SKU = escribir la bici nueva
encima de la vieja**. Hoy, por cada puerta:

| Puerta (código)                                                      | Qué hace con un SKU de S/D vendida (qty 0)                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Register (`RegisterItemView.tsx:214`)                                | **Rellena modelo, talla, color y UPC de la bici vieja**; al guardar pisa serial y deja lo demás (condición, PDF, precios) mezclado |
| `useScratchDentHolder` (`itemCardShared.ts:229`)                     | Bloquea sólo si la S/D está en un estante; vendida no bloquea → cae en la fila de arriba                                           |
| `rename_sku_everywhere` (serial provisional → `01-` que da el AS400) | El destino existe → **fusiona**: la ficha vieja gana, sólo rellena huecos (`photo-bikes.md`, 5 oct)                                |
| `rename_sku_everywhere`, historia                                    | Reescribe **todos** los `inventory_logs` y **todas** las órdenes (`picking_lists.items`) del SKU viejo, sin fecha de corte         |
| Mark as S/D con más de una unidad (`ItemCardView.tsx:300`)           | Una confirmación y marca **el SKU entero** S/D — así nacieron #76 y #78 (se separaron a mano a `-SD1`)                             |
| `split_unit` (`20261005204330`)                                      | SKU = número dado › serial › `<modelo>-SD1`. Ya prefiere el serial; `-SD1` sólo cuando nadie le pasa uno                           |

**Cifras (prod, 7 oct):**

| Qué                                                                      | Cifra                                                                      |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| S/D en el catálogo (`unit_kind = 'sd'`)                                  | **197**: 83 con `#` (todas en stock), 35 en stock sin `#`, **79 vendidas** |
| Las 79 vendidas: cómo salieron (último log negativo)                     | 40 DEDUCT con orden · 30 DEDUCT sin orden · 1 DELETE · **8 sin registro**  |
| `01-` sin marcar S/D y en 0 (el AS400 da `01-` a cada S/D)               | 7 (p. ej. `01-0169`, «S/D ALLEGRO A3», `unit_kind = 'new'`)                |
| S/D que comparten SKU con bicis nuevas (lo que el SHIP CHECK pinta rojo) | **0** · S/D con más de una unidad: **0**                                   |
| S/D con el serial como SKU · con `base_sku` · con `-SD1`                 | 47 · 3 (#74, #76, #78) · 2 (`03-3769BL-SD1` #78, `03-4040BK-SD1` #76)      |
| `sku_photos` de S/D · `sd_sheet_edits`                                   | 4 fotos · 11 ediciones                                                     |
| S/D en stock cuyo texto del AS400 termina en **otro** serial             | **14** (lista en §5.4)                                                     |
| `sd_number_seq`                                                          | 83 → la próxima es **#84**                                                 |

El caso que lo resume: **01-0376**. Fue «Boss Cruiser 7 18" Raspberry», serial `Y22E001903`; Jed la
movió el 17 jul (ROW 33 → ROW 20) y la descontó el **17 ago en la orden 881180**. El AS400 sigue
diciendo `S/D BC 7 18 RASPBERRY Y22E001903`. El 6 oct llegó una Trilogy 56 con ese número y, para no
pisar la vieja, se registró como **`01-0376TR`** (#81); aun así su descripción del AS400 es la de la
Raspberry.
Con 01-8496 pasó lo mismo (`01-8496NV`), aunque `01-8496` ni siquiera existe en PickD: el sufijo sólo
evitaba el AS400.

## 2. Objetivo

Una S/D nueva puede llevar el `01-` de una vendida **tal cual**, y la vendida queda entera y legible:
`#`, serial, nombre, foto, condición, cuándo y en qué orden salió, sus logs.

**Métrica:** de aquí en adelante, **0 SKUs nuevos con sufijo** (`XE`, `TR`, `NV`, `-SD1`) y, en cada
reuso, la unidad vieja aparece en la ficha con su serial y su orden de salida.

## 3. Conceptos

- **Unidad S/D** — una bici física. Su llave es su **`#`**. Mientras está en el almacén, **es la fila de
  catálogo de su SKU** (como hoy: los 33 lectores de `sku_metadata` no cambian).
- **Unidad archivada** — una S/D que salió y cuyo SKU se le dio a otra. Vive en **`sd_units`**, una foto
  fija de su fila de catálogo, su portada y el tramo de logs que le pertenece. Las 79 vendidas anteriores
  al 30 sep no tienen `#`: se archivan con `—` (❓2).
- **Reusar** — darle a una bici nueva el SKU de una S/D **vendida** (cantidad total 0). Pasa en el
  momento en que la bici nueva llega a ese SKU, nunca antes.

Descartado: una fila de `sd_units` también para las unidades vivas. Serían dos fuentes para el mismo
serial (catálogo y unidad) y una regla, una fuente.

## 4. El gesto

No hay botón «Reuse». Reusar ocurre sólo donde ya se escribe un SKU para una bici nueva:

**A. Register** (Stock → + o Double Check → Register), alguien escribe o lee `01-0376`:

1. **SKU libre** → como hoy.
2. **S/D en un estante** (`01-0357`, #44 en ROW 12 E) → como hoy: rojo, no deja registrar.
3. **S/D vendida** (`01-0376`, qty 0) → una línea ámbar bajo el SKU, sin bloqueo:
   `01-0376 · BC 7 18 RASPBERRY · Y22E001903 · SOLD 17 AUG · 881180 → history`. Los campos **no** se
   rellenan con la bici vieja. Al pulsar **REGISTER**: (a) se archiva la vieja, (b) se registra la nueva
   en la fila limpia. La primera impresión le da **#84**.
4. **S/D vendida sin registro de salida** (las 8) → la misma línea con `LEFT · NO RECORD`.
5. **`01-` vendido que nunca fue S/D en PickD** (los 7, p. ej. `01-0169`) → igual que 3: un `01-` es una
   S/D del AS400.

**B. Renombrar** (ficha → SKU; el serial provisional pasa al `01-` que dio el AS400):

1. Destino libre → como hoy.
2. Destino = **S/D vendida** → se archiva el destino y la ficha nueva **gana entera** (no se fusiona).
   La bici renombrada conserva su `#`.
3. Destino = S/D en un estante → no deja: `01-0357 is #44 on ROW 12 E`.

**C. Mark as S/D** en un SKU con más de una unidad o con stock en otra fila (ficha → ⋯):

1. Pregunta **el serial** (campo grande, el lector de etiquetas lo llena si lo lee).
2. Separa **una** unidad con `split_unit` (`kind = 'sd'`): SKU = el serial, `base_sku` = el modelo, el
   resto sigue nuevo. Lo de #74.
3. Sin serial legible → **`SD84`**: el `#` se asigna ahí mismo y es el SKU (❓3). Nunca `-SD1`.
4. Si el SKU tiene una sola unidad y nada más en otra fila → marca el SKU entero, como hoy.

**D. Lo que no reusa nunca:** el ±1 del ⋯ sobre una S/D en 0 (`Y21A003411`, un deshacer, una bici que
apareció), la cola del watchdog, el Sheet. Una cantidad que vuelve no es una bici nueva.

## 5. Modos y herramientas

### 5.1 Lo vivo y lo archivado

Vivo = como hoy (tarjeta llena, verde/ámbar de S/D). Archivado = **gris y con borde discontinuo**, sin
botones de editar ni imprimir. La diferencia se ve sin leer una etiqueta.

### 5.2 Historia en la ficha

Bajo **S/D details**, si el SKU tiene unidades archivadas, una línea por unidad, la más nueva arriba:

```
BEFORE
 —   BC 7 18 RASPBERRY     Y22E001903   SOLD 17 AUG · 881180   ›
```

Tocar abre la **unidad archivada** (Modal Manager `sd-unit`): portada, `#`, serial, nombre, condición,
precios, PDF, AS400 de entonces, y sus logs (sólo su tramo). Fotos extra en el `PhotoLightbox` de
siempre, sin Delete.

### 5.3 Buscar

- **Serial o nombre** de una unidad archivada → debajo de los resultados, `SOLD S/D · 1` con su tarjeta
  gris discontinua; tocarla abre la unidad archivada. Sólo con texto en la búsqueda, nunca al hojear.
- **`#81`** → el `#` como término: S/D por número, viva o archivada (`#` + `sdCode`, `#1A` incluido).

### 5.4 AS400 review

PickD no escribe en el AS400; dice qué revisar. Stock → **S/D** → ⋯ → **AS400 review · 14**: una fila por
S/D en stock cuyo texto del AS400 termina en un serial distinto del de PickD.

```
01-0370   #1    AS400 Y21A003411   PICKD Y22B008841   OLD UNIT   ✓
01-0082   #30   AS400 Y21C00200    PICKD Y21C002200   ≈          ✓
```

`OLD UNIT` = el serial del AS400 es de una unidad archivada de ese SKU; `≈` = difieren en 1–2 letras
(errata). **✓ Checked** la oculta mientras el texto del AS400 no cambie. Las 14 de hoy: 01-0370,
01-0388, 01-0549 (otro serial); 01-0169CO, 01-0357XE, 01-0376TR, 01-0508 (PickD no tiene serial
propio: el del AS400 es de la base o es el real); 01-0176, 01-0354, 01-0368XE (PickD sin serial);
01-0082, 01-0340, 01-0492, 01-0495 (`≈`).

## 6. Datos

**Nuevo**

- **`sd_units`** — una fila por unidad archivada. `id` (identity), **`sd_number` único y nulo** (la llave
  que usa la gente; nulo sólo para las anteriores al 30 sep), `sku`, `base_sku`, `serial_number`,
  `item_name`, `model`/`size`/`color`/`category`, `condition`, `condition_description`, `sd_category`,
  `sd_for_sale`, `msrp`/`standard_price`/`sd_price`, `pdf_link`, `internal_note`, medidas y peso,
  `cover_url`, `as400_description`/`as400_snapshot`/`as400_read_at`, **`left_at`, `left_action`,
  `left_order`, `left_by`** (del último log negativo), **`last_log_id`**, `archived_at`, `archived_by`.
  Lectura `authenticated`; escritura sólo por la RPC.
- **`archive_sd_unit(p_sku, p_cover_url, p_performed_by, p_user_id)`** — rechaza si la cantidad total no
  es 0 o si el SKU no es S/D ni `01-`. Copia la fila a `sd_units`, marca sus `sku_photos`, y deja la fila
  de catálogo **limpia**: campos S/D, serial, foto, AS400 (`as400_description`, `as400_read_at` y
  `as400_snapshot` a NULL, así el watchdog la vuelve a leer), medidas y peso a los defaults (❓5),
  `sd_number` a NULL con `pickd.sd_number_repair = on`, `sd_for_sale = 'not_yet'`, `unit_kind = 'sd'`.
  Un log `EDIT` con nota `archived` y la fila de inventario (en 0) sin `item_name`.
- **`sku_photos.sd_unit_id`** (nulo) — una foto con unidad no sale en la ficha viva (`useSkuPhotos` filtra).
- **`upload-photo`, modo `archive`** — la mitad del modo `cover` que ya copia la portada saliente a
  `photos/gallery/`: copia `photos/{sku}.webp` a una llave propia y devuelve la URL. Hace falta porque
  la próxima foto del SKU **sobrescribe** `photos/{sku}.webp`. Orden: copiar → archivar; si la copia
  falla, no se archiva.
- **`sku_metadata.as400_checked`** (texto) — el texto del AS400 que alguien dio por revisado.
- **`v_sd_as400_review`** — la lista de §5.4.
- **`search_sd_units(p_term)`** — serial, nombre o `#` sobre `sd_units`.

**El tramo de logs de una unidad**: `sku = su sku AND id <= last_log_id AND id > last_log_id de la
unidad anterior`. Por id y no por fecha: los ids no empatan. `get_inventory_logs_for_sku` de la ficha
viva corta en el último `last_log_id`. `sd_sheet_edits` (11 filas) se atribuye por `archived_at`.

**Cambia**

- **`rename_sku_everywhere`**: (1) destino = S/D vendida → `archive_sd_unit` del destino y copia entera,
  sin fusionar; (2) origen con unidades archivadas → reescribe sólo los logs con `id > último
last_log_id` y las órdenes creadas después de `archived_at`; `sd_units.sku` no se toca (la vieja se
  vendió con ese nombre: la orden 881180 dice `01-0376` y así se queda).
- **`split_unit`**, `kind = 'sd'`: SKU = número dado › serial › **`SD<code>`** con `#` asignado ahí
  (antes `-SD1`); si el número dado es una S/D vendida, la archiva primero. `photo` no cambia (`-PH1`).
- **`set_dimensions_verified`**: hoy sella `weight_verified` en cualquier UPDATE que cambie el peso y es
  monótono. El archivo lo declara como hace el AS400 (`set_config('pickd.weight_source','reset',true)`).
- **Register**: `useScratchDentHolder` devuelve también «vendida» (§4 A.3); `fillFromCatalogue` no
  rellena desde una S/D vendida; REGISTER llama a `archive_sd_unit` antes del alta.
- **Mark as S/D** (`ItemCardView.tsx:300`): con más de una unidad o stock en otra fila, separa como Mark
  as PH (`splitPh` es la plantilla).

**No cambia, y por qué**

- **Labels / `assign_sd_numbers`**: la fila limpia tiene `sd_number` NULL → la primera impresión da
  #84. Una unidad archivada no se imprime (no hay fila).
- **SHIP CHECK** (`useShipCheckData.ts`): sólo se reusa un SKU en 0, así que reusar no crea un SKU
  compartido; con el serial como SKU tampoco (0 hoy). La regla roja se queda para lo heredado.
- **Sheet** (`sd-sheet`): lista S/D **en stock** por `#`; la archivada nunca está, la nueva aparece sin
  `#` hasta la primera impresión. Un intento del Sheet sobre la vieja choca con el compare-and-set de
  `sd_sheet_apply_edit` y no escribe.
- **Double Check**: la línea pide el SKU y cuenta 1, que es la bici nueva. P4 sólo añade `#84 ·
serial` a las líneas S/D para que el picker lo compare con la caja.
- **Backfill: ninguno.** Las 83 con `#` están vivas en su fila; las 79 vendidas siguen intactas en la
  suya hasta que alguien reuse su SKU. Nada se copia el día uno.

## 7. Pantalla (430 px)

**Register, SKU de una S/D vendida** (una línea, ámbar, sin bloquear):

```
┌──────────────────────────────── 430 ┐
│ SKU        01-0376              ✓  │
│ ▲ SOLD 17 AUG · 881180              │
│   BC 7 18 RASPBERRY · Y22E001903    │
│   → goes to history                 │
│ MODEL      ·  tap to add            │
│ SERIAL     ·  required for S/D      │
│ …                                   │
│ [          REGISTER           ]     │
└─────────────────────────────────────┘
```

Tres renglones cortos porque a 430 px nombre + serial + fecha + orden no caben en uno; el triángulo
ámbar es la única señal.

**Ficha viva con historia** (debajo de S/D details):

```
│ #84                         S/D     │
│ TRILOGY 56 RED/GLOSS BLACK S/D      │
│ …S/D details…                       │
│ BEFORE                              │
│ ┆ —  BC 7 18 RASPBERRY        ›  ┆  │
│ ┆    Y22E001903 · 17 AUG · 881180 ┆  │
```

**Unidad archivada** (`sd-unit`, hoja a media pantalla, `max-h-[90vh]`, gris discontinuo):

```
│ ┆ [ foto ]        —   SOLD      ┆   │
│ ┆ BC 7 18 RASPBERRY S/D         ┆   │
│ ┆ Y22E001903                    ┆   │
│ ┆ 17 AUG · 881180 · Jed         ┆   │
│ ┆ AS400  S/D BC 7 18 RASPBERRY… ┆   │
│ ┆ 17 JUL MOVE ROW 33 → ROW 20   ┆   │
│ ┆ 17 AUG DEDUCT −1 · 881180     ┆   │
```

**AS400 review** (lista, `pb-32`): una fila de dos renglones por SKU — `01-0370 #1` y `✓` arriba,
`AS400 Y21A003411 · PICKD Y22B008841` abajo; la etiqueta `OLD UNIT` o `≈` como pill.

## 8. Fases

- **P1 — Reusar sin perder (lo que pidió).** `sd_units`, `archive_sd_unit`, modo `archive` de
  `upload-photo`, `sku_photos.sd_unit_id`; Register (§4 A) y renombrar (§4 B) archivan en vez de
  mezclar; el corte de logs en `rename_sku_everywhere` y `get_inventory_logs_for_sku`; la línea
  **BEFORE** en la ficha. Checkpoint: caso 1 y 4 en local, capturas a 430 y 1400.
- **P2 — Serial como SKU.** Mark as S/D separa (§4 C), `split_unit` sin `-SD1` (`SD<code>`).
  Checkpoint: casos 5 y 6.
- **P3 — AS400 review.** `as400_checked`, `v_sd_as400_review`, la lista en S/D → ⋯. Checkpoint: las 14.
- **P4 — Encontrar lo archivado.** Hoja `sd-unit`, `search_sd_units`, `#81` en el buscador, `SOLD S/D`
  bajo los resultados, `#` y serial en las líneas S/D de Double Check y en `/batch` la misma línea
  ámbar de Register.

P1 primero porque es el único sitio donde hoy se pierde algo: cada reuso sin él pisa una bici.

## 9. Casos de verificación

Se validan contra prod dentro de una transacción con rollback y luego en local; nada se escribe en prod
hasta el «ok».

1. **Register `01-0376`** (S/D nueva, serial `TEST0376`, ROW 12 I). Queda una fila en `sd_units`:
   `sku 01-0376`, `sd_number NULL`, serial `Y22E001903`, `Boss Crusier 7 18" Raspberry S/D`,
   `sd_for_sale yes`, `left_at 17 ago`, `left_action DEDUCT`, `left_order 881180`, `left_by Jed`,
   `last_log_id` = id de ese DEDUCT, AS400 `S/D BC 7 18 RASPBERRY Y22E001903`. La fila de catálogo
   tiene sólo lo de la nueva. Logs: `EDIT · archived` + `ADD +1 ROW 12`. La ficha enseña 1 log (el ADD)
   y BEFORE con la Raspberry (MOVE 17 jul, DEDUCT 17 ago). Primera impresión → **#84**.
2. **Register `01-0357`** → rojo: `#44 · Y22D005230 · ROW 12 E`. `sd_units` sin cambios.
3. **⋯ +1 en `Y21A003411`** (Hudson E2, en 0, ROW 20 G) → `ADD +1`, sin archivo, conserva su ficha.
4. **Renombrar `TEST0376` → `01-0376`** (con la Raspberry aún en el catálogo): archivo como en 1,
   `sku_canonical_renames.merged = false`, la nueva conserva su `#84`; los 2 logs de la Raspberry
   siguen en `01-0376` con `id <= last_log_id`; `picking_lists` de 881180 no se reescribe.
5. **Mark as S/D en una caja de `03-3606BL`** (10 nuevas: RETURN TO STOCK + ROW 51 F) con serial
   `Y21K0TEST1` → `split_unit`: SKU `Y21K0TEST1`, `base_sku 03-3606BL`, `03-3606BL` queda en 9; un `EDIT`
   con `previous_sku 03-3606BL`. La misma forma que #74.
6. **Igual sin serial** → SKU **`SD84`**, `sd_number 84` asignado en la separación, etiqueta `#84`.
7. **Buscar `Y22E001903`** tras el caso 1 → `SOLD S/D · 1`, `01-0376 · 17 AUG · 881180`. **`#81`** →
   `01-0376TR` viva en ROW 12 I.
8. **AS400 review** → 14 filas; `01-0370 #1 · AS400 Y21A003411 · PICKD Y22B008841`. ✓ guarda el texto
   y la fila sale. Tras el caso 1, cuando el watchdog relee `01-0376` con el mismo texto, entra con
   `OLD UNIT`.
9. **Sheet** tras el caso 1 → una fila nueva para `01-0376` sin `SD #`; tras imprimir, `84`. La
   Raspberry no aparece.
10. **Foto** tras el caso 1 → foto nueva de la Trilogy sobrescribe `photos/01-0376.webp`; la unidad
    archivada no tenía portada (`image_url` NULL) → `cover_url` NULL. Con portada, la archivada sigue
    enseñando la suya.

## 10. ❓ Preguntas (con respuesta por defecto)

1. **¿Cuándo se reusa?** Default: **sólo cuando una bici nueva llega al SKU** (Register, renombrar,
   separar). Nada automático al llegar a 0 y ningún botón «Reuse».
2. **¿Una vendida sin `#` recibe uno al archivarse?** Default: **no**; se archiva con `—`. El `#` sigue
   significando «etiqueta impresa» y la secuencia no salta.
3. **S/D separada sin serial legible:** Default: **SKU `SD<code>`** (p. ej. `SD84`) con el `#` asignado
   en ese momento, en lugar de `<modelo>-SD1`.
4. **Las dos `-SD1` que existen** (`03-3769BL-SD1` #78, `03-4040BK-SD1` #76): Default: **se quedan**
   hasta que el AS400 les dé su `01-`, como los sufijos de hoy; renombrarlas ya obliga a reimprimir.
5. **Medidas y peso al reusar:** Default: **vuelven a los defaults** y la bici nueva se mide; la caja de
   una Trilogy no es la de una Boss Cruiser.
6. **AS400 review:** Default: **las 14 de hoy entran**, erratas (`≈`) incluidas, y ✓ las oculta hasta que
   el texto cambie. Quien mantiene el AS400 la recorre desde S/D → ⋯.

## 11. Riesgos

- **Un SKU en 0 que no se vendió** (un DEDUCT equivocado) se puede reusar y archivar. Mitigación: la
  línea ámbar enseña cómo salió; `LEFT · NO RECORD` en las 8 sin registro avisa antes de REGISTER.
- **Una S/D que se fue y sigue en 1** (01-0508 en 881637, 01-0417 en 881572) bloquea el reuso en rojo,
  como hoy. El remedio es descontarla; este estudio no lo detecta.
- **La portada vive en una llave por SKU**: si la copia falla, no se archiva (orden copiar → archivar).
  Una portada subida desde otro dispositivo entre la copia y el archivo se perdería; la ventana es de un
  segundo.
- **El AS400 sigue describiendo la vieja** hasta que alguien lo corrija: PickD no puede. La lista lo hace
  visible y el watchdog relee al limpiar `as400_read_at`.
- **Órdenes viejas**: la línea de 881180 dice `01-0376` y abrirla lleva a la bici viva; la vieja está en
  BEFORE. No se enlaza orden → unidad en este estudio.
- **Puertas que no pasan por Register** (`/batch`, `SDQuickIntakeModal`, `resolve_return 'sd'`) siguen
  escribiendo encima hasta P4; la regla vive en `archive_sd_unit` para que todas la llamen.
