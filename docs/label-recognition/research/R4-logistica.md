# R4 · Lectura de etiquetas de caja en logística y almacén: productos, trabajo abierto y qué copiar

> Investigación del 15 sep 2026 para PickD (`docs/label-recognition/`). Ángulo: productos y trabajo
> **específicos de logística, almacén y retail** que leen etiquetas que mezclan barras y texto. Parte de
> `01-lo-aprendido.md`: tipos A–F, validaciones, reglas de negocio y las 13 cajas de verdad de terreno.
> Las APIs genéricas de documentos y los VLM (Azure, Google, AWS, OpenAI, Mistral) los cubren otras
> líneas (R1–R3); aquí sólo aparecen cuando un producto de logística se apoya en ellos.
>
> Convención: **[doc]** = documentación técnica del fabricante · **[mkt]** = página comercial (afirmación
> sin verificar) · **[paper]** = publicación · **[medido]** = comprobado en esta sesión.

---

## 0. En una página

- **El producto de referencia es Scandit Smart Label Capture** (SDK 8.x, web incluida). Es el único que
  vende exactamente nuestro gesto: una etiqueta se declara como **esquema de campos** (barras + texto,
  con palabra ancla, regex del valor, opcional/obligatorio y posición), se captura **en uno o varios
  pasos por caras de la caja** con una lista de verificación visible y **entrada manual** de lo que no se
  lee, y si el modelo del dispositivo no puede, **escala a un modelo grande en la nube** (beta). Tiene
  además _OCR fallback_ (lee los dígitos impresos cuando la barra está rota) y _Smart Barcode Selection_
  (en escenas densas no adivina: pasa el control al operario).
- **Nadie vende la parte que más nos importa:** saber que `G.W.` es el peso a guardar, que el GTIN repite
  el UPC, que una D blanca va sobre una A de fábrica, y cruzar con el AS400. Eso lo resuelven —en
  receiving de verdad— **PackageX** y **Vimaan** con reglas de negocio propias por despliegue y una
  política dura: _cero o varias coincidencias con el maestro ⇒ no se escribe, se pregunta_.
- Los líderes clásicos se han movido: **Honeywell vendió** su división de escáneres a Brady (abr 2026);
  **Cognex** cerró su SDK móvil (30 sep 2025) y vive en túneles fijos; **Anyline** ya es casi sólo
  neumáticos/automoción; **Klippa** es ahora **Doxis AI.dp**; **Scanbot** es de **Apryse**; **Microblink**
  es identidad. **Zebra** tiene lo más parecido a Scandit (_Picklist + OCR_ con reglas y umbral de
  confianza), pero **sólo en hardware Zebra**.
- **Casi todo se puede copiar sobre piezas abiertas**, y en nuestro flujo (foto, no vídeo; decenas de
  cajas al día, no miles) copiar sale mejor que comprar: `zxing-wasm` (multi-barra, invertidas,
  rotadas, con posición y validez) + un VLM con **esquema por tipo de etiqueta y evidencia por campo** +
  la **validación determinista** que ya existe en `01` + reglas de maestro al estilo Vimaan + una UI
  tipo _Validation Flow_. Sólo compensa **comprar** para escaneo en vídeo en tiempo real con AR en escenas
  densas o para operar sin conexión con latencia <1 s y volumen alto.
- **Hallazgo en el código actual [medido]:** `src/features/fedex-returns/hooks/useBarcodeScanner.ts`
  reduce la foto a 1.280 px y su _fallback_ (`@zxing/browser`, proyecto en modo mantenimiento) devuelve
  **una sola barra**. En iOS `BarcodeDetector` no existe (deshabilitado por defecto en Safari 17–27), así
  que en un iPhone una etiqueta Taiwán con 3–4 códigos daría uno. Es el primer arreglo barato.

---

## 1. Qué le pedimos a un producto (criterios)

Derivados de `01-lo-aprendido.md` §2–§7:

| #   | Criterio                                                                                                                     | Por qué (caso real)                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| C1  | Lee **varias barras** por foto y dice **cuál es cuál** (SKU Code 128, UPC-A, GTIN-14, serie, frame)                          | Tipo A trae tres códigos arriba; B trae UPC + GTIN |
| C2  | Lee **texto** asociado a una etiqueta de campo (`G.W.`, `COLOR`, `SIZE`), también **en dos columnas** y **corrido una fila** | 03-3850BK: `13 KGS` impreso encima de `N.W.`       |
| C3  | **Texto blanco sobre negro** (cajas de SKU y MODEL)                                                                          | Tipos A y B                                        |
| C4  | **Varias etiquetas** en la misma caja: apiladas, reetiquetadas, FedEx encima                                                 | 03-3925BK, 03-3850BK, 03-3868BL, 03-3970BL         |
| C5  | **Varias caras** de la misma caja, fusionadas                                                                                | 03-4149BR: ninguna cara entera, juntas sí          |
| C6  | **Daño**: film, brillo, tinta corrida, dígito tapado → `null` o duda, nunca un dígito inventado                              | 03-4000BL `20.?0`                                  |
| C7  | **Validación** por campo (checksum, forma, rangos) y **confianza/evidencia** por campo                                       | UPC `02459` descartado por control                 |
| C8  | **Cruce con maestro** y política ante 0/varias coincidencias                                                                 | X.24 sin talla en AS400                            |
| C9  | Integración **PWA** (React, navegador del móvil) o, como mucho, Android                                                      | PickD es PWA                                       |
| C10 | Precio razonable para **un almacén**, no una cadena                                                                          | Decenas de cajas/día                               |

---

## 2. Mapa del mercado (sep 2026)

| Producto                                                                                             | Qué hace con etiquetas barras + texto                                                                                                                                                                                                                         | Modo de captura                                                                                          | Web / Android                                  | IA / nube                                                                                                                    | Precio público                                                               | Estado 2026                                                           | Encaje PickD                                                              |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Scandit Smart Label Capture**                                                                      | Esquema de etiqueta: `CustomBarcode` / `CustomText` con `anchorRegexes`, `valueRegexes`, `symbologies`, `isOptional`, `numberOfMandatoryInstances`, `location`; campos prehechos (serie, part number, IMEI, precio, peso, fechas)                             | Vídeo en vivo; _Validation Flow_ guiado de uno o varios pasos (caras) con entrada manual                 | Sí / Sí (+iOS, RN, Flutter, Capacitor, .NET)   | On-device; _Adaptive Recognition_ escala a modelo en nube (beta); tipos _Receipt_ y _ShippingLabel_ (web 8.6.0, 31 ago 2026) | No; anual por dispositivo o por escaneo, bajo cotización                     | Activo, release mensual                                               | **Referente funcional**; caro y cerrado para nuestro volumen              |
| **Scandit OCR Fallback / Smart Barcode Selection / MatrixScan Count**                                | Si la barra falla, lee los dígitos impresos (Code128, Code39, Codabar, EAN13/UPCA); en escena densa muestra un apuntador en vez de adivinar; MatrixScan cuenta pallets enteros con AR                                                                         | Vídeo                                                                                                    | Sí / Sí                                        | On-device                                                                                                                    | Cotización                                                                   | Activo                                                                | Ideas a copiar; AR en vivo no nos hace falta                              |
| **Dynamsoft Capture Vision** (Barcode Reader + Label Recognizer + Code Parser + Document Normalizer) | Plantilla JSON encadena tareas: la barra localizada **ancla la región** donde se lee su texto; `TextLineSpecification` con `StringRegExPattern`, `StringLengthRange`, `ConfusableCharactersCorrection`; `GTM_INVERTED` para claro sobre oscuro                | Vídeo o imagen; filtro multi-frame (`MultiFrameResultCrossFilter`, verificación cruzada y deduplicación) | Sí (WASM) / Sí                                 | On-device, sin LLM                                                                                                           | **Label Recognizer desde USD 1.249/año; Barcode Reader desde USD 1.499/año** | Activo (bundle 3.0.x, jul 2026)                                       | **Mejor alternativa comprable** si hiciera falta OCR clásico configurable |
| **Scanbot SDK** (Apryse)                                                                             | _Text Pattern Scanner_: una línea de texto en una ROI, **acumula varios frames**, limpia y valida con patrón; devuelve `confidence` y `validationSuccessful`. Barcode con filtros regex                                                                       | Vídeo                                                                                                    | Sí / Sí                                        | On-device                                                                                                                    | **Desde USD 2.500/año, dispositivos y escaneos ilimitados**                  | Activo; comprado por Apryse (10 jul 2025)                             | Útil sólo para campos de una línea; no hay esquema de etiqueta            |
| **Anyline**                                                                                          | Barcode (40+ simbologías, hasta 30 paquetes en pantalla), contenedor ISO 6346, _serial number_ con whitelist/regex, escáner de documentos                                                                                                                     | Vídeo                                                                                                    | Web JS / Sí                                    | On-device                                                                                                                    | Cotización                                                                   | Foco comercial y noticias casi sólo en neumáticos/automoción          | Bajo                                                                      |
| **Zebra DataWedge — Workflow Input**                                                                 | **_Picklist + OCR_**: barras y texto en un flujo, reglas separadas (regex, longitud, empieza/contiene) y **umbral de confianza OCR (0–100, def. 75)**; _Free-Form OCR_ (ML Kit v2) con autocaptura por regex; _NG SimulScan_ resalta barras                   | Cámara o imager del dispositivo                                                                          | No / **Sólo dispositivos Zebra**               | On-device                                                                                                                    | Licencia Mobility DNA Enterprise en gama Professional                        | Activo                                                                | Sólo si se compran TC Zebra                                               |
| **Zebra AI Data Capture SDK 4.1**                                                                    | TextOCR (palabras, líneas, párrafos, confianza, cajas rotadas; ~15 caracteres por palabra sin _tiling_), Barcode Decoder, `EntityTrackerAnalyzer` con IDs persistentes entre frames, localizador de pallet y caja (beta)                                      | CameraX                                                                                                  | No / **Sólo Zebra**                            | On-device                                                                                                                    | No publicado                                                                 | Activo                                                                | Ídem                                                                      |
| **Zebra OCR Wedge**                                                                                  | 6 configuraciones fijas: VIN, TIN, matrícula, contador, contenedor, ID                                                                                                                                                                                        | Cámara                                                                                                   | No / Zebra                                     | On-device                                                                                                                    | Licencia por configuración                                                   | Activo                                                                | No aplica                                                                 |
| **Honeywell SwiftDecoder**                                                                           | Barras + OCR con _bounding box_, ROI única o **plantillas multi-ROI**; OCR-A/B, MICR; AR _SwiftFind_                                                                                                                                                          | Vídeo                                                                                                    | iOS/Android/Win/Linux + RN, Flutter, Capacitor | On-device                                                                                                                    | Prueba 60 días; cotización                                                   | División PSS **vendida a Brady** (anunciado 20 abr 2026, USD 1.400 M) | Incierto                                                                  |
| **Cognex**                                                                                           | OCRMax y OCR por deep/edge learning en líneas fijas y túneles                                                                                                                                                                                                 | Cámaras fijas                                                                                            | —                                              | Edge                                                                                                                         | Cotización                                                                   | **cmbSDK móvil fin de vida 30 sep 2025**                              | No aplica                                                                 |
| **Microblink**                                                                                       | Identidad (BlinkID) y recibos (Actual, ex-BlinkReceipt); BlinkInput (OCR por plantillas) sin novedades                                                                                                                                                        | Vídeo                                                                                                    | Sí / Sí                                        | On-device                                                                                                                    | Cotización                                                                   | Pivot a identidad                                                     | No aplica                                                                 |
| **PackageX Vision SDK + Receiving**                                                                  | Etiquetas de envío (300+ carriers), BOL, **etiquetas de artículo**, precios; barras dañadas o **solapadas**; receiving que **cruza con PO/ASN/maestro de artículos**, marca excepciones y **pide confirmación humana**; sugiere ubicación                     | Móvil                                                                                                    | iOS, Android, RN, Flutter (web no citada)      | On-device 200–400 ms [mkt]; nube 2–3 s                                                                                       | Cotización                                                                   | Activo                                                                | **Referente de flujo de receiving**                                       |
| **Vimaan ParcelSCAN / DockTRACK**                                                                    | Barras + OCR de todas las etiquetas visibles; **selección de la etiqueta de interés por reglas** (carrier, proveedor, simbología, longitud, posición, texto cercano, jerarquía); tabla de excepciones (0 coincidencias, varias, sin identificador ⇒ bloquear) | Túnel / estación fija, 5 caras de pallet                                                                 | —                                              | Edge + nube                                                                                                                  | Cotización                                                                   | Activo                                                                | **Referente de reglas y excepciones**                                     |
| **Gather AI / Dexory**                                                                               | Dron o robot fotografía ubicaciones, lee barras y texto, **compara con el WMS** y entrega **la foto de cada excepción** para conciliar desde la mesa                                                                                                          | Dron / robot                                                                                             | —                                              | Nube                                                                                                                         | Cotización                                                                   | Activo                                                                | Idea de UI de excepciones                                                 |
| **Veryfi (AnyDocs)**                                                                                 | Etiquetas de envío con LLM multimodal: courier, tracking, direcciones; `OCR score` por documento                                                                                                                                                              | Subida de imagen; SDK Lens                                                                               | API REST                                       | Nube                                                                                                                         | Gratis 100 docs/mes; Starter **USD 500/mes mínimo**                          | Activo                                                                | Bajo (etiquetas de carrier, no de producto)                               |
| **Doxis AI.dp** (ex-Klippa DocHorizon)                                                               | Etiquetas de envío: carrier, tracking, direcciones, peso, bultos; JSON/XML/CSV                                                                                                                                                                                | Subida; SDK móvil                                                                                        | API                                            | Nube UE                                                                                                                      | Por campos y volumen                                                         | Klippa comprada por SER (18 mar 2025), marca Doxis desde ene 2026     | Bajo                                                                      |

Fuentes de la tabla en §10.

---

## 3. Fichas de los que importan

### 3.1 Scandit Smart Label Capture — el referente

**Qué es.** Un _capture mode_ del SDK (`LabelCapture`) que recibe una o varias `LabelDefinition`. Cada
definición es una lista de campos:

- `CustomBarcode`: `symbologies` (obligatorio), `valueRegexes`, `anchorRegexes`, `isOptional`.
- `CustomText`: `valueRegexes` (obligatorio), `anchorRegexes` (_"context-identifying keywords… used to
  distinguish between fields that may have similar patterns"_), `isOptional`,
  `numberOfMandatoryInstances` (web desde 8.4.0, 18 may 2026), `location` (restricción espacial).
- Campos prehechos: `SerialNumberBarcode`, `PartNumberBarcode`, IMEI, `TotalPriceText`, `UnitPriceText`,
  `WeightText`, `ExpiryDateText`, `PackingDateText`; definiciones prehechas: precio, VIN, display de 7
  segmentos, recibo (beta, nube), **etiqueta de envío** (`AdaptiveRecognitionResultType.ShippingLabel`,
  `Carrier`, `ShippingLabelScanningResult`, web 8.6.0 del 31 ago 2026).
- _Semantics_: las notas de 8.5.0 (9 jul 2026) y 8.6.0 permiten usar la función "semantics" en campos de
  barras y de texto a la vez. **No está descrita en la referencia de `CustomText`** que encontramos; hay
  que tratarla como no documentada.
- Juego de caracteres del OCR: ASCII (`0-9 A-Z a-z ()-./:,$¶"` y espacio). Sin caracteres no latinos.

Ejemplo oficial (web), una caja de pescado con Code 128 y lote por ancla:

```js
LabelDefinition.builder()
  .addCustomBarcode()
  .setSymbologies([Symbology.code128])
  .buildFluent('barcode-field')
  .addCustomText()
  .setAnchorRegexes(['Batch'])
  .setValueRegexes(['FZ\\d{5,10}'])
  .setOptional(true)
  .buildFluent('batch-number-field')
  .buildFluent('shipping-label');
```

Cómo se escribiría nuestra **tipo A** en ese modelo (ilustrativo, no probado):

| Campo   | Tipo                               | Ancla       | Valor                                           |
| ------- | ---------------------------------- | ----------- | ----------------------------------------------- |
| `sku`   | CustomBarcode Code128 + CustomText | `ITEM\|SKU` | `\d{2}-?\d{4}-?[A-Z]{0,3}`                      |
| `upc`   | CustomBarcode UPC-A                | `UPC`       | `845436\d{6}`                                   |
| `gw`    | CustomText                         | `G\.?\s?W`  | `\d{1,2}([.,]\d{1,2})?\s?KGS?`                  |
| `nw`    | CustomText, opcional               | `N\.?\s?W`  | ídem                                            |
| `size`  | CustomText                         | `SIZE`      | `(700C\|650B\|26"\|ST)\s?[x*]?\s?\d{2}("\|CM)?` |
| `frame` | CustomText, opcional               | `FRAME`     | `[A-Z]{4}\d{5}`                                 |

**Lo que lo hace el mejor** (todo en su documentación):

1. **Barras y texto en una sola captura, contra un esquema.** No devuelve "todo el texto"; devuelve los
   campos que declaraste, con nombre.
2. **Validation Flow** (rediseñado en 8.2.0, 13 feb 2026): _"An always-present checklist shows users
   exactly which fields have been captured and which are still missing"_; campos obligatorios resaltados;
   **escaneo de uno o varios pasos "across different package sides"**; **entrada manual** con texto de
   ayuda cuando no se lee; la cámara se pausa al terminar y el listener recibe todos los campos.
3. **Adaptive Recognition** (beta): `AdaptiveRecognitionMode` `Off` (por defecto) / `Auto` / `On`.
   _"Whenever Smart Label Capture's on-device model fails to capture data, the SDK will automatically
   trigger the Adaptive Recognition Engine"_ — un modelo mayor en la nube. Es su versión de "OCR local,
   VLM en la nube cuando hace falta".
4. **OCR Fallback** en el escáner de barras: si una Code128/Code39/Codabar/EAN13-UPCA no decodifica, lee
   los dígitos impresos; sin regex configurada devuelve sólo alfanuméricos para no inventar.
5. **No adivinar en escenas densas.** _Smart Barcode Selection_ detecta un entorno denso y muestra un
   apuntador; su blog de SDK 8 (5 nov 2025) lo formula como política: cuando la IA no está segura,
   **agranda la vista y pasa la decisión a la persona**.
6. **Resultado por campo con estado y límites** (`predictedBounds`, `state`) y overlays para pintar cada
   campo sobre la imagen.
7. **No-code:** Scandit Express con plantillas (Smart Device, Price Weight, VIN) inyectadas como teclado.
   Caso Stratix (logística): +50 % de eficiencia, "pinpoint the needed barcode on each label" [mkt].

**Límites para nosotros.**

- Los campos son **regex + ancla + posición**. No hay razonamiento: no sabe que la D blanca manda sobre la
  A de fábrica, que `G.W. − N.W.` es constante por fábrica, ni que `X.24` sin talla es duda de identidad.
  Eso seguiría siendo nuestro código.
- La escalada a la nube es **beta** y sus tipos son de Scandit (recibo, etiqueta de envío), no nuestros.
- **Precio sólo bajo cotización**, anual por dispositivo o por escaneo; motor WASM pesado; dependencia
  total del proveedor.
- El folleto dice "iOS and Android only", pero la documentación web 8.6 incluye Label Capture: el folleto
  está desactualizado.

### 3.2 Dynamsoft Capture Vision — la versión "caja transparente"

- **Arquitectura** (`CaptureVisionRouter`): tareas encadenadas por **plantilla JSON** (barras → texto →
  parseo). Los resultados intermedios (escala de grises, binarización) se calculan una vez y se comparten.
- **Barra como ancla del texto:** _"This quadrilateral, combined with an offset setting, defines the
  TargetROIDef … for the label OCR task"_. Luego **compara la barra con el texto humano**: si difieren,
  "flag mismatches for manual review" o "use OCR data if the barcode fails" (blog, 29 oct 2025). El
  tutorial de paquetes (bundle 3.0.3001, 14 jul 2026) usa una plantilla `ReadBarcode&AccompanyText`
  invariante a rotación.
- **Especificación de línea de texto:** `CharacterModelName` (p. ej. `NumberLetterCharRecognition`),
  `StringRegExPattern`, `StringLengthRange`, `CharHeightRange`, `ConfusableCharactersCorrection`
  (0/O, 1/I…), `ConcatResults`, `ExpectedGroupsCount`.
- **Blanco sobre negro:** `GrayscaleTransformationModes: ["GTM_ORIGINAL","GTM_INVERTED"]` prueba ambas.
- **Vídeo:** `MultiFrameResultCrossFilter` con verificación cruzada entre frames y deduplicación (olvida
  un resultado a los 3 s por defecto).
- **Code Parser:** extrae campos semánticos de cadenas (MRZ, licencias, GS1).
- **Precio:** Label Recognizer **desde USD 1.249/año**; Barcode Reader **desde USD 1.499/año**; prueba de
  30 días.
- **Para nosotros:** todo lo que hace es configurable y explicable, pero exige **una plantilla por diseño de
  etiqueta** (A, B, C, D…) y sigue sin semántica. Es la opción a evaluar si algún día queremos OCR local
  sin VLM.

### 3.3 Scanbot SDK (Apryse) — multi-frame y validadores

- _Text Pattern Scanner_: OCR en una ROI rectangular **acumulando varios frames** ("more reliable and
  robust" que un OCR de una foto), bloque de limpieza y **validación por patrón**; resultado con
  `confidence` 0–1 y `validationSuccessful`. **Una línea** por diseño (IBAN, fechas, precios).
- Barcode con filtros por tipo y regex; web y nativo; todo on-device.
- **Precio publicado:** _"Pricing generally starts at $2,500"_, **ilimitado en dispositivos y escaneos**;
  prueba de 7 días.
- **Para nosotros:** la idea copiable es el **consenso multi-frame** para un campo concreto (p. ej. releer
  el G.W. en 3 frames antes de aceptar). No lee etiquetas completas.

### 3.4 Zebra — lo más cercano a Scandit, atado al hardware

- **Picklist + OCR** (DataWedge Workflow Input): barras y OCR en la misma sesión, **reglas separadas**
  para cada uno (regex, longitud mín./máx., empieza por, contiene, mayúsculas) y **umbral de confianza
  OCR 0–100 (por defecto 75)**. Es un "esquema de etiqueta" rudimentario sin código.
- **AI Data Capture SDK 4.1:** TextOCR con palabras/líneas/párrafos, confianza y cajas rotadas; decoder
  "Total" que sustituye por marcador los caracteres bajo el umbral (`decodingTotalProbThreshold` 0,9) en
  vez de inventarlos; **tiling** para palabras >15 caracteres; `EntityTrackerAnalyzer` con **ID
  persistente por entidad entre frames** (útil para no contar dos veces la misma etiqueta).
- **Licencia:** Mobility DNA Enterprise en la gama Professional; OCR Wedge por configuración. **Sólo
  dispositivos Zebra.**
- **Para nosotros:** dos ideas copiables — **umbral de confianza por campo que produce "no sé"** y
  **seguimiento de la misma etiqueta entre fotos**.

### 3.5 PackageX y Vimaan — el flujo de receiving, no el OCR

**PackageX** (Vision SDK + Inventory Receiving): el operario escanea; el sistema **cruza con PO, ASN y
maestro de artículos**, marca discrepancias para revisión humana, detecta daños, **sugiere ubicación** y
"Staff verify critical decisions before finalizing". Lee etiquetas de envío, BOL y **etiquetas de
artículo**; barras dañadas o solapadas. On-device 200–400 ms, nube 2–3 s; 95 % OCR / 99 % barras [mkt].

**Vimaan ParcelSCAN** (nota de aplicación): cuando hay varias barras, **no toma la primera legible**;
aplica reglas por despliegue — _carrier y perfil de proveedor, simbología y longitud, posición en el
paquete, texto cercano, jerarquía priorizada de identificadores_ — y puede decidir con **combinaciones de
campos** (peso declarado, lote, dimensiones) cuando uno solo no basta. Su tabla de excepciones es la
política que nos falta escrita:

| Situación                       | Respuesta de Vimaan                                                | Equivalente PickD                            |
| ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| Ningún identificador legible    | Retener para operario; no etiquetar                                | Pedir otra cara                              |
| Varios candidatos               | Aplicar reglas; si sigue ambiguo, **mostrar candidatos y retener** | Enseñar los SKU posibles                     |
| Sin coincidencia en sistema     | **Bloquear** el alta automática                                    | «No existe» ⇒ alta **propuesta**, no escrita |
| Varias coincidencias en sistema | **Bloquear** la asignación                                         | Identidad dudosa (X.24) ⇒ no escribir        |
| Fallo de verificación           | No liberar hasta ver la etiqueta esperada                          | —                                            |

**Gather AI / Dexory** añaden la pieza de UI: **cada excepción llega con su foto**, y se concilia desde la
mesa, no volviendo al pasillo.

### 3.6 Los que ya no son opción (y por qué importa saberlo)

- **Honeywell:** vende la división PSS (escáneres, móviles, impresoras) a **Brady** por USD 1.400 M
  (DC Velocity, 20 abr 2026). SwiftDecoder tiene **plantillas multi-ROI** de OCR, pero su futuro de
  producto es incierto.
- **Cognex:** _cmbSDK_ móvil **fin de vida 30 sep 2025**; lo demás son cámaras fijas y túneles.
- **Anyline:** noticias de jul–sep 2026 sólo de neumáticos y matrículas; sus módulos de logística
  (contenedor, serie, barras multi-paquete) siguen, pero sin esquema de etiqueta.
- **Microblink:** identidad y recibos.
- **Klippa → Doxis AI.dp**, **Scanbot → Apryse**: siguen, con otro dueño.

---

## 4. Trabajo abierto y papers

### 4.1 Piezas abiertas que sirven hoy

| Pieza                                                          | Qué aporta                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Datos verificados                                                                                                                                                                                                      | Uso en PickD                                                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`zxing-wasm` / `barcode-detector`** (ZXing-C++ en WASM, MIT) | Varias barras por imagen; `tryHarder`, `tryRotate`, **`tryInvert`** (claro sobre oscuro), `tryDownscale`, `maxNumberOfSymbols`, `returnErrors`, `validateOptionalCheckSum`; resultado con **`position`**, `isValid`, `orientation`, `symbology`                                                                                                                                                                                                                          | 30+ formatos (Code128, Code39, UPC-A/E, EAN, ITF, DataBar, QR, DataMatrix, PDF417); `.wasm` autoalojable; `barcode-detector` 3.2.2 activo                                                                              | **Sustituir** el fallback actual (`@zxing/browser`, modo mantenimiento, una barra)                                                                                                             |
| **`BarcodeDetector` nativo**                                   | Rápido en Chrome Android                                                                                                                                                                                                                                                                                                                                                                                                                                                 | caniuse: Chrome Android sí; **Safari iOS 17–27 deshabilitado por defecto**; Firefox no                                                                                                                                 | Sólo como vía rápida; nunca como única                                                                                                                                                         |
| **PaddleOCR**                                                  | PP-OCRv5 (may 2025), **PP-OCRv6** (3.7.0, 11 jun 2026: tiny 1,5 M / small 7,7 M / medium 34,5 M; +4,6 % detección y +5,1 % reconocimiento sobre v5 server); **PaddleOCR.js** para navegador (3.5.0, 21 abr 2026; `@paddleocr/paddleocr-js`, ONNX Runtime Web + OpenCV.js, WASM o WebGPU); PaddleOCR-VL-1.6 (0,9 B)                                                                                                                                                       | Página de releases de GitHub                                                                                                                                                                                           | OCR local de líneas con confianza, como **segunda opinión** barata frente al VLM                                                                                                               |
| **Florence-2 en transformers.js**                              | OCR, detección y _captioning_ 100 % en navegador con WebGPU; 230 M parámetros, ~340 MB en caché                                                                                                                                                                                                                                                                                                                                                                          | Anuncio de Xenova / HF                                                                                                                                                                                                 | Experimento; pesado para un móvil de almacén                                                                                                                                                   |
| **Qwen3-VL** (pesos abiertos)                                  | OCR en 32 idiomas, KIE, _grounding_ con cajas relativas                                                                                                                                                                                                                                                                                                                                                                                                                  | Repo QwenLM                                                                                                                                                                                                            | Plan B sin proveedor; ver Open Prices                                                                                                                                                          |
| **Open Food Facts · Open Prices + Robotoff**                   | **El análogo abierto más cercano:** foto → detector de etiquetas de precio → **VLM extrae precio y código** → **contribuyentes validan** en una página. Extraen con Gemini 3 Flash y entrenaron como alternativa propia un **Qwen3-VL-8B afinado**, "on par with Gemini 2.5 Flash" (algo por debajo de Gemini 3 Flash), que corre en una GPU de 24 GB (blog, 19 feb 2026). En el issue #670 (P0) reconocen que **Gemini no lee barras** y proponen ZXing/Scandit al lado | Blog OFF; issue GitHub                                                                                                                                                                                                 | Copiar el patrón **predicción → _insight_ → aplicar solo si es seguro o anotar** (Robotoff: `automatic_processing`, `annotation` 1/0/−1, no generar _insight_ si el producto ya tiene el dato) |
| **Datature — pipeline de etiquetas de envío**                  | Detector de campos (YOLOv8 / RT-DETR con 80–120 etiquetas anotadas) → recorte → PP-OCRv5 → JSON; barras con pyzbar/zxing                                                                                                                                                                                                                                                                                                                                                 | 2 abr 2026. En etiqueta limpia **7/9 campos (78 %)**: falló carrier y servicio **por la cabecera blanco sobre negro**; en escena con varias etiquetas el OCR devuelve "a flat wall of text" (53 líneas) sin atribución | Prueba de que **OCR plano no atribuye campos** y de que el invertido rompe OCR clásico                                                                                                         |

### 4.2 Papers

| Trabajo                                                                                                                    | Qué dice                                                                                                                                                                                                                                                                                                      | Lo que nos llevamos                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Suh et al., _Robust Shipping Label Recognition and Validation for Logistics by Using Deep Neural Networks_, IEEE ICIP 2019 | Reconoce y **valida** 25 tipos de etiqueta de envío; 96 % de acierto invariante a rotación; valida la **dirección con Google Maps API**                                                                                                                                                                       | La validación contra una fuente externa es parte del reconocimiento, no un extra                     |
| Dörr et al., _Fully-Automated Packaging Structure Recognition in Logistics Environments_, 2020 (FZI)                       | Desde una imagen, localiza unidades de transporte y su estructura de bultos; 85 % (91 % en tipos comunes)                                                                                                                                                                                                     | Detectar **caras/etiquetas** antes de leer                                                           |
| Gülsoylu et al., **TRUDI / TITUS**, BMVC 2025 (arXiv 2508.02372)                                                           | 35.034 instancias, cámaras de tierra y aéreas; tres etapas: segmentar unidad → detectar texto del ID → **reconocer y validar**                                                                                                                                                                                | Multi-perspectiva + validación del ID (tipo contenedor ISO 6346)                                     |
| Ji et al., **UNIKIE-BENCH**, arXiv 2602.07038 (feb–abr 2026)                                                               | 15 LMM; caen con **esquemas diversos, campos de cola larga y maquetación compleja**; problemas persistentes de **grounding** y razonamiento de layout                                                                                                                                                         | Un esquema **por tipo de etiqueta** (A–F), no uno genérico; pedir evidencia espacial                 |
| **KIE-HVQA**, _Seeing is Believing? Mitigating OCR Hallucinations in MLLMs_, NeurIPS 2025 (arXiv 2506.20168)               | Bajo blur, oclusión o bajo contraste, los MLLM **se apoyan en priors lingüísticos y alucinan** en vez de reconocer la degradación                                                                                                                                                                             | Exactamente el riesgo "dígito verosímil" de `01` §5                                                  |
| Roy et al., **ConfBench**, arXiv 2608.01792 (3 ago 2026)                                                                   | 1.346 variantes degradadas, 70.000 evaluaciones por entidad: la confianza es **más fiable con OCR + imagen** que con imagen sola; _logprob_ del primer token supera media y margen; calibración muy desigual entre modelos, de casi perfecta a muy sobreconfiada                                              | Dar al VLM **también** lo que leyó el OCR/zxing, y no fiarse de la confianza que el modelo verbaliza |
| Kumar, **ExtractConf**, arXiv 2606.24420 (23 jun 2026)                                                                     | Dos llamadas opuestas —_Hunter_ (guiada por esquema, tiende a **inventar** campos) y _Mapper_ (lectura holística, tiende a **omitir**)— y su **desacuerdo** como señal, más calidad de OCR e imagen y layout: **0,928 AUC**, 99,1 % de acierto al 80 % de cobertura, −70 % de riesgo frente a _logprob_ medio | La discrepancia entre fuentes (barra vs VLM, cara 1 vs cara 2) **es** la confianza                   |
| Gong et al., **Geometric Risk Control for VLM OCR**, arXiv 2603.19790 (mar–jul 2026)                                       | Transformaciones geométricas controladas como sondas; **sólo libera transcripciones consistentes entre vistas**; reduce errores catastróficos manteniendo cobertura; código abierto                                                                                                                           | Nuestras **varias fotos/caras** hacen de sondas gratis                                               |
| Seitaj & Elangovan, _Information Extraction from Product Labels: A Machine Vision Approach_, IJAIA 15(2), mar 2024         | CRNN + Tesseract + NLP, enriquecido con la API de Open Food Facts                                                                                                                                                                                                                                             | Referencia académica menor; confirma el cruce con catálogo externo                                   |

---

## 5. Cómo resuelven los problemas que vimos

| Problema (caso)                                                            | Cómo lo hacen los líderes                                                                                                                                                                                                                                            | Qué hacemos nosotros                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Varias etiquetas apiladas** (D sobre A/C; A sobre A vieja; FedEx encima) | Vimaan: **etiqueta de interés por reglas** (simbología, longitud, posición, texto cercano, jerarquía). Scandit: _Smart Barcode Selection_ y, si duda, apuntador para el operario. Datature: **detector de etiquetas** antes del OCR, porque el OCR plano mezcla todo | El VLM devuelve `labels[]`, cada una con `type` (A–F), `layer` (encima/debajo/parcial) y sus campos; la precedencia es regla nuestra (D manda en identidad y serie; A/B/C mandan en UPC y peso; F sólo aporta contexto)                                                                                    |
| **Varias caras de la misma caja** (03-4149BR)                              | Scandit _Validation Flow_ multi-paso "across different package sides"; Zebra `EntityTracker` con ID persistente; Vimaan 5 caras de pallet                                                                                                                            | Sesión por caja con checklist de campos; fusión por **clave física** (FRAME NO + CARTON NO iguales ⇒ misma caja, como hizo la sesión)                                                                                                                                                                      |
| **Etiqueta dañada / dígito tapado** (`20.?0`)                              | Scandit _OCR Fallback_ (dígitos bajo la barra); Dynamsoft **barra vs texto** con marca de discrepancia; Zebra umbral de confianza que emite marcador en vez de carácter; Scanbot consenso multi-frame                                                                | Barra sana = verdad; si no hay barra, dígitos del VLM **con `null` permitido** + checksum + reglas (G.W.−N.W., serie de hermanas). **[medido]** El control UPC detecta el 100 % de errores de un dígito sobre `845436091594`, pero **deja pasar 1 de 11 transposiciones adyacentes**: es filtro, no prueba |
| **Texto blanco sobre negro**                                               | Dynamsoft `GTM_INVERTED`; zxing `tryInvert`; OCR clásico falla (Datature 7/9 por esto)                                                                                                                                                                               | zxing con `tryInvert`; el VLM lo lee sin preproceso; si se añade OCR local, pasar también la imagen invertida                                                                                                                                                                                              |
| **Qué número es SKU, UPC, GTIN, serie, frame, PO, carton**                 | Scandit `anchorRegexes` + `valueRegexes` + `symbologies` + `location`; Zebra reglas por barra y por texto; Dynamsoft regex + longitud; Vimaan simbología + longitud + texto cercano                                                                                  | Clasificador **determinista** de lo que decodifica zxing (UPC-A `845436\d{6}` con control; GTIN-14 `00845436\d{6}` y = UPC; Code128 con forma `canonical_sku`; serie/frame por patrón) + el VLM para el texto sin barra, con la palabra ancla leída como evidencia                                         |
| **Cruce con maestro**                                                      | PackageX: PO/ASN/maestro + excepciones + confirmación humana; Vimaan: 0 o varias coincidencias ⇒ bloquear; Gather AI: excepción con foto; Robotoff: aplicar sólo si es seguro, si no anotar                                                                          | Orden de búsqueda de `01` §4; **política Vimaan escrita**; la UI enseña la foto recortada de la evidencia de cada campo propuesto                                                                                                                                                                          |
| **Dígito inventado**                                                       | Scandit: no adivinar en escenas densas; Zebra: marcador bajo umbral; papers: desacuerdo entre llamadas/vistas (ExtractConf, GRC)                                                                                                                                     | `null` antes que inventar en el esquema; campo con checksum/catálogo nunca se acepta sin validar; discrepancia barra↔VLM o cara↔cara baja la confianza del campo **y** de la foto                                                                                                                          |
| **Anotaciones a mano, contexto FedEx**                                     | Ningún SDK de logística lo trata; Veryfi/Doxis leen etiquetas de carrier                                                                                                                                                                                             | Campo `notes[]` libre y `context` (`return_to_shipper`, `return_to_stock`) en el esquema del VLM; no escribe nada, sólo informa                                                                                                                                                                            |

---

## 6. Funcionalidades clave que definen a los mejores

| #   | Funcionalidad                                                                                                                              | Quién la tiene                                                                             | Por qué importa en PickD                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| F1  | **Esquema de etiqueta**: campos con nombre (barras y texto) con ancla, patrón de valor, opcional/obligatorio, posición                     | Scandit (completo), Zebra Picklist+OCR (reglas), Dynamsoft (plantillas)                    | Convierte "diez números sueltos" en SKU/UPC/G.W.                                |
| F2  | **Barras primero, texto como respaldo y contraste**: decodificar todas las barras, leer los dígitos impresos si fallan, **comparar** ambos | Scandit OCR Fallback, Dynamsoft barra-ancla + verificación cruzada                         | Exactitud sin alucinación donde hay barra; señal de confianza donde hay las dos |
| F3  | **Captura guiada multi-paso con checklist y entrada manual**                                                                               | Scandit Validation Flow                                                                    | Cubre caras dañadas y deja a la persona sólo lo que falta                       |
| F4  | **Validación y confianza por campo; "no sé" como salida válida**                                                                           | Zebra (umbral), Scanbot (`validationSuccessful`, `confidence`), Scandit (estado por campo) | La regla de `01`: todo lo verificable se verifica                               |
| F5  | **Escalada local → modelo grande** sólo cuando falla lo barato                                                                             | Scandit Adaptive Recognition; PackageX on-device/nube                                      | Coste y latencia bajos en el caso fácil                                         |
| F6  | **Selección de la etiqueta/barra de interés en escenas densas** y cesión del control al operario ante la duda                              | Vimaan (reglas), Scandit (Smart Barcode Selection)                                         | Apiladas y reetiquetadas                                                        |
| F7  | **Consenso entre frames / vistas**                                                                                                         | Scanbot, Dynamsoft `MultiFrameResultCrossFilter`, Zebra EntityTracker, GRC (paper)         | Varias fotos por caja = varias lecturas independientes                          |
| F8  | **Cruce con maestro con política de excepciones** (0/varias ⇒ no escribir)                                                                 | PackageX, Vimaan, Gather AI                                                                | Evita el alta equivocada; es donde está el valor de negocio                     |
| F9  | **Evidencia visual de cada propuesta** (recorte/caja del campo)                                                                            | Scandit `predictedBounds`, Gather AI fotos de excepción, Azure/AWS _grounding_             | La persona confirma mirando el recorte, no releyendo la caja                    |
| F10 | **Bucle de validación humana que alimenta la evaluación**                                                                                  | Robotoff (anotación 1/0/−1), Open Prices (página de validación), PackageX (confirmación)   | Las 13 cajas crecen solas como set de prueba                                    |

---

## 7. Copiar o comprar

| Funcionalidad                               | Pieza abierta / API para copiarla                                                                                                  | Esfuerzo                             | ¿Compensa comprar?                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| F1 Esquema de etiqueta                      | JSON Schema por tipo A–F en _structured output_ del VLM + reglas de ancla en TS                                                    | Bajo (el esquema ya está en `01` §3) | **No.** Los regex de Scandit ni siquiera expresan nuestra semántica                                                     |
| F2 Barras + texto + contraste               | `zxing-wasm` `readBarcodes` (multi, `tryInvert`, `tryRotate`, posición, `isValid`) + dígitos del VLM + `canonical_sku`/checksum    | Bajo                                 | **No** para fotos. Sí si se exige lectura en vídeo de barras muy dañadas en tiempo real                                 |
| F3 Captura guiada multi-paso                | Pantalla React con checklist por campo y teclado de corrección (Modal Manager, reglas de `ui-rules`)                               | Medio                                | **No.** Es UI; Scandit la vende atada a su modo de captura                                                              |
| F4 Confianza por campo                      | Señales propias: barra válida, checksum, forma canónica, acuerdo entre caras, acuerdo barra↔VLM, `null` del VLM, calidad de imagen | Medio                                | **No.** Ningún vendedor da confianza calibrada para _nuestros_ campos                                                   |
| F5 Escalada local → nube                    | Local: zxing (+ opcional PaddleOCR.js); nube: el VLM que ya usa PickD                                                              | Bajo                                 | **No.** Es nuestro diseño por defecto                                                                                   |
| F6 Selección en escenas densas (AR en vivo) | Para foto basta la regla de etiqueta de interés; el apuntador en vídeo es difícil                                                  | Alto si fuera en vivo                | **Sí, comprar** (Scandit/Dynamsoft) _sólo_ si se pasa a vídeo en vivo con muchas barras                                 |
| F7 Consenso multi-vista                     | Varias fotos por caja; opcional ráfaga de 3 frames para el campo dudoso; reconciliador en TS                                       | Medio                                | No                                                                                                                      |
| F8 Maestro + excepciones                    | Reglas de `01` §4 + tabla Vimaan; RPCs existentes (`register_sku_from_as400`)                                                      | Medio                                | **No se vende** para Jamis/AS400                                                                                        |
| F9 Evidencia visual                         | Cajas `box_2d` normalizadas 0–1000 del VLM (guía Google para Gemini) o `position` de zxing → recorte en canvas                     | Bajo                                 | No                                                                                                                      |
| F10 Bucle humano + evaluación               | Tabla de propuestas con `annotation` y `auto_applied`; métrica por campo y cobertura a confianza fija                              | Bajo                                 | No                                                                                                                      |
| Escaneo de pallets enteros / túnel / dron   | —                                                                                                                                  | —                                    | **Sólo comprar** (MatrixScan Count, Vimaan, Gather AI, Dexory); **fuera de escala** hoy                                 |
| OCR local sin nube, <1 s, sin conexión      | PP-OCRv6 tiny en navegador (sin semántica)                                                                                         | Alto                                 | **Comprar** Dynamsoft (desde USD 1.249/año) o Scanbot (desde USD 2.500/año, ilimitado) si el Wi-Fi del piso lo exigiera |

**Criterio de compra.** Scandit o Dynamsoft pasan a tener sentido si se da **al menos una** de: (a) el
piso quiere apuntar en vídeo y leer sin disparar foto; (b) volumen de cientos de cajas al día donde 2–3 s
de nube por caja pesan; (c) zonas sin cobertura. Ninguna se cumple con las 13 cajas de hoy.

---

## 8. Recomendación para PickD: un "Smart Label Capture" propio

Alineado con `01-lo-aprendido.md` §7, en orden de construcción:

1. **Arreglar las barras (días, no semanas).** Sustituir en `useBarcodeScanner.ts` el fallback de
   `@zxing/browser` por `zxing-wasm`/`barcode-detector` con `readBarcodes` a **resolución completa** (o en
   mosaico si la foto es enorme), `tryInvert`, `tryRotate`, `tryHarder`, formatos `Code128, Code39,
UPC-A, EAN-13, ITF, DataMatrix, QR`, conservando `position` e `isValid`. Hoy en iPhone sale **una**
   barra de una foto reducida a 1.280 px. Autoalojar el `.wasm` (el CDN por defecto es jsDelivr).
2. **Clasificar lo decodificado sin IA.** UPC-A `845436` + control → `upc`; GTIN-14 `00845436…` → `gtin14`
   y comprobar `= upc`; Code128 que canoniza a `DD-NNNN[CCC]` → `sku`; patrones de frame/serie; 12–34
   dígitos con contexto FedEx → `tracking`. Todo con tests, como `canonical_sku`.
3. **Una llamada VLM por caja** con todas sus fotos y **esquema estricto**: `labels[]` con `type` A–F,
   `photo_index`, `box_2d`, `layer`; por campo `{value|null, raw_text, anchor_text, legibility:
clear|partial|inferred, box_2d}`; `notes[]` a mano; `context`. Instrucción explícita: _`null` antes que
   un dígito_. Pasar también las barras decodificadas **como hechos verificados** (ConfBench: OCR +
   imagen da mejor confianza) pero pedir los dígitos impresos por separado para poder compararlos.
4. **Reconciliar y validar fuera del modelo** (§3 de `01`): barra válida gana; dígitos VLM ≠ barra ⇒
   baja la confianza de esa foto; checksum, forma canónica, `G.W.−N.W.` por fábrica, serie de hermanas,
   código de fábrica (`7RA1`, `G541`), fusión de caras por FRAME+CARTON, precedencia entre etiquetas
   apiladas. Cada campo sale con `confidence` **derivada de señales**, no la que verbaliza el modelo.
5. **Cruce con maestro con la tabla de Vimaan** (§3.5): 1 coincidencia ⇒ propuesta; 0 ⇒ alta propuesta
   (`register_sku_from_as400`), nunca automática; varias o identidad dudosa ⇒ enseñar candidatos y no
   escribir.
6. **Pantalla de propuesta tipo Validation Flow:** checklist de campos (verde = validado, ámbar = propuesto
   sin validar, gris = falta), **recorte de la evidencia** de cada uno, teclado de corrección, y sólo las
   dos preguntas del piso: **destino** y **«¿es nueva?»** cuando hay stock. Escribir sólo lo validado
   (UPC si estaba vacío, G.W. si cambia), como `01` §4.3.
7. **Bucle de evaluación estilo Robotoff:** guardar cada propuesta, lo que la persona aceptó o corrigió y
   las señales; medir **acierto por campo** y **cobertura a confianza fija** sobre las 13 cajas y las que
   vengan. Umbral de auto-aplicar sólo cuando la curva lo justifique.

**Opcional después:** PaddleOCR.js (PP-OCRv5/v6) como segunda lectura local de las líneas con dígitos
(la idea _Hunter/Mapper_: dos lectores distintos y su desacuerdo como señal), y un Qwen3-VL afinado si
algún día sobra la dependencia del proveedor (Open Prices muestra que un 8B afinado iguala a Gemini 2.5
Flash en su tarea).

---

## 9. Riesgos y huecos de esta investigación

- **Precios de Scandit, PackageX, Vimaan, Zebra, Honeywell y Anyline no son públicos.** No se han
  estimado para no inventar.
- Varias cifras de rendimiento (PackageX 95/99 %, Veryfi 99 %+, Scandit "7x") son **de marketing** sin
  método publicado.
- La función _semantics_ de Scandit y el tipo _ShippingLabel_ sólo constan en **notas de versión**; no se
  probó el SDK.
- No se probó `zxing-wasm` sobre las fotos reales (están fuera del repo por datos personales). Es la
  primera prueba a hacer: cuántas barras de las 15 fotos decodifica, por tipo de etiqueta.
- ConfBench, ExtractConf y GRC son preprints de 2026; sus números son de facturas y documentos, no de
  etiquetas de cartón.
- La compra de la división de Honeywell por Brady estaba anunciada en abril de 2026; no se verificó el
  cierre.

---

## 10. Fuentes

**Scandit**

- About Smart Label Capture (web): https://docs.scandit.com/sdks/web/label-capture/intro/
- Label Definitions (web): https://docs.scandit.com/sdks/web/label-capture/label-definitions/
- Label Definitions (iOS): https://docs.scandit.com/sdks/ios/label-capture/label-definitions/
- Advanced Configurations — Validation Flow, Adaptive Recognition: https://docs.scandit.com/sdks/ios/label-capture/advanced/
- Get Started (web label capture): https://docs.scandit.com/next/sdks/web/label-capture/get-started/
- LabelDefinition API 8.6.0-beta.1: https://docs.scandit.com/data-capture-sdk/android/label-capture/api/label-definition.html
- CustomText API: https://docs.scandit.com/data-capture-sdk/react-native/label-capture/api/custom-text.html
- Adaptive Recognition Settings (web): https://docs.scandit.com/data-capture-sdk/web/label-capture/api/ui/label-capture-adaptive-recognition-settings.html
- Adaptive Recognition Mode (web): https://docs.scandit.com/data-capture-sdk/web/label-capture/api/adaptive-recognition-mode.html
- Release notes Web SDK (8.2.0–8.6.0): https://docs.scandit.com/sdks/web/release-notes/
- AI-Powered Barcode Scanning (OCR Fallback, Smart Barcode Selection): https://docs.scandit.com/sdks/web/ai-powered-barcode-scanning/
- SDK 8 (5 nov 2025): https://www.scandit.com/blog/scandit-releases-sdk-8-0/
- When AI Barcode Scanning Knows It Doesn't Know: https://www.scandit.com/blog/barcode-scanning-ai-knows-it-doesnt-know/
- Producto: https://www.scandit.com/products/smart-label-capture/
- Folleto: https://www.scandit.com/resources/guides/smart-label-capture-product-brochure/
- Scandit Express — Scan Labels: https://docs.scandit.com/hosted/express/configuration/scan-labels/
- MatrixScan Count: https://docs.scandit.com/sdks/capacitor/matrixscan-count/intro/
- Caso Stratix: https://www.scandit.com/resources/case-studies/stratix/
- Precios: https://www.scandit.com/pricing/

**Dynamsoft**

- Tutorial barras + OCR en etiquetas de paquete: https://www.dynamsoft.com/codepool/parcel-scan-barcode-ocr-text.html
- Texto que acompaña a una barra lineal: https://www.dynamsoft.com/blog/insights/ocr-accompanying-text-to-linear-barcode/
- Capture Vision, introducción: https://www.dynamsoft.com/capture-vision/docs/core/introduction/
- TextLineSpecification: https://www.dynamsoft.com/capture-vision/docs/core/parameters/file/auxiliary/textline-specification.html
- GrayscaleTransformationModes: https://www.dynamsoft.com/capture-vision/docs/core/parameters/reference/image-parameter/grayscale-transformation-modes.html
- Multi-frame (CaptureVisionRouter consecutive process): https://www.dynamsoft.com/capture-vision/docs/web/programming/javascript/api-reference/capture-vision-router/multiple-image-processing.html
- Precio Label Recognizer: https://www.dynamsoft.com/label-recognition/ask-for-quote/
- Precio Barcode Reader: https://www.dynamsoft.com/store/dynamsoft-barcode-reader/

**Scanbot / Anyline / Microblink / Cognex / Honeywell**

- Scanbot Text Pattern Scanner (web): https://docs.scanbot.io/web/data-capture-modules/text-pattern-scanner/introduction/
- Scanbot precios: https://scanbot.io/pricing/
- Apryse adquiere Scanbot: https://apryse.com/blog/apryse-acquires-scanbot-and-accusoft
- Anyline logística / última milla: https://anyline.com/use-cases/last-mile-delivery
- Anyline serial number: https://anyline.com/products/serial-number-scanning
- Anyline noticias: https://anyline.com/news
- Anyline precios: https://anyline.com/pricing
- Microblink: https://microblink.com/
- Cognex cmbSDK fin de vida: https://scanbot.io/blog/cmbsdk-migration-guide/
- Cognex OCR: https://www.cognex.com/en/applications/optical-character-recognition
- Honeywell SwiftDecoder: https://automation.honeywell.com/us/en/software/productivity-solutions/vision-solutions
- Venta de Honeywell PSS a Brady: https://www.dcvelocity.com/technology/automatic-data-capture/honeywell-to-sell-off-its-mobile-computers-barcode-scanners-division-for-1-4-billion

**Zebra**

- DataWedge Workflow Input: https://techdocs.zebra.com/datawedge/latest/guide/input/workflow/
- OCR Wedge: https://www.zebra.com/us/en/software/mobile-computer-software/ocrwedge.html
- AI Data Capture SDK: https://techdocs.zebra.com/ai-datacapture/latest/about/
- Text OCR: https://techdocs.zebra.com/ai-datacapture/latest/textocr/

**Receiving y logística con visión**

- PackageX Vision SDK: https://packagex.io/platform/vision-sdk
- PackageX Inventory Receiving: https://packagex.io/solutions/retail/inventory-receiving-software
- PackageX, cómo lee etiquetas de envío: https://packagex.io/blog/how-packagexs-ocr-scans-shipping-labels
- Vimaan, identificación de paquetes entrantes: https://vimaan.ai/resources/application-notes/inbound-parcel-identification-internal-labeling/
- Vimaan receiving: https://vimaan.ai/warehouse-receiving/
- Gather AI drones: https://www.gather.ai/solution/drone-inventory-management
- Dexory: https://www.dexory.com/insights/operate-with-99-9-accuracy-track-your-warehouse-inventory-with-barcodes-and-ai-stock-scanning-robots
- Veryfi etiquetas de envío: https://www.veryfi.com/shipping-labels-ocr-api/
- Veryfi precios: https://www.veryfi.com/pricing/
- Doxis AI.dp (ex-Klippa) etiquetas de envío: https://www.klippa.com/en/ocr/logistics-documents/shipping-labels/
- SER/Doxis adquiere Klippa: https://www.businesswire.com/news/home/20250318748542/en/SER-Group-Acquires-Intelligent-Document-Processing-Innovator-Klippa-to-Enhance-Next-Generation-Smart-Content-Platform

**Abierto**

- zxing-wasm: https://github.com/Sec-ant/zxing-wasm
- barcode-detector (polyfill): https://github.com/Sec-ant/barcode-detector
- zxing-js (modo mantenimiento): https://github.com/zxing-js/library
- BarcodeDetector en caniuse: https://caniuse.com/mdn-api_barcodedetector
- PaddleOCR releases: https://github.com/PaddlePaddle/PaddleOCR/releases
- PaddleOCR.js: https://www.npmjs.com/package/@paddleocr/paddleocr-js
- Florence-2 en transformers.js: https://huggingface.co/posts/Xenova/581079116072653
- Qwen3-VL: https://github.com/qwenlm/qwen3-vl
- Open Prices, 200.000 precios (19 feb 2026): https://blog.openfoodfacts.org/en/news/open-prices-200000-prices-and-beyond
- Open Prices issue #670 (barras junto a Gemini): https://github.com/openfoodfacts/open-prices/issues/670
- Robotoff, predicciones e insights: https://openfoodfacts.github.io/robotoff/explanations/predictions/
- Datature, etiquetas de envío con PaddleOCR (2 abr 2026): https://datature.io/blog/reading-shipping-labels-with-computer-vision-from-paddleocr-to-production-pipeline
- Gemini, cajas delimitadoras (guía): https://github.com/google/skills/blob/main/skills/cloud/gemini-api/references/bounding_box.md
- Gemini API precios: https://ai.google.dev/gemini-api/docs/pricing

**Papers**

- Suh et al., ICIP 2019: https://ieeexplore.ieee.org/document/8803412/
- Dörr et al., 2020: https://arxiv.org/abs/2008.04620
- TRUDI/TITUS, BMVC 2025: https://arxiv.org/abs/2508.02372
- UNIKIE-BENCH, 2026: https://arxiv.org/abs/2602.07038
- KIE-HVQA, NeurIPS 2025: https://arxiv.org/abs/2506.20168
- ConfBench, 2026: https://arxiv.org/abs/2608.01792
- ExtractConf, 2026: https://arxiv.org/abs/2606.24420
- Geometric Risk Control for VLM OCR, 2026: https://arxiv.org/abs/2603.19790
- Revisión CV en logística y almacenes, 2023: https://arxiv.org/abs/2304.06009
- Seitaj & Elangovan, IJAIA 2024: https://aircconline.com/abstract/ijaia/v15n2/15224ijaia04.html
