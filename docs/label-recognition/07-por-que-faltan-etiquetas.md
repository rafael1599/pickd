# Por qué faltan etiquetas: tres de seis en una foto de pallet

> 23 sep 2026. Rafael fotografía un pallet de frente y `PalletScanSheet` enciende **3 de 6**
> etiquetas: la fila de arriba entera, la de abajo ninguna. Las tres que faltan se leen a ojo en la
> misma foto («no se ven bien pero no las ha tomado en cuenta»). Este documento dice qué puede
> explicar **ese** fallo, con qué medición se distingue una causa de otra, y qué cambiar. No toca
> código: el arreglo lo decide Rafael después de correr los experimentos de §4.

---

## 1. El caso, con números

Seis cartones, dos filas de tres. Dos SKUs y nada más: `03-4069BL` (EXPLORER A2 19" Deep Blue,
etiqueta **tipo B** — `MK NO` / `GTIN`, sin código de barras del SKU) y `03-4466BR` (RENEGADE C4
700C×56 Sandstone, etiqueta **tipo A** — `ITEM:` con barras, caja negra del SKU). La tipología es la
de `01-lo-aprendido.md` §2.

|                         | fila de arriba | fila de abajo  |
| ----------------------- | -------------- | -------------- |
| izquierda               | `03-4069BL` ✅ | `03-4069BL` ❌ |
| centro                  | `03-4466BR` ✅ | `03-4466BR` ❌ |
| derecha                 | `03-4466BR` ✅ | `03-4466BR` ❌ |
| tipo de etiqueta        | B, A, A        | B, A, A        |
| SKU en código de barras | no, sí, sí     | no, sí, sí     |

Medido sobre la captura de pantalla (el `<img>` renderizado mide 1312 × 1821 px dentro de ella, y
las cajas se pintan en porcentaje, así que las proporciones son las de la foto):

| etiqueta                   | tamaño en el marco renderizado | % del ancho × alto de la foto |
| -------------------------- | ------------------------------ | ----------------------------- |
| arriba-izquierda (pintada) | 292 × 460 px                   | 22,3 % × 25,3 %               |
| abajo-izquierda (perdida)  | 204 × 304 px                   | 15,5 % × 16,7 %               |
| abajo-centro (perdida)     | 156 × 292 px                   | 11,9 % × 16,0 %               |
| abajo-derecha (perdida)    | 156 × 288 px                   | 11,9 % × 15,8 %               |

**Las de abajo son 0,68× las de arriba en lado lineal.** No están recortadas ni fuera de cuadro
(ocupan del 74 % al 98 % de la altura, dentro de la foto), y ampliadas se leen **mejor** que las de
arriba: la de arriba-izquierda tiene la trama del fleje encima y el código UPC corrido; la de
abajo-izquierda está limpia. Lo que cambia es el tamaño, no la nitidez.

Y los tres recuadros que sí se pintaron no cubren lo mismo:

| recuadro        | alto pintado | qué cubre de verdad                                                   |
| --------------- | ------------ | --------------------------------------------------------------------- |
| 1 · `03-4069BL` | 502 px       | la etiqueta, ajustado (la etiqueta mide 460 px)                       |
| 2 · `03-4466BR` | 798 px       | la etiqueta **más** toda la rejilla de rosetas «Bicycling 2005–2013»  |
| 3 · `03-4466BR` | 244 px       | **sólo la mitad de abajo** de su etiqueta (de `RENEGADE C4` a `G.W.`) |

O sea: en la misma foto, un cluster se queda corto, otro se pasa 1,7× del tamaño de una etiqueta, y
el tercero acierta. El segmentador no está fallando sólo abajo; abajo es donde el fallo se nota
porque deja la casilla vacía.

---

## 2. Lo que se puede afirmar sin correr nada

**a) El número «3» de la pantalla no es el número de etiquetas encontradas.** `PalletScanSheet` sólo
pinta y sólo cuenta cajas con SKU:

```ts
// src/features/recognition/components/PalletScanSheet.tsx:57
const namedBoxes = (boxes) => boxes.filter((b) => !!b.sku.photoValue);
```

`recognizeMultiBoxClient` devuelve `totalBoxes` (`recognizeMultiBoxClient.ts:570`) y un
`summaryText` que imprime **todas** las cajas, incluidas las que dicen `SKU: (no detectado en foto)`
(`recognizeMultiBoxClient.ts:176`). La hoja no enseña ninguno de los dos. **Hoy no sabemos si el
motor encontró 3 etiquetas o 7**, y eso no es un detalle: es lo que convierte cada uno de los fallos
de abajo en silencio.

**b) Eso ya pasa con el fixture real del repo.** Corriendo `segmentLabels2D` +
`extractFieldsFromOcrLines` sobre `__tests__/fixtures/real_two_boxes_size14_ocr.json` (29 ítems de
PP-OCRv6 reales, 1500 × 2000):

| cluster | ítems | anclas | pasa `validClusters` | SKU         | texto                                                          |
| ------- | ----- | ------ | -------------------- | ----------- | -------------------------------------------------------------- |
| 1       | 1     | 0      | **no**               | —           | `8hh0-10`                                                      |
| 2       | 6     | 0      | sí                   | **`null`**  | `JBIMIS / S/D / ALLEGRO A3 ST / 14” / SUGAR MINT / G220311108` |
| 3       | 21    | 9      | sí                   | `03-3858BL` | la etiqueta JAMIS completa                                     |
| 4       | 1     | 0      | **no**               | —           | `MADE IN TAIWAN`                                               |

`totalBoxes = 2`, y `PalletScanSheet` pintaría **1**. El cluster 2 es un cartón de verdad —una
etiqueta interna de Scratch & Dent, **tipo D, que «a veces no trae SKU»** según `01-lo-aprendido.md`
§2— leída entera y borrada de la pantalla por no tener SKU. El síntoma reportado tiene una
reproducción dentro del repo.

**c) Las tres perdidas no se fundieron con ninguna de las pintadas.** Si dos etiquetas caen en el
mismo cluster, `extractFieldsFromOcrLines` no elige: escribe `CONFLICTO: A ≠ B`
(`clientOcr.ts:730-734`), que es una cadena **con valor**, así que se pintaría igual con ese texto en
la píldora. No hay ninguna píldora de conflicto en la captura, y los tres recuadros terminan antes
del 47 % de la altura mientras las etiquetas perdidas empiezan en el 74 %. Quedan exactamente tres
salidas posibles, y son las tres ramas del experimento de §4:

1. hay cluster, pero sin SKU → `namedBoxes` lo borra;
2. hay cluster, y `validClusters` lo tira;
3. no hay cluster porque el OCR no sacó texto ahí.

---

## 3. Las causas, ordenadas por cuánto explican **este** caso

### 3.1. Los cuatro `03-4466BR` imprimen el mismo código de barras, y el lector se queda con uno

```ts
// src/lib/recognition/barcodes.ts — mergeReads()
const key = `${read.format}|${read.text}`;
```

`mergeReads` agrupa por **formato y texto, sin mirar dónde estaba**. Cuatro cartones del mismo SKU en
un pallet imprimen cuatro Code128 idénticos: salen del lector como **una sola** lectura, con la caja
del primer pase que la encontró y `hits: 4`. No es un caso raro en un pallet — es lo normal.

Después, en el motor:

```ts
// src/lib/recognition/recognizeMultiBoxClient.ts:342-349
for (const b of rawBarcodeReads) {
  for (const c of clustersToProcess) {
    if (isBarcodeAssociatedWithCluster(b.box, c.bbox)) { matchedCluster = c; break; }
  }
```

Los clusters vienen **ordenados de arriba abajo** (`labelSegmenter.ts:294-300`) y el bucle corta en
el primero que toca: la única lectura superviviente se cuelga del cluster **más alto** que la
contenga. El sesgo es exactamente el del síntoma.

Y hay medida que lo apoya: el recuadro 3 (arriba-derecha) **no cubre** la zona de su etiqueta donde
está impreso `03-4466BR` —su borde derecho cae justo donde empieza la caja negra del SKU—, así que su
SKU no salió del OCR de ese cluster: salió del Code128 del `ITEM:`, cuyo centro queda ~69 px por
encima del cluster contra un margen de 75 px (`isBarcodeAssociatedWithCluster`, margen por defecto
75, `recognizeMultiBoxClient.ts:127`). Seis píxeles de holgura. Esa misma etiqueta abajo no tiene
lectura que colgar porque `mergeReads` ya se la había comido.

**Y lo que no se pudo colgar de ningún cluster se tira:**

```ts
// recognizeMultiBoxClient.ts:341, 354 — se escribe y no se lee nunca más
const unassignedBarcodes: BarcodeRead[] = [];
...
} else { unassignedBarcodes.push(b); }
```

Un Code128 con checksum que decodifica a un SKU canónico es la prueba **más fuerte** que da esta
foto de que ahí hay un cartón —más que un cluster de OCR, porque lleva dígito de control— y hoy se
descarta en silencio si el rectángulo no encaja.

### 3.2. El SKU es lo único que hace visible una caja, y es el campo más frágil de los seis

Una caja sin SKU no se pinta (§2a) y ningún otro campo la rescata: el motor tiene modelo, talla,
color, peso, serie y cartón, pero `namedBoxes` sólo mira `sku.photoValue`. Para la etiqueta **tipo
B** (`03-4069BL`) el SKU **no existe como código de barras** —sus dos barras son UPC y GTIN, y
`interpretBarcode` las clasifica como `upc` (`barcodeText.ts:143`)—, así que depende al 100 % del
OCR de la banda negra. Para la **tipo A** depende del Code128, que es lo que 3.1 acaba de perder.

Dicho de otra forma: de las tres etiquetas que faltan, dos fallan si falla el canal de barras y la
tercera falla si falla el canal de OCR. **No hace falta que falle todo; basta con que cada una
pierda su único canal.**

### 3.3. La resolución efectiva es 0,43× para detectar y 0,50× para leer — y el tope que manda **no**

es el de PickD

La hipótesis de partida era `targetMaxPixels` (`clientOcr.ts:1743`). La aritmética dice que ese tope
casi no participa, porque la librería vuelve a recortar por su cuenta. Para una foto de 12,2 MP
(3024 × 4032, que es lo que anota `06-pallet-en-double-check.md`):

| etapa                                     | de dónde sale el tope                                                    | lado largo | escala acumulada |
| ----------------------------------------- | ------------------------------------------------------------------------ | ---------- | ---------------- |
| foto                                      | la cámara                                                                | 4032       | 1,000            |
| lienzo del OCR                            | `targetMaxPixels = 4_000_000` (`clientOcr.ts:1743`)                      | 2310       | 0,573            |
| **entrada del detector**                  | `detection.maxSideLength: "auto"` = `clamp(0,75·lado, 960, 1920)` → 1728 | 1728       | **0,429**        |
| **lienzo del que se recortan las líneas** | `recognition.maxCropSourceSideLength = 2000`                             | 2000       | **0,496**        |

Poniendo `targetMaxPixels: 16_000_000` (o sea, quitando el tope de PickD):

| etapa                | antes | después | ganancia  |
| -------------------- | ----- | ------- | --------- |
| entrada del detector | 0,429 | 0,476   | **+11 %** |
| lienzo de recortes   | 0,496 | 0,496   | **0 %**   |

**Subir `targetMaxPixels` y nada más es casi un no-op.** El detector sigue topado en 1920 («auto» ya
está pegado a su techo con cualquier foto ≥ 2560 px) y el recortador sigue topado en 2000. Los dos
topes son de `ppu-paddle-ocr` y PickD **no pasa ninguna de las dos opciones**: el servicio se
construye con `{ model, debugging }` y nada más (`clientOcr.ts:1502-1509`).

Con esas escalas, y midiendo sobre la captura, la letra de cuerpo de una etiqueta:

| lo que ve el modelo                         | etiqueta de arriba | etiqueta de abajo |
| ------------------------------------------- | ------------------ | ----------------- |
| alto de renglón en la foto                  | ~24 px             | ~18 px            |
| ídem en la entrada del detector (×0,429)    | 10,4 px            | **7,6 px**        |
| ídem en el recorte del reconocedor (×0,496) | 12 px              | **8,8 px**        |
| banda negra del SKU, en el recorte          | ~27 px             | ~20 px            |

Y el filtro que convierte «pequeño» en «no existe» está documentado por la propia librería:

> `minimumConfidence` — _Drop recognized items whose confidence is below this value. Mirrors
> upstream PaddleOCR's `drop_score`: noise regions (hatch patterns, logos, barcodes) read as text at
> 0.2-0.45 confidence, while real text measures 0.65+._ **@default 0.5**

Un renglón real de 8,8 px estirado a los 48 px que pide el reconocedor (5,5×) aterriza justo en esa
banda de 0,2–0,45 y **se descarta como ruido, sin contador y sin log**. La banda del SKU (20 px)
debería sobrevivir; el resto del cuerpo de la etiqueta, no necesariamente — y el cuerpo es lo que
aporta las anclas que hacen pasar el filtro de §3.5.

### 3.4. Un `hMed` global para toda la foto

```ts
// src/lib/recognition/labelSegmenter.ts:186
const hMed = calculateMedianItemHeight(validItems);
```

Una sola mediana de altura de glifo para la foto entera, usada en cada comparación de pares
(`areItemsSpatiallyAdjacent`, `Ty = 2,2·hMed`, `Tx = 2,5·hMed`) y en la reconciliación vertical
(`dy <= 3,0·hMed`, línea 254). En un pallet las etiquetas están a distintas distancias: aquí 24 px
arriba y 18 px abajo. Un umbral calculado con la letra de unas se aplica a las otras, y de ahí salen
los dos recuadros mal medidos de §1: el 2 se traga la rejilla de rosetas (798 px de alto, 1,7× una
etiqueta) y el 3 se queda con media etiqueta porque el fleje negro la parte en dos y la
reconciliación no las vuelve a unir. **Una etiqueta partida no desaparece: desaparece la mitad que
no tiene el SKU** — y si el SKU cae en la mitad que se pierde, desaparece entera.

### 3.5. `validClusters`: se descarta sin decir qué ni por qué

```ts
// src/lib/recognition/recognizeMultiBoxClient.ts:327-333
const validClusters = clusters.filter(
  (c) => c.hasSkuPattern || (c.items.length >= 2 && c.anchorsCount >= 1) || c.items.length >= 4
);
const clustersToProcess = validClusters.length > 0 ? validClusters : clusters;
```

Una etiqueta leída a medias —dos o tres ítems, ninguno que sea un ancla estructural— no pasa. El
respaldo de la línea 333 es **todo o nada**: como los tres clusters de arriba sí pasaron,
`validClusters.length > 0` y los débiles se van sin dejar rastro. En el fixture el filtro acierta
(tira `8hh0-10` y `MADE IN TAIWAN`), y por eso no hay que relajarlo — hay que hacer que **diga qué
tiró**.

### 3.6. El reconocedor agrupa renglones cruzando etiquetas

`strategy: 'per-line'` es el default, y `groupBoxesIntoLines` (en la librería) agrupa por proximidad
vertical **sin ninguna restricción en X**, comparando cada caja con la **anterior**, no con la media
de su renglón. Es el mismo «efecto avalancha» que el propio PickD arregló en su
`groupLinesBySpatialProximity` (`clientOcr.ts:236-240`) y que la librería no tiene. Con tres
etiquetas lado a lado, cajas de etiquetas distintas a la misma altura acaban en un solo recorte
cosido (`mergeLineCrop`), se reconocen de una y el texto se **reparte después por proporción de
ancho** (`splitBatchTextByWidths`): un corte una letra más allá parte `03-4069-BL` y la expresión
canónica deja de casar. Es la causa más difícil de comprobar desde fuera y la que menos peso tiene
_a priori_, pero es la única que explicaría un SKU leído y aun así perdido.

---

## 4. Cómo distinguir una causa de otra

### Experimento 1 — cero código, 2 minutos

`/label-test` ya existe (`src/App.tsx:219`) y ya enseña **`Cajas detectadas: {totalBoxes}`**
(`LabelTestScreen.tsx:818`) y un botón que copia `summaryText` entero (línea 531), con `BBox` y
`Anclas` de **cada** caja, incluidas las que no tienen SKU. Subir **la misma foto** ahí y leer:

| lo que dice el resumen                                                                           | qué significa                        | a dónde ir                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------- |
| `Cajas detectadas ≥ 5` y ≥ 2 con `SKU: (no detectado en foto)` cuyo `BBox y` > 60 % de la altura | el motor **sí** vio la fila de abajo | causas 3.1 y 3.2; **no** tocar los topes |
| `Cajas detectadas` 3 ó 4 y ningún `BBox y` por debajo del 55 % de la altura                      | el OCR no sacó texto abajo           | causa 3.3 → experimento 2                |
| aparece un `SKU: CONFLICTO: … ≠ …`                                                               | dos etiquetas en un cluster          | causa 3.4                                |
| `Cajas detectadas` 6 y 3 con SKU                                                                 | sólo falta enseñarlo                 | propuesta P1, y nada más                 |

Anotar además la línea `Foto: … (W×H px, N KB)` que el resumen imprime primero: confirma si son
12,2 MP y valida la aritmética de §3.3, que está calculada sobre 3024 × 4032.

### Experimento 2 — los dos topes de la librería, tres líneas, sin commit

Sólo si el experimento 1 cae en la fila «el OCR no sacó texto abajo».

```ts
// clientOcr.ts:1502 — el tipo marca charactersDictionary obligatorio; para la prueba, un cast
new PaddleOcrService({
  model: { ... },
  detection: { maxSideLength: 2560 },
  recognition: { maxCropSourceSideLength: 4096 } as RecognitionOptions,
  debugging: { debug: false, verbose: false },
});

// recognizeMultiBoxClient.ts:304
runClientOcr(imageBlob, { targetMaxPixels: 16_000_000 })
```

Las tres van **juntas**: `maxCropSourceSideLength` no sirve de nada si el lienzo que recibe ya venía
recortado a 4 MP. Escalas resultantes: detector 0,635 (+48 %), recortes 1,000 (**×2,0**).

- **Si aparecen ≥ 5 cajas con SKU** → era resolución. El coste se lee en el mismo resumen: el tramo
  `OCR: …ms` debe subir ~2,2× (el tensor del detector pasa de 2,3 a 4,9 Mpx; los recortes no cuestan
  más porque se aplastan a 48 px de alto igual).
- **Si sigue en 3** → no era resolución, y los topes se dejan como estaban.

### Experimento 3 — el umbral de confianza solo, un número

`recognize()` acepta opciones por llamada (`RecognizeOptions` incluye `minimumConfidence` y
`strategy`), así que basta ensanchar la firma de `PaddleServiceLike` (`clientOcr.ts:1224`) y llamar
`service.recognize(canvas, { minimumConfidence: 0.3 })`.

- **Si con eso solo aparecen las tres** → lo que se perdía era el `drop_score`, no los píxeles. Y
  entonces **el arreglo no es bajar el umbral globalmente** (ver §5): es volver a leer el recorte.
- Mirar el resumen buscando SKUs que no están en el pallet: con 0,3 entran las rosetas «Bicycling
  2005» y las tramas del cartón, y ése es precisamente el precio.

### Experimento 4 — la estrategia de renglón, un enum

`service.recognize(canvas, { strategy: 'per-box' })`. Si el número de cajas sube, la causa 3.6 está
viva. El coste es una inferencia por caja de texto en vez de una por renglón, así que el `OCR: …ms`
del resumen dice de una lo que cuesta: se compara contra la corrida del experimento 1, no se estima.
Se corre sólo si 1–3 no explican nada.

### Lo que no se puede medir desde aquí

Nada de esto se puede decidir leyendo el repo: **el motor no reporta ni un número intermedio**. No
hay forma de saber cuántos ítems devolvió el OCR, cuántos clusters salieron, cuántos tiró
`validClusters` ni cuántos códigos de barras quedaron sin dueño, porque ninguno de esos valores sale
de la función. Los cuatro experimentos son la manera más corta de obtenerlos hoy; la propuesta P1
existe para que la próxima vez no haga falta ningún experimento.

---

## 5. La propuesta

Ordenada por «cuánto explica» ÷ «cuánto cuesta». Las tres primeras no mueven ningún umbral.

### P1 · Decir cuántas etiquetas se vieron, no cuántas tienen nombre

La hoja enseña `3 SKUS · 3 EN CATÁLOGO`. Falta la cifra de la que salen las otras dos: **cuántas
etiquetas aisló el motor**. `totalBoxes` ya existe y `PalletScanSheet` ya lo recibe —lo guarda en
`expected` y lo usa sólo en la línea de progreso (línea 222)—, así que es una cifra más en la fila de
abajo, en el estilo de la pantalla: cifra grande + etiqueta corta, y **sólo cuando difiere** de las
otras (`6 etiquetas · 3 skus · 3 en catálogo`).

No se pintan recuadros sin nombre: la regla de `06-pallet-en-double-check.md` («un recuadro sin
nombre no dice nada») sigue en pie. Lo que cambia es que el operador vea la diferencia entre «hay
tres cajas» y «hay seis y de tres no sé el nombre», que son dos respuestas distintas y hoy se ven
igual. Es lo único de esta lista que no puede empeorar nada, y es lo que convierte el próximo fallo
en un reporte en vez de en otra sesión como ésta.

### P2 · Un código de barras que nadie reclamó es una etiqueta, no basura

Dos cambios que van juntos y no tocan ningún número mágico:

1. **`mergeReads` deja de fundir lecturas que están en sitios distintos.** La clave pasa a ser
   `formato|texto|celda`, donde la celda es el rectángulo de la lectura redondeado a un tamaño de
   etiqueta. Motivo, no umbral: _el mismo texto en dos sitios de la foto son dos cartones; el mismo
   texto en el mismo sitio, leído por el pase completo y por el mosaico 3×3, es uno._ Hoy se
   deduplican los dos casos con la misma regla, y por eso un pallet con cuatro cartones iguales no
   puede decir nunca «cuatro» — lo que además hace imposible la fase 2 (comparar contra la orden).
2. **Un `unassignedBarcode` cuyo `interpretBarcode` sea `stock-number` genera su propia caja**, con
   `bbox` = el rectángulo del propio código. Es una afirmación honesta y comprobable a ojo: «aquí
   leí este código». Lleva checksum (`checkCode39Mod43` para Code39), así que es la evidencia más
   dura que produce esta foto. Se marca `anchorsCount: 0` y `catalogStatus` normal.

**Riesgo de falso positivo:** una caja nueva donde no hay etiqueta. Sólo puede pasar si zxing decodea
un Code128 que no existe — y un Code128 mal leído no decodea, falla el checksum interno del símbolo.
El riesgo real es el contrario: **dos cajas donde hay una**, si el mismo código se lee en el pase
completo y en un mosaico con rectángulos que caen en celdas distintas. Por eso la celda de la clave
tiene que ser del tamaño de una etiqueta, no de un píxel.

**Verificación:** la misma foto tiene que dar 4 lecturas `03-4466BR` con cuatro cajas distintas y 2
de `03-4069BL`; `barcodes.test.ts` tiene que seguir verde (comprueba el _merge_ de la misma lectura
repetida entre pases, que es el caso que hay que conservar).

### P3 · Reintentar por recorte lo que no dio SKU — que es lo que el motor de una caja ya hace

`recognizeLabelClient` (el camino de una etiqueta) hace **dos** pases de barras: uno ciego y otro
guiado por el OCR, con `targetedRois` + `skipFullPass: true`
(`recognizeLabelClient.ts:454-463`), que pasa cada recorte por Lanczos ×3 + CLAHE + máscara de
enfoque (`imageFilters.ts:395`) — exactamente el tratamiento que necesita un código pequeño.
`recognizeMultiBoxClient` **no hace ese segundo pase**: lanza barras y OCR en paralelo
(`recognizeMultiBoxClient.ts:302-305`) y ahí se acaba. El motor multi-caja perdió el mecanismo que el
motor de una caja tiene para leer una etiqueta lejana.

Propuesta: después de segmentar, para **cada cluster que quedó sin SKU**, un segundo pase de barras
con `targetedRois = [cluster.bbox]` y `skipFullPass: true`. Coste: sólo se paga sobre lo que ya
falló, y el paralelismo del caso bueno no se toca. En esta foto serían tres recortes.

La misma idea vale para el texto si el experimento 3 dice que el problema es el `drop_score`: volver
a pasar **el recorte** del cluster por `recognize()` (un recorte de 400 × 690 px se procesa a
resolución nativa, porque los topes de la librería sólo muerden por encima de 1920/2000). Es decir:
**la resolución se gana recortando, no subiendo topes globales**, que es lo que el experimento 2
mide y lo que la aritmética de §3.3 ya anticipa.

### P4 · El umbral de proximidad sale de la letra de los dos ítems, no de la mediana de la foto

En `areItemsSpatiallyAdjacent` y en la reconciliación vertical, sustituir el `hMed` global por la
altura de los **dos ítems que se están comparando** (`min(a.height, b.height)`, o su media).

Motivo, en una frase: _dos cajas a distinta distancia de la cámara no comparten una regla de
proximidad; lo que comparten es la letra que tienen impresa._ El 2,2 / 2,5 no cambia — sigue siendo
«hasta dos renglones de separación», que es lo que mide una etiqueta; lo que cambia es **de qué
renglón** se habla. Por eso no es un número nuevo: es el mismo número aplicado a la escala correcta.

**Riesgo:** con letra pequeña los umbrales se encogen, o sea **más particiones**. El propio
`labelSegmenter.ts` dice que partir es menos grave que fundir («two labels merged into one cluster is
catastrophic … a label split into two is less damaging»), pero partir **no es gratis** aquí: es lo
que dejó al recuadro 3 con media etiqueta. Por eso P4 va después de P1 (una mitad sin SKU sigue
contando) y de P2 (el código de barras la rescata).

**Verificación:** `labelSegmenter.test.ts` entero, que congela cuatro escenas —incluidas la fuga de
la talla 14" y la paridad de una sola caja—, más `recognizeMultiBoxClient.test.ts` («returns
totalBoxes: 1 for single-box capture»). Y la prueba nueva es esta foto: seis clusters cuyos `bbox`
caigan sobre las seis etiquetas, con el 2 sin la rejilla de rosetas y el 3 entero.

---

## 6. Lo que **no** hay que hacer

- **No relajar `validClusters` para «no perder nada».** En el fixture real ese filtro tira
  `8hh0-10` y `MADE IN TAIWAN`, que es su trabajo. Sin él aparecen cajas fantasma y
  `recognizeMultiBoxClient.test.ts` («totalBoxes: 1 for single-box capture») cae. Lo que hay que
  añadir es el motivo del descarte, no permisividad.
- **No bajar `minimumConfidence` en producción.** La librería avisa de qué vive en la banda 0,2–0,45:
  «hatch patterns, logos, barcodes». Esta foto tiene doce rosetas «Bicycling 2005–2013» y una trama
  de cartón; con el umbral bajo entran como texto, mueven la mediana de altura de §3.4 y —lo caro—
  **un número basura puede casar con `CANONICAL_SKU_REGEX`** (`\d{2}[-.\s]?\d{4}[-.\s]?[A-Z]{0,2}`
  acepta seis dígitos con un separador). Una píldora con un SKU que no está en el pallet es peor que
  una etiqueta sin píldora: Double Check existe para probar lo que hay.
- **No aflojar los multiplicadores 2,5 / 2,2 «para que junte más».** Toda la sub-fase O-1 existe para
  separar, y el fixture de la talla 14" es el test que lo congela: aflojar devuelve la contaminación
  cruzada (`SIZE 14"` de la caja de al lado sobre `03-3858BL`) y, en una foto con dos SKUs repetidos,
  produce `CONFLICTO` donde había dos cartones buenos.
- **No subir `targetMaxPixels` y darlo por arreglado.** +11 % en detección, 0 % en reconocimiento
  (§3.3). Si alguien lo prueba solo y no cambia nada, la conclusión correcta **no** es «no era
  resolución»: es «ese no era el tope».
- **No subir `detection.maxSideLength` a la resolución de la foto.** El tensor del detector es
  cuadrático en el lado: 4032 de lado largo son 12,2 Mpx de entrada contra los 2,3 de hoy (5,4×), en
  WASM y en un teléfono. El tope del detector se elige por el tamaño de letra que hay que ver, no por
  el del sensor; el que sí se puede poner en nativo sin coste de inferencia es
  `maxCropSourceSideLength`, porque el recorte se aplasta a 48 px de alto de todas formas.
- **No pintar recuadros sin SKU.** Es la regla de `06-pallet-en-double-check.md` y sigue siendo
  correcta. La respuesta a «faltan tres» es **una cifra** (P1), no tres rectángulos anónimos sobre la
  foto.

---

## 7. Resumen en una línea

El motor puede haber leído las seis y la pantalla sólo puede enseñar las que tienen SKU; de las tres
que faltan, dos dependían de un Code128 que `mergeReads` había fundido con el de arriba por tener el
mismo texto, y la tercera de un OCR que las ve a 8,8 px de renglón cuando a las de arriba las ve a 12. El experimento 1 —la misma foto en `/label-test`, leer `Cajas detectadas`— reparte las tres
ramas en dos minutos y sin tocar una línea.
