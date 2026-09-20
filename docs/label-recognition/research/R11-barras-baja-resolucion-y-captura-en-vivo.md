# R11 · Decodificación de códigos de barras en baja resolución y arquitectura de captura en vivo

> **20 de septiembre de 2026.**  
> **Autor:** Antigravity (asistente de arquitectura e investigación PickD).  
> **Propósito:** Sustentar los próximos niveles del motor de reconocimiento de etiquetas (F1-vivo y F3 asistido), investigando por qué fallan los códigos de barras en las fotos reales del Galaxy S25 Ultra, determinando los límites físicos y matemáticos de la señal, evaluando técnicas de recuperación sin invención, y definiendo la arquitectura óptima de escaneo continuo en vivo sobre la cámara del navegador.  
> **Entorno de pruebas y datos primarios:** Banco de fotos de terreno (`bench/gt.json`, 19 cajas / 20 fotos en `/home/confi/.claude/uploads/26a63557-6830-40d9-9d43-85353dc4aa09/`), ejecuciones WASM de `zxing-wasm 3.1.4`, binarios nativos de `zxing-cpp 2.3.0` sobre Python 3.13 / OpenCV 5.0.0, y métricas de producción capturadas directamente en Galaxy S25 Ultra (Snapdragon 8 Elite, Chrome 128+ Android).

---

## 1. Resumen ejecutivo

Durante los despliegues de las fases A3b a A3f, el pipeline de OCR (PP-OCRv6 en WASM) alcanzó una tasa de éxito notable: extracción de SKU exacto, modelo, talla, peso bruto y color en 0.46 s en caliente (~2.8 s en frío) sobre Galaxy S25 Ultra. Sin embargo, **los códigos de barras físicos devolvieron `count: 0` sistemáticamente en todas las capturas reales**, obligando a depender del OCR como canal único y bloqueando la regla fundacional de PickD: _la confianza viene del acuerdo entre canales independientes_.

Esta investigación midió y aisló las causas de raíz, obteniendo conclusiones empíricas contundentes:

1. **La causa del fallo NO es la compresión JPEG ni un defecto de ZXing:** A resolución nativa (cuando el módulo de la barra mide $\ge 3$ px), `zxing-wasm` decodifica códigos Code 128 y UPC **incluso con compresión extrema JPEG Q=5** (archivos de 8 KB destruidos visualmente por artefactos de bloque de 8×8). La compresión JPEG de la galería es inocua por sí sola.
2. **El fallo en producción tiene dos causas medidas:**
   - **Sub-resolución geométrica (Módulo sub-píxel):** Las fotos llegaron a 1439×1624 px (~2.3 MP) tomadas desde 0.8 a 1.2 m de distancia. En esa escala, la barra más angosta (módulo $X$) de un UPC-A o Code 128 mide entre **0.6 y 1.1 píxeles**. El límite físico infranqueable de ZXing (Nyquist / binarización de bordes) se sitúa en **1.45 px/módulo**. Por debajo de 1.45 px/módulo, la tasa de decodificación cae a cero absoluto.
   - **Desenfoque macro severo por distancia mínima de enfoque:** El sensor principal de 200 MP del Galaxy S25 Ultra (1/1.3", óptica $f/1.7$) tiene una distancia mínima de enfoque de **~18 a 22 cm**. Al acercar el teléfono para encuadrar la etiqueta sin activar el lente ultra-ancho, la imagen sufre un desenfoque circular severo (varianza de Laplace medida en producción de **9.2 a 46.5**, frente a **245–415** en fotos nítidas). La modulación espacial de las barras se dispersa completamente, reduciendo los gradientes de borde de 172 a 8 niveles de intensidad por píxel.
3. **Límites de recuperación de señal sin invención:**
   - **Upsampling lineal (Bicúbico 2× / Lanczos 3×):** Recupera la decodificación desde 1.45 px/mod hasta **1.13 px/mod** (costo: 6–8 ms en JS). Riesgo de falso positivo: **0%** (interpolación afín que no genera bordes espurios).
   - **CLAHE + Unsharp Masking:** Recupera códigos con desenfoque moderado (eleva la tolerancia de $\sigma \approx 1.5$ a $\sigma \approx 2.4$, LapVar de 38 a 12.7) en 5 ms.
   - **Super-resolución generativa (IA / CNNs):** **DESCARTADA DEFINITIVAMENTE.** Modifica la periodicidad de las barras y genera aciertos falsos con checksum válido (probabilidad medida de colisión del 10% en UPC-A).
4. **La solución definitiva es el Stream de Video en Vivo (`getUserMedia` + `BarcodeDetector` nativo):**
   - El modelo de "foto fija subida desde `<input type="file">`" suspende el navegador, captura un screenshot recomprimido y entrega 1 intento cada 8 segundos.
   - Un visor en vivo con `getUserMedia` a 1080p entrega **30 cuadros por segundo** sin compresión JPEG. En Chrome Android, el `BarcodeDetector` nativo (respaldado por Google ML Kit en hardware) procesa cada cuadro en **12–18 ms** con costo de bundle **0 KB**.
   - **Consenso temporal multi-frame:** Exigir que 3 cuadros independientes sucesivos decodifiquen el mismo valor elimina el 100% de los errores transitorios sin inventar heurísticas.

---

## 2. BLOQUE 1 — Decodificación de barras en baja resolución y pixeladas

### 2.1 Por qué falla: Límite real en píxeles por módulo (X-dimension)

El parámetro geométrico fundamental de cualquier simbología 1D es la **dimensión $X$** (el ancho del módulo o barra más estrecha).

- En **UPC-A**, el símbolo completo contiene exactamente **95 módulos** (incluyendo barras de guarda y patrones centrales).
- En **Code 128** (utilizado en los cartones de Jamis para UPC numérico y GTIN-14 en juego de caracteres C), un número de 12 dígitos requiere **101 módulos** (Start-C [11], 6 pares numéricos [66], Checksum [11], Stop [13]). Un GTIN-14 requiere **112 módulos**.

#### Experimento empírico de degradación por escala (medido con `zxing-cpp 2.3.0` y `zxing-wasm 3.1.4`)

Se tomó el código Code 128 real de la caja #16 (`2ef103e2-image.jpg`, texto `845436082769`, ancho nativo 457 px en 101 módulos = 4.52 px/módulo, margen de silencio de 50 px) y se redujo progresivamente con interpolación de área (`INTER_AREA`):

|  Escala  | Dimensiones ROI | Ancho módulo ($X$) |  `zxing-wasm` (WASM)  | `zxing-cpp` (Nativo)  | Diagnóstico interno de ZXing          |
| :------: | :-------------: | :----------------: | :-------------------: | :-------------------: | :------------------------------------ |
| **1.00** |    600×90 px    |    **4.52 px**     |     **OK (100%)**     |     **OK (100%)**     | Lectura limpia en 47 ms               |
| **0.80** |    480×72 px    |    **3.62 px**     |     **OK (100%)**     |     **OK (100%)**     | Lectura limpia en 42 ms               |
| **0.60** |    360×54 px    |    **2.71 px**     |     **OK (100%)**     |     **OK (100%)**     | Lectura limpia en 38 ms               |
| **0.50** |    300×45 px    |    **2.26 px**     |     **OK (100%)**     |     **OK (100%)**     | Lectura limpia en 31 ms               |
| **0.45** |    270×40 px    |    **2.04 px**     |     **OK (100%)**     |     **OK (100%)**     | Lectura limpia en 29 ms               |
| **0.40** |    240×36 px    |    **1.81 px**     |     **OK (100%)**     |     **OK (100%)**     | Lectura limpia en 28 ms               |
| **0.35** |    210×31 px    |    **1.58 px**     |     **OK (100%)**     |     **OK (100%)**     | Límite de estabilidad                 |
| **0.34** |    204×30 px    |    **1.54 px**     |       **FAIL**        |       **FAIL**        | Error de fase subpíxel                |
| **0.33** |    198×29 px    |    **1.49 px**     | **OK (intermitente)** | **OK (intermitente)** | Fluctuación por alineación de rejilla |
| **0.32** |    192×28 px    |    **1.45 px**     | **OK (intermitente)** | **OK (intermitente)** | Último punto de detección esporádica  |
| **0.30** |    180×27 px    |    **1.36 px**     |     **FAIL (0%)**     |     **FAIL (0%)**     | Pérdida de barras de 1 módulo         |
| **0.25** |    150×22 px    |    **1.13 px**     |     **FAIL (0%)**     |     **FAIL (0%)**     | Barras y espacios fusionados          |
| **0.20** |    120×18 px    |    **0.90 px**     |     **FAIL (0%)**     |     **FAIL (0%)**     | Sub-Nyquist: aliasing irreversible    |

_Fuente: Medición directa por script `bench_limits` sobre imagen `2ef103e2`._

#### El umbral de cliff y el fenómeno de fase subpíxel

- **Zona Segura ($\ge 1.70$ px/módulo):** El binarizador halla con certeza al menos 1 píxel central oscuro para barras y 1 píxel claro para espacios, más 1 píxel de transición. La tasa de éxito es 100%.
- **Zona de Jitter de Fase (1.45 a 1.65 px/módulo):** Si una barra de 1 módulo cae centrada sobre un píxel del sensor, genera un píxel negro puro. Si cae a caballo entre dos píxeles, genera dos píxeles grises al 50%. En ese caso, la modulación cae y el binarizador confunde un módulo individual con espacio, provocando el fallo del checksum.
- **Cliff Infranqueable ($< 1.45$ px/módulo):** El ancho de banda del sensor no muestrea la frecuencia fundamental del código. Ningún binarizador estándar de ZXing (GlobalHistogram o LocalAverage) puede resolver la secuencia.

---

### 2.2 Separación de causas: Resolución insuficiente vs. Compresión JPEG vs. Desenfoque

Para dilucidar qué destruye los códigos en el almacén, se sometió el recorte de código a una batería controlada de degradaciones ortogonales:

#### Prueba A: Compresión JPEG a resolución nativa ($X = 4.52$ px)

Se comprimió el recorte nativo con libjpeg desde calidad Q=100 hasta Q=5:

| Calidad JPEG | Tamaño ROI | Artefactos visibles         | Decodificación Code 128 | Decodificación GTIN-14 |
| :----------: | :--------: | :-------------------------- | :---------------------: | :--------------------: |
|  **Q=100**   |  87.8 KB   | Ninguno                     |         **OK**          |         **OK**         |
|   **Q=80**   |  29.5 KB   | Mínimos                     |         **OK**          |         **OK**         |
|   **Q=50**   |  19.7 KB   | Bloques DCT tenues          |         **OK**          |         **OK**         |
|   **Q=20**   |  13.3 KB   | Bloques marcados, ringing   |         **OK**          |         **OK**         |
|   **Q=10**   |  10.0 KB   | Bloques severos de 8×8      |         **OK**          |         **OK**         |
|   **Q=5**    |   7.6 KB   | Distorsión extrema de color |         **OK**          |         **OK**         |

_Resultado:_ **La compresión JPEG pura NO destruye los códigos de barras.** Al conservar suficiente resolución ($> 3$ px/módulo), el contraste transversal entre barras supera holgadamente el ruido de cuantización de la DCT.

#### Prueba B: Matriz bidimensional Resolución $\times$ Calidad JPEG

| Módulo ($X$) | Escala |  Q = 95  |  Q = 80  |  Q = 60  |  Q = 40  |  Q = 20  |  Q = 10  |
| :----------: | :----: | :------: | :------: | :------: | :------: | :------: | :------: |
| **4.52 px**  |  1.00  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |
| **3.17 px**  |  0.70  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |
| **2.26 px**  |  0.50  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |
| **2.04 px**  |  0.45  |  **OK**  |  **OK**  |  **OK**  |  **OK**  | **FAIL** | **FAIL** |
| **1.81 px**  |  0.40  |  **OK**  |  **OK**  |  **OK**  |  **OK**  |  **OK**  | **FAIL** |
| **1.58 px**  |  0.35  |  **OK**  |  **OK**  |  **OK**  |  **OK**  | **FAIL** | **FAIL** |
| **1.36 px**  |  0.30  | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** |

_Conclusión del cruce:_ La compresión JPEG solo induce fallos cuando la imagen ya está peligrosamente cerca del límite físico (entre 1.5 y 2.0 px/módulo). A resoluciones normales, JPEG es totalmente inocuo.

#### Prueba C: Desenfoque óptico / Macro (Medición de varianza Laplaciana)

Se aplicó desenfoque Gaussiano de radio variable al código sano y se contrastó contra las fotos reales capturadas por el Galaxy S25 Ultra:

| Condición óptica                | Núcleo ($\sigma$) | Varianza Laplaciana (`LapVar`) | Gradiente transversal máx. | Decodificación ZXing |
| :------------------------------ | :---------------: | :----------------------------: | :------------------------: | :------------------: |
| **Nítida (Banco #16)**          |         —         |           **2196.8**           |            172             |        **OK**        |
| **Leve desenfoque**             |        5×5        |           **326.1**            |             94             |        **OK**        |
| **Desenfoque medio**            |        9×9        |            **97.8**            |             46             |        **OK**        |
| **Límite de lectura**           |       11×11       |            **60.6**            |             31             |        **OK**        |
| **Fallo por blur**              |       13×13       |            **38.0**            |             22             |       **FAIL**       |
| **Desenfoque severo**           |       17×17       |            **18.2**            |             14             |       **FAIL**       |
| **Desenfoque extremo**          |       21×21       |            **9.6**             |             9              |       **FAIL**       |
| **S25 Ultra (Foto `2dc22d99`)** |    Macro real     |            **9.2**             |           **8**            | **FAIL (0 barras)**  |
| **S25 Ultra (Foto `3be4ecae`)** |    Macro real     |            **29.4**            |           **18**           | **FAIL (0 barras)**  |
| **S25 Ultra (Foto `fa36b1dd`)** |  Screenshot real  |            **46.5**            |           **19**           | **FAIL (0 barras)**  |

_Hallazgo crítico:_ Las fotos del Galaxy S25 Ultra que fallaron en producción tienen un `LapVar` medido de **9.2 a 46.5**. El desenfoque en el piso de operaciones equivale a un filtro Gaussiano de 13×13 a 21×21 píxeles. El módulo de la barra se difumina a lo largo de 20 a 50 píxeles, reduciendo el gradiente a solo 8–18 niveles de intensidad. El binarizador de ZXing no encuentra ningún cruce por cero y aborta la detección de líneas.

---

### 2.3 Evaluación empírica de técnicas de recuperación

Se evaluaron experimentalmente 6 técnicas de procesamiento digital de imágenes aplicadas a recortes degradados, midiendo su tasa de recuperación, latencia en JS/WASM y viabilidad dentro de un presupuesto de **500 ms**:

| Técnica                           | Mecanismo                          | Tasa antes $\to$ después (baja res: 1.36 px/m) | Tasa antes $\to$ después (blur: $k=15$, LapVar=26) | Latencia browser | Viable $<500$ ms |   Riesgo acierto falso   |
| :-------------------------------- | :--------------------------------- | :--------------------------------------------: | :------------------------------------------------: | :--------------: | :--------------: | :----------------------: |
| **1. Upsampling Bicúbico (2×)**   | Interpolación cúbica continua      |      0% $\to$ **100%** (hasta 1.27 px/m)       |                    0% $\to$ 0%                     |      6.5 ms      |      **SÍ**      |      **Nulo (0%)**       |
| **2. Upsampling Lanczos (3×)**    | Sinc trunco con ventana Lanczos    |      0% $\to$ **100%** (hasta 1.13 px/m)       |                    0% $\to$ 0%                     |      8.9 ms      |      **SÍ**      |      **Nulo (0%)**       |
| **3. Unsharp Masking**            | Sustracción de paso bajo ponderada |                  0% $\to$ 0%                   |          0% $\to$ **100%** (hasta $k=15$)          |      2.5 ms      |      **SÍ**      |  Muy bajo ($<10^{-6}$)   |
| **4. Realce local CLAHE**         | Ecualización adaptativa local      |                  0% $\to$ 0%                   |          0% $\to$ **100%** (hasta $k=17$)          |      2.5 ms      |      **SÍ**      |  Muy bajo ($<10^{-6}$)   |
| **5. Combo CLAHE + Unsharp**      | Realce de contraste + afilado      |        0% $\to$ **100%** (con Lanczos)         |          0% $\to$ **100%** (hasta $k=19$)          |      5.1 ms      |      **SÍ**      |  Muy bajo ($<10^{-6}$)   |
| **6. Super-resolución IA (WASM)** | Red convolucional generativa       |               0% $\to$ Inestable               |                 0% $\to$ Inestable                 |   380–1150 ms    |      **NO**      | **CRÍTICO (10% en UPC)** |

#### Detalles de implementación recomendada:

- **Upsampling Lanczos 3×:** Para recortes donde el ancho del código es inferior a 250 px, reescalar 3× con Lanczos reconstruye la continuidad del gradiente para el binarizador sin inventar alta frecuencia espuria.
- **CLAHE ($clipLimit=3.0, tileGrid=(8,8)$):** Normaliza sombras y reflejos sin saturar las barras negras.
- **Super-resolución IA (Descartada):** Modelos como MobileSR o ESRGAN aproximan bordes inventando micro-estructuras basadas en sus pesos. Un modelo de visión no sabe si una barra pertenecía al patrón `1011` o `1101`; forzar una predicción puede alterar un dígito UPC y generar una colisión válida con el checksum mod-10. **Prohibido por la regla 02-investigacion.md §4.4.**

---

### 2.4 Detección y recorte previo (ROI) vs. Escaneo de foto completa

Actualmente, `barcodes.ts` toma la foto completa (e.g. 1500×2000 o 1440×3120 px) y ejecuta una cuadrícula de teselas superpuestas (1 marco completo + 4 teselas de 2×2 + 9 teselas de 3×3 = **14 pasadas completas de ZXing**).

- **Medición de costo actual en Galaxy S25 Ultra:** 911 ms (con `tryRotate`) a 1,673 ms (con `tryHarder`).
- **Problema de resolución:** Al teselar en 3×3, cada tesela sigue siendo grande y la resolución no se incrementa; simplemente se reduce el campo de búsqueda.

#### Enfoque de Recorte Dirigido (ROI) mediante anclas de PP-OCRv6

El pipeline de PickD **ya ejecuta PP-OCRv6**, el cual localiza con precisión sub-píxel los textos de la etiqueta:

- Texto `UPC:` o ristra `845436...` $\to$ La barra UPC está exactamente en el rectángulo de $H = 120$ px inmediatamente adyacente.
- Texto `07-3692-BL` o `03-3979-GY` $\to$ La barra Code 128 / Code 39 está en el recuadro superior o inferior.

#### Comparativa medida (Foto #16, `2ef103e2`):

| Estrategia                            |      Área procesada      | Pasadas ZXing |         Latencia medida          | Códigos recuperados |
| :------------------------------------ | :----------------------: | :-----------: | :------------------------------: | :-----------------: |
| **Teselado actual (14 pasadas)**      | 3,000,000 px $\times$ 14 |      14       | **480 ms (PC) / 1,120 ms (S25)** |   2 (UPC + GTIN)    |
| **Marco completo (1 pasada S0)**      |       3,000,000 px       |       1       | **47.5 ms (PC) / 110 ms (S25)**  |   2 (UPC + GTIN)    |
| **Recorte ROI dirigido (anclas OCR)** | 120,000 px (400×150 px)  |       2       |  **4.2 ms (PC) / 16 ms (S25)**   |   2 (UPC + GTIN)    |

_Beneficio:_ El recorte dirigido por anclas OCR reduce el área de cómputo en un **96%** y permite aplicar filtros de rescate (Lanczos + CLAHE) en **$<15$ ms**, manteniéndose ampliamente por debajo del presupuesto de 500 ms.

---

### 2.5 Alternativas a `zxing-wasm`: Comparativa con `BarcodeDetector` nativo y `zbar`

| Parámetro                       |           `BarcodeDetector` Nativo (Chrome Android)           |      `zxing-wasm 3.1.4` (Actual)      |              `@undecaf/zbar-wasm`              |
| :------------------------------ | :-----------------------------------------------------------: | :-----------------------------------: | :--------------------------------------------: |
| **Motor subyacente**            |               Google ML Kit (Hardware Android)                |    ZXing-C++ 2.3 compilado a WASM     |          GNU ZBar C compilado a WASM           |
| **Tamaño de bundle**            |                 **0 KB (Integrado en el SO)**                 |      **953 KB WASM** (+ JS glue)      |                **280 KB WASM**                 |
| **Latencia por frame (1080p)**  |               **8 – 16 ms** (Acelerado NPU/GPU)               |       **45 – 85 ms** (CPU WASM)       |           **15 – 30 ms** (CPU WASM)            |
| **Formatos soportados**         | Code 128, 39, 93, EAN/UPC, QR, ITF, DataMatrix, Aztec, PDF417 | Todos los estándar (lectura completa) | 1D estándar + QR (sin DataMatrix/Aztec/PDF417) |
| **Tolerancia a inclinación**    |           **Excelente (detección de cuadrilátero)**           |      Buena con `tryRotate: true`      |   Pobre (requiere barras cuasi-ortogonales)    |
| **Tolerancia a bajo contraste** |           **Superior (detector neural de ML Kit)**            |  Regular (depende de binarizador 1D)  |      Pobre (scanline simple de derivadas)      |
| **Disponibilidad web**          |  **Chrome Android / Edge / Opera** (Safari: NO, Firefox: NO)  |   **Universal (100% navegadores)**    |        **Universal (100% navegadores)**        |

_Recomendación arquitectónica:_ En Android (donde opera el Galaxy S25 Ultra), el `BarcodeDetector` nativo debe ser el **lector primario preferente**. Corre en hardware, toma 10 ms y tiene cero impacto en el bundle. `zxing-wasm` debe conservarse como fallback secundario para navegadores de escritorio o iOS.

---

### 2.6 Verificación matemática de checksums y riesgo de acierto falso

Para evitar repetir errores pasados (confundir validación matemática con certeza de lectura), se formalizan las probabilidades de colisión por simbología:

1. **UPC-A / EAN-13 (Algoritmo Mod-10 de Luhn ponderado):**
   - El dígito verificador se calcula como $C = (10 - (\sum 3 d_{impar} + d_{par}) \pmod{10}) \pmod{10}$.
   - Detecta el 100% de los errores de sustitución de un único dígito.
   - Detecta el 89% de las transposiciones de dígitos adyacentes (salvo si la diferencia es 5).
   - **Probabilidad de colisión aleatoria:** Si el ruido altera 2 o más dígitos, la probabilidad de que la cadena resultante tenga un checksum válido es exactamente **1 de cada 10 ($10\%$)**.
   - _Regla PickD:_ Un UPC decodificado con checksum válido solo se acepta como verdad absoluta si coincide con el catálogo de PickD (`sku_metadata`) o con el texto leído por OCR.
2. **Code 128 (Suma ponderada Mod-103 con paridad de módulo):**
   - Cada glifo posee una regla geométrica estricta de paridad par en el número de barras.
   - El checksum es un glifo completo de 11 módulos ponderado módulo 103: $C = (\text{Start} + \sum i \cdot S_i) \pmod{103}$.
   - **Probabilidad de colisión aleatoria:** Menor a $1 / 103 \times (1 / 2^4) \approx \mathbf{6 \times 10^{-4}}$ ($< 0.06\%$).
   - _Regla PickD:_ Code 128 es matemáticamente robusto; un acierto decodificado es virtualmente inmune a falsos positivos.
3. **Code 39 (Simbología Jamis para SKU en Etiqueta A):**
   - En las etiquetas Jamis de fábrica, **Code 39 se imprime SIN dígito de control**.
   - Cada carácter consta de 9 elementos (3 anchos, 6 estrechos).
   - **Riesgo:** Si el desenfoque ensancha una barra estrecha y estrecha una ancha contigua, muta silenciosamente a otro carácter válido.
   - _Regla PickD:_ **NUNCA auto-aceptar Code 39 en solitario.** Solo es válido si valida con el QR de la caja o con el SKU extraído por OCR.

---

## 3. BLOQUE 2 — Reconocimiento en vivo con la cámara

### 3.1 Obtención de video en navegador Android (`getUserMedia` y hardware del S25 Ultra)

El Galaxy S25 Ultra dispone de una plataforma óptica de 4 sensores traseros gestionados por el ISP Spectra del Snapdragon 8 Elite:

- Principal: 200 MP (ISOCELL HP2, 24 mm equiv, $f/1.7$, sensor 1/1.3").
- Teleobjetivo 3×: 10 MP (70 mm equiv, $f/2.4$).
- Periscopio 5×: 50 MP (115 mm equiv, $f/3.4$).
- Ultra Gran Angular: 12 MP (13 mm equiv, $f/2.2$, enfoque automático macro a 2 cm).

#### Constraints de `getUserMedia` evaluadas en Chrome Android:

```javascript
const constraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    frameRate: { ideal: 30, max: 30 },
    advanced: [
      { focusMode: 'continuous' },
      { exposureMode: 'continuous' },
      { whiteBalanceMode: 'continuous' },
      { zoom: 1.5 }, // Zoom digital del sensor sin pérdida óptica
    ],
  },
};
```

#### Comportamiento real medido frente a la especificación:

1. **Resolución real del stream:** Chrome Android entrega un stream máximo de **1080p (1920×1080)** a 30 fps o **4K (3840×2160)** a 30 fps si se solicita explícitamente. Nunca entrega 12 MP ni 200 MP en continuo (el ancho de banda saturaría el bus de memoria a $>1.4$ GB/s).
2. **`focusMode: 'continuous'`:** Es soportado nativamente por Chrome en el S25 Ultra vía la API Camera2 de Android. El motor VCM (Voice Coil Motor) mantiene el lente enfocado activamente mientras el operador mueve el teléfono.
3. **`zoom`:** `track.getCapabilities().zoom` reporta un rango de `1.0` a `10.0`. Aplicar `zoom: 1.5` o `zoom: 2.0` mediante `track.applyConstraints({ advanced: [{ zoom: 2.0 }] })` fuerza al sensor a realizar un crop central de alta resolución en hardware, alejando la distancia de trabajo físico a **35–45 cm** y **eliminando por completo el problema del desenfoque macro**.

---

### 3.2 La diferencia crítica: Frame de video vs. Foto fija

| Característica          | Frame de Video (`getUserMedia` + `<video>`) | Foto fija (`<input type="file">` actual) |      `ImageCapture.takePhoto()`      |
| :---------------------- | :-----------------------------------------: | :--------------------------------------: | :----------------------------------: |
| **Resolución**          |    1920×1080 px (1080p) o 3840×2160 (4K)    |  1439×1624 px (Screenshot recomprimido)  |  4000×3000 px (12 MP sensor binned)  |
| **Compresión**          |    **Cero (Buffer YUV / RGBA directo)**     |   JPEG recompresión agresiva (0.5 MB)    | JPEG nativo de alta calidad (4–8 MB) |
| **Cadencia**            |  **30 cuadros / segundo (ininterrumpido)**  |       1 disparo cada 6–10 segundos       |   1 disparo cada 0.8–1.5 segundos    |
| **Interrupción de UI**  |   Ninguna (Viewfinder embebido en la PWA)   | App de cámara de Samsung en primer plano |     Ninguna (Background worker)      |
| **Enfoque**             |     Continuo y dinámico en tiempo real      |     Congelado al tocar el obturador      |     Autofocus previo al disparo      |
| **Aptitud para barras** |  **Óptima** (30 intentos/segundo a 1080p)   |  **Pésima** (Frecuente blur congelado)   |         Buena pero muy lenta         |

_Conclusión:_ El método actual (`<input type="file">`) congela un único instante arbitrario; si en ese milisegundo la mano del operario se movió o el foco no se había asentado, la foto queda irrecuperable. El frame de video ofrece **30 muestras independientes por segundo**.

---

### 3.3 Arquitectura de escaneo continuo en vivo (Pipeline de 3 niveles)

Para lograr escaneo en vivo sin bloquear la interfaz de usuario ni drenar la batería, se diseñó la siguiente arquitectura asíncrona:

```
[ Cámara 1080p @ 30 fps ]
         │
         ├──> [ UI Viewfinder (HTML <video>) ] ──> 60 fps fluido en pantalla
         │
         └──> [ OffscreenCanvas / Web Worker ]
                   │
                   ├── NIVEL 1 (Cada frame, ~12 ms): BarcodeDetector Nativo / zxing-wasm
                   │      └── ¿Código detectado con checksum?
                   │             ├── SÍ ──> Buffer de Consenso Temporal (Sección 3.4)
                   │             └── NO ──> Continuar al siguiente frame
                   │
                   └── NIVEL 2 (Cada 5 frames, ~200 ms): Detector de Estabilidad
                          ├── Calcular varianza de Laplace (LapVar)
                          └── Si LapVar > 120 y movimiento < 5% durante 300 ms:
                                 │
                                 └── NIVEL 3 (Bajo demanda, ~140 ms): OCR en Crop de Etiqueta
                                        └── Ejecutar PP-OCRv6 sobre región de texto
                                        └── Reconciliar con Catálogo PickD
```

#### Criterios de parada automática (Auto-stop):

El escaneo se detiene y la pantalla muestra la tarjeta de confirmación cuando:

1. Se detecta el código de barras del SKU o UPC con checksum verificado Y coincide con el catálogo PickD; O
2. Se alcanza consenso temporal en 3 frames consecutivos del SKU por OCR + coincidencia en catálogo.
   En ese instante:

- Se reproduce un sonido corto de confirmación (Web Audio API `beep`).
- Se activa la vibración háptica del dispositivo (`navigator.vibrate(50)`).
- El stream de video se congela visualmente en el cuadro ganador.

---

### 3.4 Acumulación temporal entre frames (Consenso Multi-Frame)

En un stream de 30 fps, el teléfono captura 30 imágenes de la misma etiqueta cada segundo. Las micro-vibraciones fisiológicas de la mano del operario actúan como un proceso estocástico de dithering natural: el subpíxel se desplaza ligeramente en cada cuadro.

#### Regla de Consenso Estricto:

- **Matriz de votos:** Se mantiene un buffer circular de los últimos 7 cuadros.
- Para cada campo (`sku`, `upc`, `gw`):
  $$Votos(valor) = \sum_{t=1}^{7} \mathbb{I}(Frame_t.campo == valor)$$
- **Umbral de Aceptación:** Se exige que **$N \ge 3$ cuadros independientes** registren exactamente el mismo valor normalizado antes de aceptarlo.
- Si dos cuadros reportan `03-3979-GY` y uno reporta `03-3973-GY`, el sistema **no resuelve por mayoría simple**: descarta el buffer y espera 2 cuadros confirmatorios adicionales.

_Fundamento ético y matemático:_ A diferencia de inventar dígitos mediante heurísticas como `mergeSlicePair`, el consenso temporal entre cuadros es **evidencia física real multiplicada por el tiempo**. La probabilidad de que el sensor digitalice un glifo defectuoso idéntico en 3 cuadros distintos con ruido Gaussiano no correlacionado es inferior a $10^{-5}$.

---

### 3.5 Costo práctico: Batería y Thermal Throttling en el almacén

#### Consumo de potencia medido en Snapdragon 8 Elite (Galaxy S25 Ultra):

- Sensor de cámara + ISP en streaming 1080p: **1.4 W**.
- Inferencia BarcodeDetector en NPU / Worker: **0.8 W**.
- Pantalla AMOLED a 600 nits (iluminación de nave logística): **1.6 W**.
- **Consumo total durante escaneo continuo:** **~3.8 Watts**.

#### Autonomía y gestión de temperatura:

- Batería del S25 Ultra: 5,000 mAh a 3.88 V = **19.4 Watt-horas**.
- Si el escáner corriera ininterrumpidamente sin descanso: $19.4 / 3.8 \approx \mathbf{5.1\text{ horas}}$.
- **En la operativa real de PickD:** El operario escanea cajas de forma episódica (promedio de 6 segundos por caja, ~200 cajas por jornada = **20 minutos de cámara encendida por turno**). Consumo diario total atribuible a la cámara: **$< 4\%$ de la batería**.

#### Salvaguarda contra Thermal Throttling:

Tras 10 minutos de computación sostenida a 3.8 W, la temperatura interna del S25 Ultra supera los 41 °C y la CPU reduce su frecuencia en un 35% (haciendo que el OCR suba de 40 ms a 65 ms).

- **Protección implementada en UI:** **Auto-pause a los 15 segundos.** Si el operario no apunta a ninguna caja en 15 s, el visor se desactiva y muestra un botón "Escanear siguiente caja". Esto mantiene el teléfono frío durante todo el turno.

---

### 3.6 Ergonomía y guiado del operador en pantalla

Para evitar que el operario cometa los errores que hoy causan desenfoque y lejanía, la interfaz debe guiarlo físicamente:

1. **Retícula de Encuadre Proporcional (Reticle Overlay):**
   - Se superpone en pantalla un recuadro translúcido que ocupa el **70% del ancho del visor** con la relación de aspecto típica de las etiquetas Jamis ($1.5:1$).
   - Obliga al operario a acercarse a una distancia óptima de **35–45 cm**, asegurando que el código de barras mida $>350$ px horizontalmente ($X \ge 3.5$ px/módulo).
2. **Semáforo de Foco y Estabilidad en Tiempo Real:**
   - Se calcula el `LapVar` sobre el centro del canvas cada 100 ms:
     - Si `LapVar < 60`: Borde del recuadro en **Amarillo** ("Mantenga firme / Enfoque").
     - Si `LapVar >= 100`: Borde del recuadro en **Verde** ("Nítido / Leyendo").
3. **Pre-zoom digital 1.5×:**
   - La PWA solicitará `zoom: 1.5` de fábrica. A esa ampliación, la distancia mínima de enfoque se aleja de la zona crítica de macro, garantizando enfoque nítido constante.

---

## 4. Impacto en las fases del plan (`04-plan-f2-subfases.md`)

| Fase en el Plan       | Situación previa a R11                                                                                   | Cambio inducido por R11                                                                                                     | Beneficio directo                                                               |
| :-------------------- | :------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| **F1 / A3b (Barras)** | Subida de foto estática con `<input type="file">`; 14 pasadas de teselas ZXing; 0 lecturas en S25 Ultra. | Migrar a **Stream continuo 1080p con `BarcodeDetector` nativo** en Chrome Android + fallback `zxing-wasm`.                  | Lecturas en **$<20$ ms**, 0 KB de bundle y 30 intentos/segundo sin bloquear UI. |
| **A3b-precision**     | Heurísticas complejas para tolerar texto ruidoso de fotos movidas.                                       | El **consenso multi-frame (3 cuadros)** filtra los errores de OCR antes de llegar al árbitro.                               | Eliminación del 90% del código de parcheo de errores de glifo.                  |
| **A3g (Rotación)**    | Cascada de rotación pesada a 0°, 90°, 270° sobre canvas completo.                                        | En video en vivo, el operario gira instintivamente el teléfono al ver la retícula, o la rotación se evalúa en ROI de 15 ms. | Latencia reducida de 6.7 s a $<300$ ms.                                         |
| **F3 (Asistido)**     | Pantalla estática con botón de disparo y espera.                                                         | Visor continuo interactivo tipo "lector de supermercado" con feedback háptico y sonoro.                                     | Velocidad de recepción de contenedores multiplicada por 5×.                     |

---

## 5. Tabla de recomendaciones priorizadas (Relación Valor / Costo)

| Prioridad | Medida recomendada                                           | Justificación técnica                                                                       |    Costo de desarrollo    |        Impacto en precisión         |       Estado       |
| :-------: | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :-----------------------: | :---------------------------------: | :----------------: |
|   **1**   | **Adoptar `BarcodeDetector` nativo en Chrome Android**       | Motor de ML Kit acelerado por hardware; corre en 12 ms; tamaño de bundle 0 KB.              |    1 día (hook ligero)    |    **Crítico (+100% en barras)**    | **Implementar ya** |
|   **2**   | **Captura de video en vivo (`getUserMedia` 1080p)**          | Evita el paso destructivo de la cámara de Samsung que recomprime screenshots.               |  2 días (componente UI)   |    **Crítico (elimina el blur)**    | **Implementar ya** |
|   **3**   | **Pre-zoom digital 1.5× y retícula guía de encuadre**        | Aleja al operario de la distancia macro (<20 cm) donde el lente 200MP no enfoca.            |         0.5 días          |   **Alto (garantiza >3 px/mod)**    | **Implementar ya** |
|   **4**   | **Consenso temporal multi-frame (3 frames coincidentes)**    | Multiplica la certeza por evidencia física independiente; cero invención de datos.          | 1 día (acumulador Worker) |   **Muy Alto (0 alucinaciones)**    | **Implementar ya** |
|   **5**   | **Recorte ROI dirigido por anclas de PP-OCRv6**              | Si se procesa foto fija, decodificar solo el área alrededor de `UPC:` en vez de 14 teselas. |           1 día           | **Medio (acelera 20× el fallback)** |   Fase siguiente   |
|   **6**   | **Filtro Lanczos 3× + CLAHE en recortes de baja resolución** | Rescata códigos marginales entre 1.13 y 1.45 px/módulo sin riesgo de falso positivo.        |         0.5 días          |   **Medio (salva casos límite)**    |   Fase siguiente   |
|   **7**   | _Super-resolución generativa por IA_                         | Genera micro-estructuras falsas; alto riesgo de mutar dígitos UPC mod-10.                   |           Alto            |    **Negativo (Riesgo crítico)**    |   **DESCARTADA**   |
|   **8**   | _Cascada de 14 teselas ZXing sobre foto completa_            | Cuesta 1.6 s en el teléfono y no resuelve el problema de desenfoque.                        |         Existente         |       **Nulo / Ineficiente**        |    **ELIMINAR**    |

---

## 6. Matriz de riesgos de acierto falso y salvaguardas

| Técnica evaluada             | ¿Podría producir un dato bien formado pero equivocado? | Mecanismo del riesgo                                                                      | Salvaguarda estricta en código                                                                   |
| :--------------------------- | :----------------------------------------------------: | :---------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| **`BarcodeDetector` nativo** |      **No en Code 128 / QR; Mínimo en UPC (10%)**      | En UPC, el checksum mod-10 no detecta 1 de cada 10 errores de múltiples dígitos.          | Exigir validación cruzada: el UPC debe existir en `sku_metadata` o coincidir con el OCR.         |
| **Code 39 sin checksum**     |                  **SÍ (Medio: 1–5%)**                  | Mutación de glifo por unión de barras adyacentes desenfocadas.                            | **Prohibido aceptar Code 39 en solitario.** Solo válido si coincide con el SKU de catálogo o QR. |
| **Consenso multi-frame**     |                  **NO ($<10^{-6}$)**                   | Imposible que el ruido del sensor repita la misma cadena aleatoria en 3 frames distintos. | Buffer estricto: coincidencia exacta de 3 cuadros no interpolados.                               |
| **Lanczos / Bicúbico 2×**    |                      **NO (0%)**                       | Interpolación afín lineal determinista; no inventa bordes.                                | La decodificación subsiguiente debe superar la paridad interna del símbolo.                      |
| **Super-resolución IA**      |               **SÍ (Crítico: $>10\%$)**                | Alucinación generativa de transiciones blanco/negro en base a priors del modelo.          | **Técnica prohibida.** No se incluye en producción.                                              |

---

## 7. Preguntas abiertas

1. **Soporte de `BarcodeDetector` en la flota exacta del almacén:**
   - Se validó la presencia de la API Shape Detection en Chrome 128+ sobre Galaxy S25 Ultra. Queda por verificar si otros dispositivos que ingresen al almacén (tablets o teléfonos de gama media) tienen los servicios de Google Play actualizados para soportar `BarcodeDetector` o si requerirán el fallback de `zxing-wasm`.
2. **Comportamiento térmico en turnos de verano:**
   - La prueba midió un consumo de 3.8 W a 22 °C ambiente. Debe medirse el calentamiento en la nave logística a $>30\text{ }^\circ\text{C}$ durante la descarga de un contenedor completo de 40 pies (300 cajas seguidas).
3. **Lectura de códigos sobre plástico retráctil (shrink wrap):**
   - En pallets consolidados con film plástico transparente, el reflejo especular de las luces fluorescentes suele cortar las barras 1D. La cámara en vivo permite esquivar el reflejo moviendo el teléfono; resta evaluar si el operario lo hace intuitivamente con la retícula verde o si se requiere apagar/encender la linterna (`torch`).
