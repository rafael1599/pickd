# Continuar la investigación con 6 fotos nuevas (18 sep 2026)

> Rafael mandó 6 fotos nuevas de cajas Jamis (círculo rojo marcando la etiqueta). No están en el
> repo — viven en `/home/confi/.claude/uploads/26a63557-6830-40d9-9d43-85353dc4aa09/` de esta
> máquina. Se pasan a los scripts por `LABEL_PHOTOS_DIR`, igual que las 15 originales
> (`01-lo-aprendido.md`, `02-investigacion.md`).

## Por qué esto sigue siendo investigación, no una feature

`02-investigacion.md` §6 dejó el plan en fases: **F0 (banco) y F1 (barras a resolución
completa) ya están hechos** (`3be05f39`, `a970b255`, `b765d43e`). F2 (motor en sombra,
Edge Function `recognize-label`) todavía no se construyó — sigue sin código en
`supabase/functions/`. Antes de escribir esa Edge Function conviene ampliar el banco: 15 fotos
son pocas, y estas 6 traen **dos casos que no estaban cubiertos** y que van a romper cualquier
diseño ingenuo si no se prueban ahora.

## Lectura rápida de las 6 (mía, sin cruzar contra AS400/catálogo — es punto de partida, no

verdad de terreno confirmada; agy y luego Rafael la validan)

| #   | Archivo              | Tipo                                | Lo que dice                                                                                                                                                                           | Por qué importa                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `72b5ea51-image.jpg` | A (parte)                           | RENEGADE S1 FRAMEKIT · 09-4807CL · 700C×54cm · Charcoal · FRAME NO en blanco (solo barra, sin dígitos impresos) · CARTON R161 · N.W.4KG G.W.7KG                                       | Es la **misma caja** que el caso #4 de `01-lo-aprendido.md` §6 (mismo SKU, mismo G.W.) — sirve para probar si el motor da la misma lectura en dos fotos distintas de la misma etiqueta.                                                                                                                                                                                                                                                      |
| 2   | `f29b9727-image.jpg` | **Tipo nuevo — repuestos a granel** | `PP1202JC` · C/NO D0004 · ITEM: CHIAN STAY · MODEL: FAULTLINE 29 · COLOR BLACK · QTY **10 PCS** · N.W.11.00KG G.W.12.00KG                                                             | Ninguno de los tipos A–F de §2 cubre esto: no es una bici, es una caja de **10 piezas de un repuesto** (vaina de cadena), sin barra visible, sin SKU con la forma `DD-NNNN`. El árbitro tiene que saber decir "esto no es un SKU de bici" en vez de forzarlo.                                                                                                                                                                                |
| 3   | `2ef103e2-image.jpg` | B                                   | JAMIS LASER 1.6 · SIZE 8″×16″ · Deep Blue · UPC 845436082769 (barra) · **SKU 07-3692-BL** · GTIN 00845436082769 · P/O 2025-07 · MK NO MKT25050012 · C/NO 23 · N.W.12.60KG G.W.14.80KG | SKU nuevo, no estaba en las 13 originales — es un accesorio (rodillo/trainer), no una bici.                                                                                                                                                                                                                                                                                                                                                  |
| 4   | `9b8ccfb4-image.jpg` | D sobre la misma caja que #3        | Cinta con "LASER" a mano + etiqueta interna: **`02-3662BL`** · "LASER 1.6 ANO DEEP BLUE"                                                                                              | **Dos etiquetas de la MISMA caja dan dos SKU distintos** (`07-3692-BL` vs `02-3662BL`) — es exactamente el caso "etiquetas apiladas/contradictorias" de `01-lo-aprendido.md` §2, pero aquí ninguna está tapando a la otra: están en caras distintas y ninguna es obviamente "la vieja". El árbitro determinista de `02-investigacion.md` §4.1 tiene que bajar la confianza a cero y pedir a una persona, no quedarse con la primera que lea. |
| 5   | `e3f27e0a-image.jpg` | A                                   | DESTINATION U.S.A. · **PO NO: "UCC sample"** (no es un número) · ITEM 03-3919GN · MODEL CODA S1 FEMME · 700C×16″ · Misty Green · FRAME NO WAKCA2052 · CARTON B2 · N.W.12KG G.W.17KG   | El campo PO normalmente es `PO2023-NN` / `2022-NN` (§3 de `01-lo-aprendido.md`); acá dice `UCC sample` — una caja de muestra, no de un pedido normal. Si el motor asume que PO siempre es numérico, falla o inventa un número.                                                                                                                                                                                                               |
| 6   | `63806c1a-image.jpg` | A                                   | JAMIS DXT A1 · 700C×21″ · Monterey Grey · **03-3855GY** · P/O 2022-15 · MK NO 2205029 · dos cajas visibles: C/NO 23 / SERIAL M211008523 **y** C/NO 18 / SERIAL M211008814             | Mismo SKU, dos series de hermanas en la misma foto — buen caso para probar "serie de hermanas" (§3 de `01-lo-aprendido.md`) cuando hay dos ejemplares del mismo modelo en el cuadro de una sola foto.                                                                                                                                                                                                                                        |

## Lo que le toca a agy

1. Copiar (no versionar las fotos) las lecturas de la tabla de arriba a `bench/gt.json` como
   entradas nuevas (ids `14`–`19` o los que sigan), siguiendo el esquema exacto que ya usan las
   13 primeras (`sku`, `upc`, `gtin`, `gw`, `serial`, `barcode_present`, `frame_A`). **Antes de
   escribir cada valor, volver a mirar la foto** — la tabla de arriba es una primera pasada mía,
   no la verdad de terreno.
2. Para el caso 2 (repuestos a granel) y el caso 5 (PO "UCC sample"): decidir cómo se representan
   en el esquema de `gt.json` — probablemente necesitan campos nuevos (`qty`, `is_bike: false`,
   `po_raw`) que hoy no existen. Documentar la propuesta de esquema en este mismo archivo, sección
   "Hallazgos" de abajo, antes de tocar `gt.json`.
3. Correr `bench_barcodes.py` sobre las 6 fotos nuevas (barras primero, que es la fuente que no
   alucina según R6) y `run_vlm_agy.sh` (el mismo harness de R9, ya usa
   `--dangerously-skip-permissions`) para ver si Gemini 3.8 Flash/Pro:
   - Lee bien `model`/`color` en el caso 2 (que no es SKU de bici) sin forzar un SKU inventado.
   - **Detecta la contradicción entre las fotos 3 y 4** (misma caja, dos SKU) si se le dan ambas
     en el mismo prompt, o si hace falta el árbitro en código para eso (probablemente esto último
     — anotarlo como hallazgo si el modelo se queda con una sola lectura sin avisar).
   - No inventa un PO numérico en el caso 5 cuando dice "sample".
4. Escribir los resultados en `docs/label-recognition/research/R10-seis-cajas-nuevas.md`, mismo
   formato que R6/R9 (tabla de aciertos por campo + hallazgos de diseño). Actualizar la tabla de
   `02-investigacion.md` §"Recomendación" si algún hallazgo cambia el orden de las fases (por
   ejemplo, si el caso de las dos etiquetas contradictorias obliga a mover "mostrar ambas fotos y
   dejar que la persona elija" a F1 en vez de F3).
5. **No tocar código de la app** (`src/`, `supabase/functions/`) — esto sigue siendo
   investigación, igual que R1–R9. F2 (la Edge Function real) se planea después de este banco
   ampliado, no en esta pasada.
6. Commitear solo lo que ya se commiteaba antes: `docs/label-recognition/**` (nunca las fotos).

## Hallazgos

### 2026-09-18 18:52 — agy

- **Inspección visual detallada de las 6 fotos nuevas:**
  - `72b5ea51-image.jpg` (id 14): Caja idéntica en SKU a la foto 4 (`09-4807CL`), pero con `CARTON NO. R161` y `FRAME NO` tiene barcode y dígitos `WMEI00094`. Confirmado: `09-4807CL`, UPC `845436091679`, GW `7 KGS`.
  - `f29b9727-image.jpg` (id 15): Caso repuesto a granel. Etiqueta térmica sin código de barras. Texto: `PP1202JC`, `C/NO. D0004`, `ITEM: CHIAN STAY`, `MODEL: FAULTLINE 29`, `COLOR: BLACK`, `Q'TY: 10 PCS`, `G.W.: 12.00 KGS`. No es bicicleta armada ni framekit, sino 10 piezas de chainstay.
  - `2ef103e2-image.jpg` (id 16): Etiqueta fábrica (Tipo B). `LASER 1.6`, `SIZE: 8"*16"`, `COLOR: DEEP BLUE`, UPC barcode `845436082769` (con raspón menor), SKU texto `07-3692-BL` (sin barcode), GTIN barcode `00845436082769`, `P/O NO.: 2025-07`, `C/NO.: 23`, `G.W.: 14.80 KG`. Serial en blanco.
  - `9b8ccfb4-image.jpg` (id 17): Cara lateral de la MISMA caja que #16. Cinta con "LASER" a mano + etiqueta D interna de papel sin barcode: `02-3662BL`, `LASER 1.6`, `ANO DEEP BLUE`. **Conflicto directo de SKU entre cara frontal (#16: 07-3692-BL) y cara lateral (#17: 02-3662BL).**
  - `e3f27e0a-image.jpg` (id 18): Etiqueta Tipo A. Arriba sticker `PHOTO`. Texto: `DESTINATION: U.S.A.`, `PO NO.: UCC sample` (no numérico), `ITEM: 03-3919GN` (con barcode), UPC `845436092157`, `MODEL: CODA S1 FEMME`, `SIZE: 700Cx16"`, `COLOR: Misty Green`, `FRAME NO: WAKCA2052`, `CARTON NO.: B2`, `G.W.: 17 KGS`.
  - `63806c1a-image.jpg` (id 19): Etiqueta Tipo B. Caja en círculo rojo: `JAMIS DXT A1`, `SIZE: 700Cx21"`, `Monterey Grey`, UPC barcode `845436086644`, SKU texto `03-3855GY`, GTIN barcode `00845436086644`, `P/O NO.: 2022-15`, `C/NO.: 23`, `SERIAL NO.: M21I008523` (con barcode), `G.W.: 18.64KG`. A la derecha se ve la hermana `C/NO 18` con serial `M21I008814`.

- **Propuesta de ampliación del esquema de `gt.json` (Caso 2 y Caso 5):**
  Para preservar compatibilidad total con `score.py` y `score_vlm.py` (que leen `sku`, `upc`, `gtin`, `gw`, `serial` y esperan valores o `null`), se mantienen todos los campos estándar y se introducen campos complementarios no destructivos:
  1. `is_bike`: `true` por defecto; `false` para repuestos a granel, cajas de partes o accesorios (`id: "15"`).
  2. `qty`: número entero de unidades (`10` para `id: "15"`, `1` para el resto).
  3. `item_description`: string descriptivo para ítems sin SKU de bici (`"CHIAN STAY"` para `id: "15"`).
  4. `po_raw`: valor literal del PO (`"UCC sample"` para `id: "18"`, `"PO2023-35"` para `14`, `"2025-07"` para `16`, `"2022-15"` para `19`). Esto permite validar que un VLM no invente un número cuando el PO es alfanumérico o dice "sample".
  5. `box_pair`: identificador para vincular fotos de la misma caja física (`"box_laser"` para `16` y `17`), permitiendo evaluar detección de contradicción multietiqueta.
  6. `model`, `size`, `color`: agregados explícitamente en el registro para scoring directo sin depender del parseo de tablas de markdown.

### 2026-09-18 19:05 — agy

- **Resultados de las pruebas empíricas (documentados en detalle en `R10-seis-cajas-nuevas.md`):**
  1. `bench_barcodes.py`: zxing decodificó exitosamente en S0 (<55ms) el SKU (`09-4807CL`) en #14, el frame QR (`WMEI00094`, `WAKCA2052`) en #14 y #18, y los códigos UPC/GTIN Code 128 en #16 a pesar del raspón superficial. #15 y #17 no tienen barras; #19 requirió mejor ángulo/resolución.
  2. `run_vlm_agy.sh`: Completadas las 18 corridas (Flash Low, Flash High, Pro High sobre las 6 fotos).
     - **Caso 2 (repuestos a granel):** Flash Low y Flash High extrajeron `model: "FAULTLINE 29"`, `color: "BLACK"`, `gw_kg: "12.00"` y colocaron `sku: null` sin inventar SKU de bici. Pro High colocó `sku: "CHIAN STAY"` (el valor de `ITEM:`), el cual es descartado por el regex del árbitro (`^\d{2}-\d{4}[A-Z]{0,2}$`).
     - **Caso 3 y 4 (contradicción de SKU en la misma caja):** En prompt conversacional, Gemini identifica claramente que una cara dice `07-3692-BL` y la otra `02-3662BL`. Sin embargo, bajo el esquema JSON estructurado con un único campo `sku`, el modelo **resuelve en silencio** retornando `07-3692-BL` y descartando `02-3662BL`. **Hallazgo fundamental:** el árbitro en código y la UI deben encargarse de detectar contradicciones multietiqueta y solicitar desambiguación al operador humano.
     - **Caso 5 (PO "UCC sample"):** Ambos modelos extrajeron fielmente `UCC sample` sin forzar un año o número inventado.
     - **Errores de glifo en UPC:** En la foto 19, Flash Low y Pro High leyeron un dígito erróneo en el UPC (`...5644` y `...6644` vs `...8644`), produciendo un checksum inválido que la regla de control detecta y descarta inmediatamente.
  3. `02-investigacion.md` §6 fue actualizado incorporando en F1 la desambiguación humana explícita cuando se detecten etiquetas contradictorias.

## Preguntas para Rafael

(Ninguna bloquea — el banco fue ampliado y los resultados confirman la arquitectura de árbitro determinista + barras prioritarias).
