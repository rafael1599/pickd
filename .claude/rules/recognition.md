---
paths:
  - 'src/lib/recognition/**'
  - 'src/features/recognition/**'
  - 'src/features/inventory/LabelBatchScreen.tsx'
  - 'src/features/inventory/**/*abelBatch*'
  - 'src/features/picking/utils/resolveAgainstOrder.ts'
  - 'docs/label-recognition/**'
---

# Lector de etiquetas: lote por fotos y sombra en Double Check

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

**El lote por fotos (`/batch`, 23 sep 2026, idea-224, PRD `docs/prds/inventory-batch-label-intake.md`).**
Stock → ⋯ → `Add batch · Photos`: disparar todas las etiquetas, cerrar la cámara, corroborar tarjeta por
tarjeta (una por SKU; sus fotos son sus unidades) y un solo SEND a una ubicación (RETURN TO STOCK por
defecto, sólo una que exista). Lo que no se ve en pantalla:

- **Se lee mientras la cámara sigue abierta, en un Web Worker** (`lib/recognition/recognizeInWorker.ts`
  - `ocr.worker.ts`, ONNX a un hilo), una etiqueta a la vez porque el servicio de OCR es un singleton.
    En el hilo principal cada lectura congelaba el visor (~1,8 s en el teléfono; en headless, un hueco de
    1.050 ms por lectura); en el Worker, 6 etiquetas leídas con la cámara abierta y el peor cuadro en
    17 ms. **Se vuelve al hilo principal sólo si el Worker nunca llegó a leer una** (iOS < 16.4, sin
    `OffscreenCanvas`): entonces espera a que se cierre la cámara, como al principio. Si ya leyó alguna,
    un fallo es de la foto y no se repite en el hilo principal. Sólo el lote lee en el Worker; el alta de
    a uno y Double Check siguen con `recognizeLabelClient` directo. Por foto se guarda el `File` (memoria
  - IndexedDB, el borrador sobrevive a cerrar la app) y una miniatura de 240 px, nunca la imagen decodificada.
- **Las cajas se cuentan por serial** (`utils/serialIdentity.ts`): `serialLooksReal` rechaza el rótulo
  leído como valor (`SERIALLOE`) y `serialKey` pliega O→0 / I→1 **sólo para comparar**; mismo serial =
  la misma caja otra vez (`=`), sin serial creíble cuenta y avisa (`?`). El alta de a uno usa el mismo
  filtro antes de guardar un serial: así entró `SERIALLOE`.
- **Un SKU nuevo sin modelo o talla no se envía** (la tarjeta, no el lote); uno existente nunca se bloquea
  por su etiqueta y el catálogo sólo se rellena donde está vacío.
- **Escribe `register_label_batch`**, idempotente por `batch_id` (dos SEND = un ADD por SKU), y registra
  cada lote en **`label_batch_runs`** (fotos, tarjetas por cámara vs mano, ámbares, segundos): la
  medición que decide si el lector sirve, desde el primer lote. Por dentro es **`apply_intake_lines`**,
  la única implementación de «escribir un lote en una ubicación» (el contenedor es guarda + esa
  función): al crear un SKU inserta la metadata con `is_bike` **explícito** primero (un `05-` nacía
  parte), el peso de la etiqueta sólo entra si nadie pesó la caja, y el lote **no** estampa `received_year`.
- **Dos arreglos al lector que salieron de probarlo con etiquetas reales:** `matchKnownModel` conserva la
  designación tras una familia de una palabra (`RENEGADE C2` volvía como `RENEGADE`: la lista no tiene
  C1/C2/C3), y `separateSizeFromColor` separa la talla que una etiqueta mete al final del color
  (`ADOBE CLAY / BRONZE DUSK 700C X 54CM`) y deja los dos en ámbar. Los dos ayudan también al alta de a uno.
- **Cada foto lee todas sus etiquetas, no una** (Rafael, 29 sep 2026: «tengo bikes que tienen varias
  etiquetas con diferente información y quiero todo que se considere»). `recognizeLabelsInPhoto` lee
  la foto entera y además cada etiqueta que encuentra la pieza 1 (`labelLocator.ts`), enderezada y a
  escala nativa; `mergeDrafts` junta los campos: lo que coincide queda verde, lo que difiere va en
  ámbar con opciones, primero lo que más etiquetas repiten y, en empate, lo de la etiqueta
  enderezada. Los «CONFLICTO: a ≠ b» del lector no se ofrecen como valor. Cuesta ~4 s por foto en
  escritorio (antes ~1,8 s en el teléfono sólo con la foto entera).

**La sombra del lector en Double Check (25 sep 2026, `docs/label-recognition/10-sombra-en-dcv.md`).**
Cada foto de pallet de DCV va también, a resolución original, al bucket R2 **privado**
`pickd-dcv-originals` (URL firmada de `dcv-original-url`, nunca credenciales en el cliente; las fotos
traen guías de FedEx), y el motor la lee en un Worker propio (`readPalletInBackground`) dejando una
fila en `dcv_shadow_runs` **con cualquier desenlace**. El picker no ve nada. Lo que no se ve:

- **La enciende `app_flags.dcv_shadow`**, no el build; `config.only_users` vacía es **nadie** y sin la
  llave es **todos** — así está desde el 26 sep 2026 (Rafael: «para todos los usuarios»).
- **Nunca el hilo principal ni un reintento**: sin Worker/`OffscreenCanvas` es `unsupported`, un
  cuelgue es `timeout` y mata el Worker, la cola llena es `dropped`. `runDcvShadow` nunca lanza.
- **`recognizeMultiBoxClient` exige `catalog`** (`lookupCatalogSku` o `false`): el lookup necesita la
  sesión de Supabase, que un Worker no tiene, y no importarlo es lo que deja el chunk del Worker sin
  el cliente. La sombra y el banco corren con `false` y deciden el catálogo por `sku_key` en SQL.
- **Cada foto se lee hasta el final, esté quien la tomó donde esté (`photo_reads`, 6 oct 2026, F0 de
  idea-247).** Rafael: «el posprocesamiento … debe continuar en el background aunque el usuario ya no
  esté en la misma orden o usando la app hasta que se termine, la alerta … también se debe ver en ship
  y mostrar en rojo la imagen». Antes Double Check tiraba la lectura al cambiar de orden (de 18 fotos
  con ≥ 4 etiquetas, 3 quedaron como frente) y una app cerrada a mitad no la leía nunca. Ahora
  `photoReads/processor.ts` deja una fila por foto (`reading` / `pending` / `done` / `failed`, con la
  tarima del botón, el n.º de foto y las tarimas **como estaban al dispararla**), corre `runDcvShadow`
  y termina con `alerts` (`wrong_pick` / `not_in_order`, sólo SKUs) y `front` para **todo el
  personal** (las otras tablas de la sombra siguen siendo de admin). Una fila sin terminar la toma otra
  PickD (`claim_photo_read`, atómica; una `reading` de más de 3 min cuenta como libre) desde
  `usePhotoReadSweeper` en `LayoutMain`: **la PC (puntero fino) toma cualquiera, un teléfono sólo las
  suyas** — al picker no se le cargan lecturas ajenas —, y baja el original con
  `dcv-original-url` `get-claimed` (sólo mientras la tiene). Double Check y Ship escuchan
  `photo_reads` por realtime: el chip `WRONG PICK?` sale de ahí, el frente se guarda en su tarima al
  abrir la orden si nadie la editó después de la foto (`pallet_dims[].edited_at`), y Ship pinta en
  rojo la miniatura y lista los avisos en **PHOTO CHECK** (el `photo_id` va en la URL pública).
- **Tocar el motor es cambiar de motor**: `engineConfig.test.ts` falla si cambia una línea de
  `ENGINE_SOURCE_FILES`, un modelo o una librería, y dice el `sourceSha256` nuevo. Ponerlo **es** la
  decisión de abrir otra ventana de medición (`engine_config_hash`).
- **Cada caja guarda la lectura cruda y, aparte, la resuelta contra la orden** (idea-238, 28 sep
  2026): `resolveAgainstOrder` (`features/picking/utils/`) recupera la letra de color cortada, el
  candidato de la orden en un CONFLICTO y un carácter distinto, y **nunca** hace pasar por SKU de la
  orden una lectura que es otra bici real del catálogo (eso sería un verde falso). Corre en el hilo
  principal —necesita el catálogo— y fuera del motor, así que no cambia su huella.
  `v_dcv_shadow_vs_group` cuenta la resuelta; `raw_read_qty` es la cruda. Con las 45 fotos del
  28 sep: 62 → 71 de 72, 0 verdes falsos.
- **Lo que vio el motor, en crudo, va al lado del original** (idea-238, 28 sep 2026):
  `full/AAAA/MM/<foto>.ocr.json` (`buildOcrDump`: todos los fragmentos del OCR, las barras y cada
  etiqueta con sus candidatos), firmado con `put-ocr` de `dcv-original-url`. Hereda los 30 días de
  `full/`; si la foto sale en la muestra se copia a `sample/`. **Nunca a la base**: el texto crudo
  trae las guías de FedEx. Analizar una mejora ya no exige volver a correr el motor.
- **El OCR corre en el binario WASM puro de onnxruntime** (alias `onnxruntime-web` →
  `onnxruntime-web/wasm` en `vite.config.ts`, proveedor fijado a `wasm`): con el JSEP, y con WebGPU
  que ppu-paddle-ocr elegía solo, Safari 26 se desboca (onnxruntime#26827, bug-051).
- **Cada etiqueta se lee por separado, a escala nativa** (pieza 1, 29 sep 2026, `labelLocator.ts`
  y `labelCrops.ts`): el detector del OCR trabaja a ≤ 1.920 px y la línea del SKU de una foto de
  3.840 le llegaba a ~10 px. El motor encuentra las pegatinas blancas (contraste local, contornos,
  firma de código de barras), endereza cada una con una homografía a 800 px, vertical y 0°/180°
  por plantilla, y lee cada recorte (a media escala si no sale SKU). Sin etiquetas, lee la foto
  entera como antes. Banco `label-bench/banco-dcv`: 0,54 → 0,85 por etiqueta, lote nuevo 29/29, 0
  verdes falsos. Validado contra el mismo algoritmo en Python (r6–r13 del revisor). Puro, sin
  canvas: se prueba en Node con escenas sintéticas.
  Desde el 30 sep, si el borde del recorte trae cartón se ajusta el contorno a la pegatina (Otsu
  dentro del recorte), se corrige la inclinación residual de 1°–5° (perfil de proyección) y, si
  no sale SKU, se relee girada 180° (la etiqueta nueva de franjas de lado a lado sale boca abajo).
  Desde el 1 oct, con lados casi iguales (relación > 0,75) el giro de 90° lo decide hacia dónde
  corren los renglones (`textAxisLog`, varianza del perfil por filas contra por columnas) y no el
  lado largo: una etiqueta apaisada quedaba de lado.
- **Una lectura aproximada sólo se resuelve si no puede ser otra bici del catálogo** (30 sep
  2026, `resolveAgainstOrder` recibe las ~2.600 claves de `sku_metadata`, cargadas una vez por
  sesión). Antes bastaba con que fuera única en la orden: el leave-true-out de 718 casos del
  archivo encontró «03-4710BA» aceptado como el 03-4710BL de la orden siendo una BR, y un color
  cortado completado con el de la orden. Con la regla nueva: 0 de 718 (especificidad ≥ 99,58 %).
- **`pallet_photos` se escribe con `append_pallet_photo` / `remove_pallet_photo`**, nunca leyendo y
  reescribiendo el arreglo: desde que el modo vista fotografía, dos personas disparan sobre la misma
  orden y la segunda escritura borraba la primera foto.
