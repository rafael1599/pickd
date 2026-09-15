# R3 · Reconocimiento de etiquetas en el dispositivo (navegador Android), sep 2026

> Investigación para PickD (PWA React 19 + Vite en Cloudflare Pages, usada desde Chrome y Brave en
> Android). Pregunta: **qué se puede correr hoy en el teléfono o en el navegador** para decodificar
> las barras de una etiqueta de caja y leer su texto, y cómo encaja con lo aprendido en
> `docs/label-recognition/01-lo-aprendido.md` («las barras decodificadas son verdad exacta»).
>
> Fecha: 15 sep 2026. Todo lo de versiones, precios y soporte se comprobó ese día contra
> documentación, código fuente o el registro de npm (URLs en §10). Donde algo es **estimación** o
> **inferencia** lo digo en la misma frase.

---

## 0. Respuesta corta

| Capa                     | Recomendación                                                                                                                                                       | Por qué, en una línea                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Barras**               | `barcode-detector` (ponyfill sobre **zxing-wasm 3.1.x**) siempre, y **`BarcodeDetector` nativo** encima cuando exista; se unen los resultados                       | Gratis, mantenido (release del 10 sep 2026), 0,9 MB de wasm, lee Code 39/128, EAN/UPC y QR de varias barras por imagen; en macOS el nativo aportó lecturas que zxing perdió (en Android está por medir) |
| **Captura para barras**  | Vista en vivo a 1080p–4K + **foto fija de sensor completo** (`ImageCapture.takePhoto()`), decodificada entera **y** en mosaico dentro de un Worker                  | En las fotos reales, bajar a 1280 px (lo que hace hoy `useBarcodeScanner`) perdió **la mitad** de las barras                                                                                            |
| **Validación de barras** | Dígito de control UPC/GTIN; **Code 39 nunca solo**: exige 2 fuentes (QR, texto, otro frame)                                                                         | Code 39 no lleva checksum y un detector nativo devolvió `P1G3` donde el QR decía `P1493`                                                                                                                |
| **OCR**                  | **`ppu-paddle-ocr/web` con PP-OCRv6 tiny** (onnxruntime-web, WASM) en un Worker, cargado sólo en la pantalla de etiqueta                                            | Leyó **44/53 campos** de 8 etiquetas reales contra **20/53** de Tesseract.js v7; ~6 MB de modelo                                                                                                        |
| **Semántica y daño**     | El OCR del teléfono es ayuda inmediata y respaldo offline; **el juez sigue siendo el VLM del servidor** (Gemini, ya en la pila) con barras y líneas OCR como pistas | OCR confunde `O/0`, `I/1`, desordena clave/valor y se rinde con etiquetas rayadas: justo §5 del documento                                                                                               |
| **No usar**              | Tesseract.js, html5-qrcode, Quagga2, `@zxing/library` para trabajo nuevo, VLMs en transformers.js, Prompt API de Chrome, MediaPipe                                  | Precisión baja, abandonados, cientos de MB, o **no existen en Android**                                                                                                                                 |
| **Nativo**               | No ahora. Capacitor + ML Kit es la vía de escape si la web no alcanza                                                                                               | Exige APK y toolchain Android (este Mac no lo tiene); TWA no da acceso a ML Kit                                                                                                                         |
| **Comercial**            | Sólo si el piloto open-source no llega: **STRICH** (barras, €99/mes) o **Scandit Smart Label Capture** (barras + texto + flujo de validación, por cotización)       | Scandit es el único que hace «etiqueta completa» en web listo para usar                                                                                                                                 |

---

## 1. Lo que medí con las fotos reales (hallazgo principal)

Corrí los motores sobre las **15 fotos de etiqueta** de la sesión del 15 sep (14 de las 13 cajas de
§6 + la de `02-3662BL LASER 1.6`; se excluyen dos capturas de pantalla de la app). Las fotos son de
**4000×3000 (12 MP)**, tal como las entrega la cámara. Scripts y resultados en
`scratchpad/research/bench/` (el scratchpad se borra; si interesa conservarlo, mudarlo a una skill).
Nada de la etiqueta de FedEx aparece en este informe.

### 1.1 Las etiquetas traen más barras de las que creíamos

| Tipo                    | Símbolos que hay                                                                                  | Qué codifican (verificado al decodificar)                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A · Taiwan**          | `ITEM` = **Code 39** · UPC = EAN-13 · `FRAME NO` = Code 39 · `CARTON NO` = Code 39 · **QR**       | `ITEM` es **el SKU** (`03-4270BK`). El **QR** es `0023JC-7RA1-G541,WRDH01637,1,SET,A129,A23JC-744,0003` = **código de fábrica, frame, cantidad, unidad, carton, lote, secuencia** |
| **B · GTIN**            | UPC = **Code 128** (no la simbología UPC-A) · GTIN-14 = Code 128 · `SERIAL` = Code 128 (variante) | `845436089331`, `00845436089331`, `G220307348`. **No hay barras del SKU**                                                                                                         |
| **C · ORD/LOT**         | Code 128 pequeño del SKU arriba · Code 128 `ORD+LOT+C/NO` concatenados · `ITEM` · `SERIAL`        | `DB212130028DB212130028050333`, `BUS0622611901`, `U226U03952`                                                                                                                     |
| **D · RETURN TO STOCK** | Ninguno                                                                                           | Sólo texto                                                                                                                                                                        |

Consecuencias directas para el motor:

- **El QR de la A da exacto el código de fábrica** que §3 usa como «segunda lectura de modelo y
  talla» (`7RA1-G541` = Renegade A1, talla 54), además de frame y carton. En la caja 10
  (`03-3850BK`, etiqueta D encima de una A) el QR asomaba y dio `0022JC-5SEQS3-G211,WAKCA0252,…,P1493`:
  Sequel S3, talla 21, frame y carton, **aunque la D tapaba las barras de frame y carton**.
- **La caja 3 (`03-4149BR`, dos caras dañadas)**: la segunda cara dio el Code 39 `03-4149BR`
  **exacto**, el dígito que en la sesión se tuvo que razonar con la serie de hermanas. Y el carton
  `R14` sale en barras de **las dos caras** (en la primera, también en el QR junto al frame
  `WMEI00065`): la prueba de «una sola caja» ya no depende de leer texto.
- **Tipo B no trae el SKU en barras**: la identidad sale del UPC, y hoy sólo ~10 SKUs tienen UPC en
  PickD (§4.1). En B el texto del SKU sigue haciendo falta.

### 1.2 Cuánto se decodifica según la resolución (zxing-wasm 3.1.4)

≈44 símbolos visibles en las 15 fotos (conteo a ojo, incluye dañados). `tryHarder: true`,
`maxNumberOfSymbols: 20`, todas las simbologías. Tiempos en Node salvo donde dice Chrome.

| Entrada                                                                     | Lecturas válidas               | Recall aprox. | Mediana / peor tiempo (M1)                       |
| --------------------------------------------------------------------------- | ------------------------------ | ------------- | ------------------------------------------------ |
| Bajada a **1280 px** (lo que hace hoy `useBarcodeScanner` / `useQRScanner`) | **15**                         | 34 %          | 90 ms / 321 ms                                   |
| Bajada a 1920 px (≈ un frame 1080p)                                         | 24                             | 55 %          | 194 ms / 815 ms                                  |
| **12 MP entera**                                                            | 26                             | 59 %          | 759 ms / 2046 ms (Node) · 591 / 1082 ms (Chrome) |
| 12 MP en mosaico solapado (3×4)                                             | 30                             | 68 %          | 1682 ms / 2877 ms                                |
| **Unión** de todas las pasadas de zxing                                     | **33**                         | 75 %          | —                                                |
| `BarcodeDetector` de Chrome **en macOS** (= Apple Vision), 1920 px          | **36**, de ellas **1 errónea** | 80 %          | 35 ms / 502 ms                                   |
| Unión zxing ∪ Apple Vision (sin la errónea)                                 | **36 correctas**               | 82 %          | —                                                |

Repetido en Chrome headless (imágenes ya orientadas): 1280 → 14, 1920 → 23, 12 MP → 24. Mismo
patrón. **Precisión de zxing: 33/33 correctas**, ningún valor inventado.

**La lectura errónea** es la lección de validación: en la caja 10, el carton en Code 39 está medio
tapado por la etiqueta D y Apple Vision devolvió `P1G3`; el QR de la misma etiqueta dice `P1493`.
Code 39 no tiene dígito de control obligatorio, así que **un Code 39 parcialmente tapado puede dar un
valor bien formado y falso**. Cruzarlo con el QR lo atrapa; STRICH y Dynamsoft resuelven lo mismo
con histéresis multi-frame (§5).

> El `BarcodeDetector` de macOS usa Apple Vision; **en Android usa otro motor** (Google Play
> Services, §2.1). El número de arriba demuestra que un detector de plataforma puede sumar a zxing,
> no dice cuánto suma el de Android. Eso se mide en los teléfonos (§8).

### 1.3 Qué dieron las barras por caja (13 cajas de §6)

| Resultado                                                     | Cajas                                   | Cuántas  |
| ------------------------------------------------------------- | --------------------------------------- | -------- |
| **SKU exacto** por Code 39 `ITEM`                             | 1, 3, 4, 5, 7                           | **5/13** |
| **UPC/GTIN exacto** (con dígito de control)                   | 1, 2, 4 (`PART NO`), 5, 6, 7, 8, 12     | **8/13** |
| Al menos un identificador exacto (SKU o UPC)                  | 1–8, 12                                 | **9/13** |
| Frame/serie exactos (barras o QR)                             | 1, 2, 3, 4, 5, 7, 9, 10                 | 8/13     |
| Barras presentes pero **sin identidad** (hace falta el texto) | 9 (SKU tapado), 10 (sólo QR de fábrica) | 2        |
| **Sin barras**: sólo texto                                    | 11, 13 (y `02-3662BL`)                  | 2 (+1)   |

O sea: **las barras resuelven sin juicio la mayoría de las A**, la mitad de la identidad de las B
(si el UPC está en catálogo), y **nada** de las D. El OCR/VLM sigue siendo necesario, pero con
menos campos por adivinar.

### 1.4 OCR sobre 8 etiquetas (53 campos de verdad de terreno)

Fotos A limpia, A dañada, B con film, C bajo D, D ×3 y B vieja. Campo acertado = aparece literal en
el texto (sin espacios ni puntuación). Imagen de 1920 px, orientada.

| Motor                                                                                      | Campos           | Mediana por foto en Chrome (M1)                                   | Estimación Android gama media\* |
| ------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------- | ------------------------------- |
| **PaddleOCR PP-OCRv6 tiny** (`ppu-paddle-ocr/web` 6.6.0, onnxruntime-web WASM, **1 hilo**) | **44/53 (83 %)** | 2,35 s (peor 4,6 s); init 3,1 s                                   | ~5–7 s                          |
| Ídem con **WASM multihilo** (COOP + COEP `credentialless`)                                 | 44/53            | 1,06 s (peor 1,34 s); init 1,4 s                                  | ~2,5–4 s                        |
| Ídem pidiendo **WebGPU**                                                                   | —                | la sesión **no se creó** (`kernel_registry` de ORT) y cayó a WASM | no contar con ello              |
| **Tesseract.js 7.0.0** (`eng`)                                                             | **20/53 (38 %)** | 0,88 s                                                            | ~2–3 s                          |
| Tesseract.js a 12 MP (Node)                                                                | 13/53            | 2,7–12 s                                                          | —                               |

\* Estimación, no medida: Geekbench 6 mononúcleo M1 ≈ 2304 contra Snapdragon 7s Gen 2 ≈ 1012,
Dimensity 7300 ≈ 1058, Helio G99 ≈ 733 → factor ×2,2–×3,1, más calentamiento. Sobre un **recorte
de la etiqueta** (≈40 % de la foto) el tiempo baja.

Lo que PaddleOCR hizo bien: **leyó el texto blanco sobre caja negra** (`03-4270BK`,
`RENEGADE A1 LTD`, `EARTH CRUISER 3`), las dos columnas de la C (`ORD NO.DB212130028 LOT NO.…`) y
las D completas. Lo que hizo mal es **exactamente la lista de §5 del documento**:

| Error observado            | Ejemplo real                             | Regla que lo arregla                                               |
| -------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `0`↔`O`                    | `WRDHO1637`                              | Barras/QR dan `WRDH01637`; patrón de frame                         |
| `1`↔`I`                    | `M211014353` (es `M21I014353`)           | Nada determinista sin barras → mostrar la duda                     |
| `l`↔`I`                    | `Gloss Biack`, `S1ZE`, `Made ln`         | Catálogo de colores; anclas tolerantes                             |
| Dígito final perdido       | GTIN `0084543608933` (falta un 1)        | Dígito de control GTIN-14 + barras                                 |
| Clave y valor desordenados | `12KGs 1 / N.W. 17KGS / G. W.`           | Asociar por caja geométrica, no por orden; `G.W. − N.W.` constante |
| Etiqueta rayada            | `ENRADE S2`, `COFPER TONE`, `0235OlillA` | Catálogo de modelos + serie de hermanas; y el VLM                  |

**Conclusión de la medición:** PaddleOCR en el teléfono es viable como lector de campos con
validación detrás; Tesseract no. Ninguno sustituye al VLM para daño, etiquetas apiladas y
semántica.

### 1.5 Lo que ya hay en PickD y conviene cambiar

- `src/features/fedex-returns/hooks/useBarcodeScanner.ts` y `src/hooks/useQRScanner.ts`: **bajan la
  foto a 1280 px** («performance on old phones») y el respaldo de `@zxing/browser` devuelve **un solo
  resultado** (lo dice el propio comentario). Para etiquetas de caja: decodificar a resolución completa
  en un Worker y usar `zxing-wasm`, que devuelve todas.
- `QuickCameraModal.tsx` pide `1280×720` y guarda un frame del `<video>`: para etiquetas, pedir más y
  sacar la foto con `ImageCapture.takePhoto()`.
- `@zxing/library` está en **modo mantenimiento** («no active development or roadmap»); `tesseract.js`
  ^6 está en `package.json` y **no se usa** en `src/`.

---

## 2. Barras en el navegador

### 2.1 `BarcodeDetector` (Shape Detection API)

| Punto               | Estado sep 2026                                                                                                                                                                                                          | Fuente                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Plataformas         | **Android, macOS, ChromeOS**. No Windows ni Linux. Firefox y Safari no                                                                                                                                                   | Chrome for Developers, caniuse                                                |
| Chrome Android      | Soportado (caniuse lista Chrome for Android 152)                                                                                                                                                                         | caniuse                                                                       |
| Motor en Android    | **Google Play Services, API legacy Mobile Vision** (`com.google.android.gms.vision.barcode.BarcodeDetector`), no ML Kit. Mobile Vision está deprecada desde 2021                                                         | Código de Chromium `main`; guía de migración de ML Kit                        |
| Formatos en Android | 13: aztec, code_128, code_39, code_93, codabar, data_matrix, ean_13, ean_8, itf, pdf417, qr_code, upc_a, upc_e                                                                                                           | `BarcodeDetectionProviderImpl.java`                                           |
| Requisitos          | Play Services ≥ 19.7.42; si no, **no se crea el detector**                                                                                                                                                               | ídem                                                                          |
| Trampa              | Si el módulo de visión aún se está descargando, `detect()` **devuelve `[]` sin error** (`isOperational() == false`)                                                                                                      | `BarcodeDetectionImpl.java`                                                   |
| Coste               | Cada `detect()` copia el bitmap entero por Mojo y lo convierte a YUV; no hay reescalado                                                                                                                                  | `BitmapUtils.java`                                                            |
| Varias barras       | Sí, devuelve todas las del frame con esquinas                                                                                                                                                                            | ídem                                                                          |
| Workers             | Disponible en Web Workers                                                                                                                                                                                                | MDN                                                                           |
| **Brave Android**   | **Muy probable que funcione**: `brave-core` declara `google_play_services_vision_java` en su build de Android y usa el mismo código de Chromium. **Inferido del código, no probado en un teléfono**                      | `brave-core/build/android/config.gni`                                         |
| Brave: Shields      | La protección de huella **altera `getImageData()`** (farbling de canvas) y reporta un `hardwareConcurrency` aleatorio entre 2 y el real → menos hilos WASM. Para `pickd.pages.dev`, desactivar fingerprinting en Shields | Brave; filtro de tests de brave-core; página de comparación de ppu-paddle-ocr |

Veredicto: **usarlo como capa rápida para la vista en vivo y como segunda opinión**, nunca como
única vía (puede no existir, devolver vacío en silencio, y su motor es el antiguo).

### 2.2 Librerías y SDKs

| Opción                                           | Versión / fecha                             | Licencia · precio                                                                                                                             | Formatos útiles aquí                                                 | Varias barras                                              | Barras dañadas / pequeñas                                                                                                                     | Notas                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **zxing-wasm** (ZXing-C++ en WASM)               | **3.1.4 · 10 sep 2026** (zxing-cpp v3.x)    | MIT/Apache · gratis                                                                                                                           | Code 39/93/128, EAN/UPC, ITF, DataBar, QR, DataMatrix, PDF417, Aztec | Sí (`readBarcodes`, `maxNumberOfSymbols`)                  | Medio. En benchmark de Dynamsoft (vendedor): 82 % enfocadas, **10 % desenfocadas**. En nuestras fotos: 33/33 correctas                        | Reader wasm **0,91 MB**. Barras lineales: tiene que haber 2 líneas horizontales o verticales que las crucen enteras (no 45°). Carga el wasm de jsDelivr por defecto → autoalojar con `prepareZXingModule`                                                             |
| **barcode-detector** (ponyfill/polyfill)         | **3.2.2 · 16 ago 2026**                     | MIT · gratis                                                                                                                                  | Los de zxing-wasm con nombres de la API estándar                     | Sí                                                         | = zxing-wasm                                                                                                                                  | Misma interfaz que `BarcodeDetector`; el polyfill sólo se instala si no hay nativo → usar el **ponyfill** para poder correr los dos                                                                                                                                   |
| `@zxing/library` + `@zxing/browser`              | 0.23.0 (abr 2026) / 0.2.1 (jul 2026)        | Apache/MIT                                                                                                                                    | 1D/2D clásicos                                                       | Limitado (API de un resultado en el camino común)          | Bajo: en la prueba de STRICH no leyó Code 128 finos ni etiquetas degradadas                                                                   | **Modo mantenimiento** declarado en su README                                                                                                                                                                                                                         |
| html5-qrcode                                     | 2.3.8 · **abr 2023**                        | Apache                                                                                                                                        | QR + 1D vía zxing-js                                                 | Poco                                                       | Bajo                                                                                                                                          | Sin releases desde 2023                                                                                                                                                                                                                                               |
| Quagga2                                          | 1.12.1 · dic 2025                           | MIT                                                                                                                                           | **Sólo 1D**                                                          | Sí                                                         | Bajo; **misreads** en la prueba de STRICH                                                                                                     | Sin QR (y el QR de la A vale mucho)                                                                                                                                                                                                                                   |
| **STRICH**                                       | 1.17.0 · 20 ago 2026                        | Comercial · **€99/mes** (10k lecturas), €249/mes (100k), Business desde **€4.000/año** por app (ilimitado, licencia offline) · prueba 14 días | Code 128/39, EAN/UPC, ITF, DataBar, QR, DataMatrix, Aztec, PDF417    | Sí                                                         | Alto según el vendedor (histéresis, `minScanlinesNeeded`, invertidos); en su prueba leyó etiquetas DHL degradadas que ZXing-JS y Quagga no    | WebGL + WASM. Resolución `hd`/`full-hd`; recuerda la cámara. Lecturas medidas (conviene `duplicateInterval`)                                                                                                                                                          |
| **Scanbot Web SDK**                              | 9.0.0 · jul 2026                            | Comercial · **licencia anual plana por dominio**, precio por cotización · prueba 7 días                                                       | 1D/2D completos                                                      | Sí: **Multi-scan con AR overlay**, **Find & Pick**, conteo | Alto (vendedor)                                                                                                                               | También Text Pattern Scanner (una línea con regex). npm 135 MB desempaquetado (varias builds)                                                                                                                                                                         |
| **Dynamsoft Barcode Reader JS** / Capture Vision | DBR 11.6.3200 · 4 sep 2026; bundle 3.6.3200 | Comercial · **desde $1.499/año**, por volumen/dispositivo · prueba 30 días                                                                    | 1D/2D + postales                                                     | Sí («500+ por minuto»)                                     | Alto; filtro **multi-frame de verificación cruzada** y deduplicación                                                                          | **Plantilla `ReadBarcode&AccompanyText`**: OCR anclado a la barra (el texto impreso bajo el Code 39). Label Recognizer para líneas de texto con regex                                                                                                                 |
| **Scandit Web SDK**                              | **8.6.0 · 31 ago 2026** · Chrome 85+        | Comercial · **sólo cotización** (por dispositivo o por lectura)                                                                               | Todos                                                                | **MatrixScan** Batch / AR / Find                           | Alto: en el benchmark de Dynamsoft (vendedor rival) 93 % en Muenster y 61 % en DEAL, siempre por detrás de Dynamsoft y con 100 % de precisión | **Smart Label Capture**: barras + texto en una sola captura, campos con `valueRegex`/`anchorRegex`, opcionales, **Validation Flow** para corregir a mano. 8.6 añade etiqueta de envío en web y un modelo mayor en la nube (Adaptive Recognition) para casos difíciles |

### 2.3 Foto fija o vídeo en vivo

|                                 | Foto fija (12 MP)                                                        | Vídeo en vivo (1080p–4K)                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Resolución por módulo           | Alta: en las fotos de la sesión la etiqueta ocupa ~1800–2300 px de ancho | 1080p: la misma etiqueta ronda los 700–900 px; justo para los Code 39 de frame/carton; 4K mejor                               |
| Tiempo por decodificación       | zxing ≈ 0,6 s en M1 → **~1,5 s estimado en gama media** (entera)         | ≈ 0,2 s por frame 1080p → ~0,5 s estimado                                                                                     |
| Daño y reflejos                 | Una sola oportunidad                                                     | **Muchas oportunidades**: el mantenedor de zxing-cpp nota que una app móvil lee en vivo lo que en una foto «no tiene arreglo» |
| Validación                      | Cruzar con QR/texto                                                      | Votación entre frames (≥2 apariciones para Code 39/128)                                                                       |
| Qué pide ML Kit como referencia | Módulo ≥ 2 px; EAN-13 ≥ 190 px de ancho; 1280×720 o 1920×1080            | ídem                                                                                                                          |

Por eso la pila combina las dos: **vivo** para guiar, dibujar las barras y acumular lecturas;
**foto fija** para el archivo, el OCR y un último barrido completo.

Cámara en Chrome Android: `zoom`, `focusMode`, `pointsOfInterest`, `exposureMode`, `takePhoto()` con
`imageWidth/imageHeight` están implementados (tabla de estado de la W3C); `MediaStreamTrackProcessor`
permite pasar `VideoFrame`s a un Worker. Elegir la lente con `deviceId: {exact}` y **sin**
`facingMode` a la vez: en teléfonos con varias traseras el valor por defecto puede ser la
ultra gran angular o una de foco fijo.

---

## 3. OCR en el navegador

| Opción                                                | Estado sep 2026                                                                                                                      | Descarga                                                                                                                | Velocidad                                                                                          | Precisión en nuestras etiquetas                     | Veredicto                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Tesseract.js**                                      | 7.0.0 · 15 dic 2025 (build `relaxedsimd`, −15–35 % de tiempo sobre v6)                                                               | core wasm 2,7 MB + `eng` 2,95 MB gz                                                                                     | 0,88 s/foto en M1                                                                                  | **20/53**; falla en cajas invertidas, barras y film | No                                                                                                                                |
| **PaddleOCR vía `ppu-paddle-ocr`**                    | **6.6.0 · 13 sep 2026**, **PP-OCRv6** (lanzado jun 2026: tiny 1,5 M, small 7,7 M, medium 34,5 M parámetros, 50 idiomas en un modelo) | tiny: det 1,8 MB + rec 4,3 MB; ORT wasm 13,6 MB (27 MB con WebGPU) sin comprimir; OpenCV.js 12,7 MB si se usa ese motor | 2,35 s (1 hilo) / 1,06 s (multihilo) en M1                                                         | **44/53**                                           | **Sí**                                                                                                                            |
| `@paddleocr/paddleocr-js` (oficial)                   | 0.4.2 · 11 jun 2026; PP-OCRv5/v6; modo Worker                                                                                        | Similar + OpenCV.js                                                                                                     | ppu dice que el oficial es «significativamente más lento» (su propio comparador; no verificado)    | No medido                                           | Alternativa si ppu se abandona                                                                                                    |
| `client-side-ocr`                                     | 2.1.0 · jul 2025, PP-OCRv4, 15–30 MB                                                                                                 | —                                                                                                                       | —                                                                                                  | —                                                   | Desactualizado                                                                                                                    |
| `onnx-ocr-js`                                         | 0.0.6 · oct 2025                                                                                                                     | —                                                                                                                       | —                                                                                                  | —                                                   | Inmaduro                                                                                                                          |
| **transformers.js v4** (feb 2026) con Florence-2-base | Funciona con WebGPU                                                                                                                  | **~210 MB (q4f16) a ~520 MB (fp16)**                                                                                    | No medido; WebGPU en Chrome Android desde la 121 sólo en Android 12+ con Adreno/Mali (ampliándose) | No medido                                           | No para gama media: el tamaño basta para descartarlo                                                                              |
| transformers.js con TrOCR-small-printed               | Reconoce **una línea**; necesita un detector aparte                                                                                  | ~61 MB cuantizado                                                                                                       | —                                                                                                  | —                                                   | No aporta sobre PaddleOCR                                                                                                         |
| Granite-Docling 258M / otros VLM pequeños             | Demos WebGPU                                                                                                                         | ~250–350 MB                                                                                                             | —                                                                                                  | —                                                   | No                                                                                                                                |
| **Prompt API de Chrome (Gemini Nano)**                | Estable desde Chrome 138, imagen desde 148                                                                                           | Modelo del navegador (22 GB libres, >4 GB VRAM)                                                                         | —                                                                                                  | —                                                   | **«Chrome for Android … not yet supported»**                                                                                      |
| `TextDetector` (Shape Detection)                      | Sólo con flag de funciones experimentales                                                                                            | —                                                                                                                       | —                                                                                                  | —                                                   | No                                                                                                                                |
| **MediaPipe Tasks**                                   | `@mediapipe/tasks-vision` 1.0.1                                                                                                      | —                                                                                                                       | —                                                                                                  | —                                                   | **No tiene tarea de OCR**; LLM Inference en **modo sólo mantenimiento**, sustituto LiteRT-LM JS **sin entrada de imagen** todavía |
| Gemini Nano en Android (ML Kit GenAI Prompt API)      | Beta, imagen + texto                                                                                                                 | En el sistema (AICore)                                                                                                  | —                                                                                                  | —                                                   | **Sólo app nativa** y sólo gama alta (Pixel 9–11, Galaxy S26, OnePlus 13/15…); sólo en primer plano, con cuota de batería         |

### 3.1 Cómo correr PaddleOCR en PickD sin romper nada

- **Worker obligatorio**: en el hilo principal la inferencia WASM congela la pestaña (el paquete mete
  pausas de 10 ms para mitigarlo).
- **Hilos**: ORT sólo usa varios hilos si la página está _cross-origin isolated_
  (`COOP: same-origin` + `COEP`). Cloudflare Pages lo permite con `_headers`, pero afecta a toda la
  app (imágenes de R2, Supabase, popups). Opciones: (a) 1 hilo y aceptar ~2× tiempo; (b) aislar sólo
  una ruta de etiqueta a la que se llega con navegación completa, con `COEP: credentialless` (deja
  cargar recursos `no-cors` sin CORP, sin cookies). Mi elección: **(a) en el piloto**, (b) si el
  tiempo molesta.
- **WebGPU apagado por defecto**: en la prueba la sesión WebGPU de ORT 1.30 no se creó con los
  modelos PP-OCRv6 y cayó a WASM. Probarlo luego en los teléfonos, no contar con él.
- **Autoalojar** modelos y wasm en Pages y cachearlos con el Service Worker (por defecto se bajan de
  jsDelivr/Hugging Face en cada carga, sin caché persistente).
- **Recortar la etiqueta** antes de reconocer (las cajas de barras y las líneas detectadas dan el
  rectángulo) y reconocer a ~1600–2000 px de lado largo.

---

## 4. Nativo como referencia, y si una PWA puede usarlo

| Capacidad | ML Kit (Android)                                                                                                                                                                                                                       | Apple (iOS)                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Barras    | Barcode Scanning: 13 formatos; bundled +2,4 MB o vía Play Services +200 KB; **auto-zoom** (sugiere acercar cuando la barra está lejos); «todas las barras potenciales» aunque no se decodifiquen; guía: módulo ≥ 2 px, EAN-13 ≥ 190 px | Vision / VisionKit `DataScannerViewController`: barras **y** texto a la vez, `recognizesMultipleItems`, resaltado y guía integrados |
| Texto     | Text Recognition v2: +260 KB (Play Services) o +4 MB por arquitectura; bloques → líneas → elementos → símbolos con confianza y ángulo; **carácter ≥ 16×16 px**, sin ganancia por encima de 24×24                                       | Vision `VNRecognizeTextRequest`                                                                                                     |
| VLM local | Gemini Nano (beta, gama alta, sólo nativo)                                                                                                                                                                                             | Foundation Models (sólo nativo)                                                                                                     |

**¿Puede la PWA aprovecharlos?**

- **Como PWA pura: no.** Lo único que llega a la web es `BarcodeDetector`, que en Android es la API
  antigua de Play Services, no ML Kit.
- **TWA (Trusted Web Activity): no aporta.** Es Chrome a pantalla completa con las mismas APIs web.
  Desde Chrome 115 hay `postMessage` entre la app y la web, pero lo inicia la app, pasa cadenas y
  exige `PostMessageService`; montar ahí un puente de fotos hacia ML Kit es forzarlo.
- **Capacitor: sí.** WebView + plugins nativos: `@capacitor-mlkit/barcode-scanning` 8.2.1 (10 sep
  2026: varias barras a la vez, área de detección, leer desde imagen, linterna) y
  `@pantrist/capacitor-plugin-ml-kit-text-recognition` 8.1.0 (8 sep 2026). Coste: distribuir APK
  (Play o sideload), mantener dos caminos de despliegue y **compilar desde la PC Windows** (este Mac no
  tiene toolchain Android). Es la vía de escape si el piloto web se queda corto, no el punto de
  partida.

---

## 5. UX de los SDKs líderes que vale la pena copiar

| Función                                 | Quién la tiene                                                                                                    | Cómo sería en PickD                                                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guía de encuadre + «acércate»**       | ML Kit (auto-zoom), VisionKit (guidance), STRICH (región de interés)                                              | Marco con la proporción de una etiqueta. Si la barra UPC mide < ~190 px o una línea de texto < 16 px de alto → «acércate» o subir `zoom` con `applyConstraints`              |
| **Overlay AR de cada barra**            | Scandit MatrixScan AR, Scanbot Multi-scan                                                                         | Recuadro sobre cada barra con color de estado: **verde** checksum ok o confirmada por 2 fuentes; **ámbar** Code 39/128 visto una vez; **rojo** conflicto (`P1G3` vs `P1493`) |
| **Captura multi-frame con votación**    | STRICH (`hysteresisMinCount` = 2, `minScanlinesNeeded` = 2), Dynamsoft (verificación cruzada entre frames)        | Acumular lecturas ~1–2 s; aceptar Code 39/128 sin checksum sólo con ≥2 apariciones; UPC/GTIN con una si pasa el control; deduplicar                                          |
| **Disparo automático de la foto buena** | VisionKit, Scanbot RTU UI                                                                                         | Cuando el set de barras deja de crecer y el frame está nítido → `takePhoto()` a resolución completa                                                                          |
| **Selección de la etiqueta correcta**   | MatrixScan (tocar para elegir), Scanbot **Find & Pick**                                                           | Etiquetas apiladas o FedEx al lado: descartar barras que no encajan en ningún patrón Jamis (tracking) y, si hay dos SKUs, tocar cuál                                         |
| **Modo «buscar»**                       | MatrixScan Find, Scanbot Find & Pick                                                                              | Con un SKU esperado (orden, reposición), iluminar sólo esa barra                                                                                                             |
| **Varias caras por caja**               | (propio)                                                                                                          | Botón «otra cara»; se une por frame/carton del QR, como la caja 3                                                                                                            |
| **Confirmación por campo**              | Scandit **Validation Flow** (campos faltantes, error de validación, entrada manual; `numberOfMandatoryInstances`) | Lista de campos con su fuente (`barras` · `QR` · `OCR` · `IA`). Sólo los ámbar piden un toque; SKU o UPC obligatorio, G.W. opcional; teclado numérico donde toca             |
| **Texto anclado a la barra**            | Dynamsoft `ReadBarcode&AccompanyText`                                                                             | Leer el texto impreso bajo el Code 39 `ITEM` / el UPC con un recorte relativo a la barra: segunda lectura del mismo valor                                                    |
| **Linterna y cámara recordada**         | STRICH (`rememberCameraDeviceId`), html5-qrcode (torch)                                                           | `torch` y `deviceId` en `localStorage`; nunca `facingMode` junto a `deviceId`                                                                                                |
| **Feedback por lectura nueva**          | Todos                                                                                                             | Vibración corta por valor nuevo, no por frame                                                                                                                                |

---

## 6. Pila recomendada y flujo

```
Pantalla «Etiqueta»
 ├─ getUserMedia: deviceId recordado, 1920×1080 ideal (3840×2160 si la cámara lo da),
 │   focusMode continuous, torch opcional
 ├─ Vivo (cada ~150–300 ms, en Worker vía MediaStreamTrackProcessor o requestVideoFrameCallback)
 │   ├─ BarcodeDetector nativo si getSupportedFormats() ⊇ {code_39, code_128, ean_13, qr_code}
 │   ├─ si no, barcode-detector/ponyfill (zxing-wasm) sobre el frame
 │   └─ votación multi-frame → overlay AR + chips de campo
 ├─ Disparo (auto o botón): ImageCapture.takePhoto() a resolución completa
 │   ├─ Worker de barras: nativo + zxing entero + zxing en mosaico → unión
 │   └─ Worker de OCR (lazy): PP-OCRv6 tiny sobre el recorte de la etiqueta → líneas con caja
 ├─ Validación determinista (fuera de todo modelo)
 │   UPC-A/GTIN-14 control y prefijo 845436 · GTIN = 00+UPC · canonical_sku() ·
 │   QR = fábrica,frame,qty,unidad,carton,lote,secuencia · Code 39 exige 2.ª fuente ·
 │   regex + anclas (SIZE, COLOR, N.W., G.W.) · catálogo de modelos/colores · kg→lb
 ├─ Si faltan campos o hay conflicto → servidor: foto + barras + líneas OCR como pistas → VLM
 │   (su salida pasa por la misma validación; las barras validadas mandan)
 └─ Confirmación por campo (sólo ámbar) → propuesta de acción (§4 del documento)
```

Parámetros concretos para empezar:

- zxing: `formats: ['Code39','Code128','EAN13','UPCA','QRCode']`, `tryHarder: true`,
  `maxNumberOfSymbols: 20`; mosaico 3×4 con 50 % de solape en retrato.
- Nativo: los mismos formatos (`code_39`, `code_128`, `ean_13`, `upc_a`, `qr_code`).
- OCR: PP-OCRv6 tiny, estrategia `per-line`, `minimumConfidence` 0.5; WASM 1 hilo en el piloto.
- Presupuesto de descarga de la pantalla (sin comprimir): zxing ~1 MB + ORT ~14 MB + modelos ~6 MB
  (+ OpenCV.js ~13 MB si hace falta). Todo detrás de `import()` dinámico y cacheado por el SW:
  **no toca el bundle del resto de PickD**.

Escalado comercial, si el piloto falla por las barras: **STRICH Basic** (€99/mes, 10k lecturas; el
volumen de cajas de PickD cabe) sustituye a zxing en la capa de barras sin cambiar el resto. Si lo
que falla es el conjunto barras + texto + corrección: pedir cotización de **Scandit Smart Label
Capture**, que hace en web lo que describe este documento (campos con regex y ancla, obligatorios y
opcionales, flujo de validación).

---

## 7. Descartado y por qué

| Descartado                                   | Evidencia                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Tesseract.js                                 | 20/53 campos contra 44/53; peor a 12 MP (13/53). Quitar la dependencia sin uso |
| html5-qrcode                                 | Sin release desde abr 2023                                                     |
| Quagga2                                      | Sólo 1D (pierde el QR); misreads en la prueba de STRICH                        |
| `@zxing/library` para trabajo nuevo          | Modo mantenimiento; API de un resultado; peor que zxing-cpp                    |
| VLMs en transformers.js                      | 60–520 MB y WebGPU no garantizado en gama media                                |
| Prompt API de Chrome                         | No soporta Chrome for Android                                                  |
| MediaPipe                                    | Sin tarea de OCR; LLM Inference en mantenimiento                               |
| TWA para ML Kit                              | Mismas APIs que Chrome; `postMessage` sólo de cadenas iniciado por la app      |
| Bajar la foto a 1280 px antes de decodificar | 15 lecturas contra 26 a 12 MP en las mismas fotos                              |

---

## 8. Qué verificar en los teléfonos antes de construir

Casos con números exactos, para correr en cada teléfono del almacén, en Chrome y en Brave:

1. `await BarcodeDetector.getSupportedFormats()` → debe incluir `code_39`, `code_128`, `ean_13`,
   `qr_code`. Anotar modelo, Android, versión de Play Services. **En Brave con Shields normal y con
   fingerprinting desactivado.**
2. Foto de la caja 1 (`03-4270BK`) a 12 MP: nativo y zxing deben dar `03-4270BK`,
   `0845436092959`/`845436092959`, `WRDH01637` y el QR `0023JC-7RA1-G541,WRDH01637,1,SET,A129,…`.
3. Segunda cara de la caja 3: Code 39 `03-4149BR` (nativo y zxing).
4. Caja 10: el carton del QR es `P1493`; cualquier Code 39 de carton distinto se marca en rojo.
5. Tiempos en el teléfono de gama más baja: zxing sobre 12 MP entera (esperado ~1,5 s), sobre frame
   1080p (~0,5 s); PaddleOCR tiny sobre la etiqueta de la caja 11 (`03-3934MN`, 6/6 campos
   esperados, ~5–7 s a 1 hilo).
6. `ImageCapture.getPhotoCapabilities()`: resolución máxima y si `takePhoto()` congela la vista.
7. Qué `deviceId` trasero enfoca de cerca (etiqueta a 25–40 cm).
8. Memoria: 20 etiquetas seguidas sin recargar (el Worker de OCR se reutiliza, no se recrea).

---

## 9. Decisiones tomadas (con evidencia, para poder tumbarlas)

- **15 sep 2026 · Barras con zxing-wasm + nativo en unión, no uno u otro.** zxing solo: 33 lecturas
  sin errores; Apple Vision solo: 35 buenas + 1 falsa; la unión da 36. En Android el nativo es otro
  motor y no está medido.
- **15 sep 2026 · Resolución completa y mosaico para la foto fija.** 1280 px → 15; 1920 → 24;
  12 MP → 26; unión → 33.
- **15 sep 2026 · Code 39 necesita una segunda fuente.** `P1G3` contra `P1493` en la caja 10.
- **15 sep 2026 · PaddleOCR PP-OCRv6 tiny en el teléfono; Tesseract fuera.** 44/53 contra 20/53 en
  8 etiquetas reales.
- **15 sep 2026 · El OCR local no decide semántica ni daño.** Sus errores (`WRDHO1637`,
  `M211014353`, `COFPER TONE`, pesos desordenados) son los que el VLM + validación resuelven.
- **15 sep 2026 · Sin WebGPU ni aislamiento de origen en el piloto.** WebGPU falló al crear la
  sesión; COOP/COEP afecta a toda la app.
- **15 sep 2026 · Nada nativo por ahora.** Capacitor + ML Kit queda como vía de escape documentada.

---

## 10. Fuentes

Medición propia (scratchpad, 15 sep 2026): `research/bench/` — `zx.mjs`, `zx2.mjs` (zxing-wasm en
Node), `web/entry.js` + `run.mjs` (Chrome 152 headless en Apple M1: zxing, `BarcodeDetector`,
PaddleOCR WASM/WebGPU, Tesseract), `tess.mjs`, `paddle.mjs`, `gt.mjs` (verdad de terreno por campo).

**Shape Detection / Chrome / Brave**

- [Shape Detection API — Chrome for Developers](https://developer.chrome.com/docs/capabilities/shape-detection)
- [Barcode Detection API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API)
- [BarcodeDetector — caniuse](https://caniuse.com/mdn-api_barcodedetector)
- [Chromium `BarcodeDetectionImpl.java` (main)](https://chromium.googlesource.com/chromium/src/+/main/services/shape_detection/android/java/src/org/chromium/shape_detection/BarcodeDetectionImpl.java)
- [Chromium `BarcodeDetectionProviderImpl.java` (main)](https://chromium.googlesource.com/chromium/src/+/main/services/shape_detection/android/java/src/org/chromium/shape_detection/BarcodeDetectionProviderImpl.java)
- [Migrar de Mobile Vision a ML Kit](https://developers.google.com/ml-kit/mobile-vision-migration)
- [brave-core `build/android/config.gni`](https://github.com/brave/brave-core/blob/master/build/android/config.gni)
- [brave-core `test/filters/browser_tests-linux.filter` (farbling de `getImageData`)](https://github.com/brave/brave-core/blob/master/test/filters/browser_tests-linux.filter)
- [Brave — Fingerprinting defenses 2.0](https://brave.com/privacy-updates/4-fingerprinting-defenses-2.0/)
- [MediaStream Image Capture — estado de implementación](https://github.com/w3c/mediacapture-image/blob/main/implementation-status.md)
- [MediaStreamTrackProcessor — caniuse](https://caniuse.com/mdn-api_mediastreamtrackprocessor)
- [Chrome — PostMessage para TWA](https://developer.chrome.com/docs/android/post-message-twa)
- [COEP `credentialless` — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)
- [WebGPU en Android (Chrome 121)](https://developer.chrome.com/blog/new-in-webgpu-121)
- [Prompt API — Chrome for Developers](https://developer.chrome.com/docs/ai/prompt-api)
- [getUserMedia con varias cámaras (Dynamsoft)](https://www.dynamsoft.com/codepool/getusermedia-multiple-camera.html)

**Barras open source**

- [zxing-wasm (README)](https://github.com/Sec-ant/zxing-wasm/blob/main/README.md) · [releases](https://github.com/Sec-ant/zxing-wasm/releases)
- [barcode-detector](https://github.com/Sec-ant/barcode-detector)
- [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) · [preproceso para 1D, discusión #1019](https://github.com/zxing-cpp/zxing-cpp/discussions/1019)
- [@zxing/library (npm, modo mantenimiento)](https://www.npmjs.com/package/@zxing/library)
- [html5-qrcode (npm)](https://www.npmjs.com/package/html5-qrcode) · [Quagga2](https://github.com/ericblade/quagga2)

**Barras comerciales**

- [STRICH](https://strich.io/) · [EngineConfiguration](https://docs.strich.io/reference/interfaces/EngineConfiguration.html) · [FrameSourceConfiguration](https://docs.strich.io/reference/interfaces/FrameSourceConfiguration.html) · [STRICH vs ZXing-JS y Quagga](https://strich.io/strich-compared-to-zxing-js-and-quagga/)
- [Scanbot — casos de uso web (Find & Pick, Multi-scan)](https://docs.scanbot.io/web/barcode-scanner-sdk/barcode-scanner/use-cases/) · [modelo de precios](https://docs.scanbot.io/faq/pricing-and-licensing-model/) · [Text Pattern Scanner web](https://docs.scanbot.io/web/data-capture-modules/text-pattern-scanner/introduction/)
- [Dynamsoft JS SDK](https://www.dynamsoft.com/barcode-reader/sdk-javascript/) · [tienda](https://www.dynamsoft.com/store/dynamsoft-barcode-reader/) · [barras + texto en etiquetas de envío](https://www.dynamsoft.com/codepool/parcel-scan-barcode-ocr-text.html) · [benchmark 1D](https://www.dynamsoft.com/codepool/barcode-scanning-accuracy-benchmark-and-comparison.html) · [guía DBR JS (filtro multi-frame)](https://www.dynamsoft.com/barcode-reader/docs/web/programming/javascript/user-guide/)
- [Scandit Smart Label Capture (web)](https://docs.scandit.com/sdks/web/label-capture/intro/) · [definiciones de etiqueta](https://docs.scandit.com/sdks/web/label-capture/label-definitions/) · [release notes web](https://docs.scandit.com/sdks/web/release-notes/) · [MatrixScan web](https://docs.scandit.com/sdks/web/matrixscan/intro/) · [precios](https://www.scandit.com/pricing/)

**OCR y modelos**

- [Tesseract.js releases](https://github.com/naptha/tesseract.js/releases) · [performance.md](https://github.com/naptha/tesseract.js/blob/master/docs/performance.md)
- [ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr) · [npm](https://www.npmjs.com/package/ppu-paddle-ocr) · [comparador](https://paddle-ocr-comparison.snowfluke.workers.dev/)
- [@paddleocr/paddleocr-js](https://www.npmjs.com/package/@paddleocr/paddleocr-js) · [PaddleOCR.js en el repo oficial](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js)
- [PP-OCRv6 en Hugging Face](https://huggingface.co/blog/PaddlePaddle/pp-ocrv6)
- [client-side-ocr](https://libraries.io/npm/client-side-ocr) · [onnx-ocr-js](https://libraries.io/npm/onnx-ocr-js)
- [transformers.js](https://github.com/huggingface/transformers.js/) · [ejemplo florence2-webgpu](https://github.com/huggingface/transformers.js-examples/tree/main/florence2-webgpu) · [Florence-2-base-ft ONNX (tamaños)](https://huggingface.co/onnx-community/Florence-2-base-ft) · [TrOCR small printed](https://huggingface.co/Xenova/trocr-small-printed)
- [MediaPipe — lista de tareas](https://developers.google.com/edge/mediapipe/solutions/guide) · [LLM Inference web (mantenimiento)](https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/web_js) · [LiteRT-LM Web API](https://developers.google.com/edge/litert-lm/js)
- [Revisión de OCR en dispositivo (Loft Tools, jun 2026)](https://lofttools.com/blog/on-device-ocr-reviewed/)
- [Geekbench 6 mononúcleo, SoC móviles (topcpu, ago 2026)](https://www.topcpu.net/en/soc-r/geekbench-6-single-core)

**Nativo**

- [ML Kit Barcode Scanning (Android)](https://developers.google.com/ml-kit/vision/barcode-scanning/android)
- [ML Kit Text Recognition v2 (Android)](https://developers.google.com/ml-kit/vision/text-recognition/v2/android)
- [ML Kit GenAI (dispositivos, cuotas)](https://developers.google.com/ml-kit/genai) · [Prompt API de ML Kit](https://developers.google.com/ml-kit/genai/prompt/android)
- [@capacitor-mlkit/barcode-scanning](https://github.com/capawesome-team/capacitor-mlkit) · [@pantrist/capacitor-plugin-ml-kit-text-recognition](https://github.com/Pantrist-dev/capacitor-plugin-ml-kit-text-recognition)
- [VisionKit: capturar códigos y texto (WWDC22)](https://developer.apple.com/videos/play/wwdc2022/10025/)
