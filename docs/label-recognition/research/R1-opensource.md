# R1 · Estado del arte open-source / pesos abiertos para leer etiquetas de caja (15 sep 2026)

> Ángulo: OCR de texto en escena y extracción clave-valor (KIE) con modelos **abiertos**, aplicados a
> fotos de móvil de etiquetas de caja de Jamis (tipos A–F de `01-lo-aprendido.md`). Todo lo que sigue
> se comprobó en fuentes de septiembre de 2026 (GitHub vía API, model cards de Hugging Face, arXiv,
> leaderboards). Donde un número lo publica el propio autor en un benchmark interno, se dice.
> **Ningún benchmark público mide etiquetas de caja fotografiadas**: toda cifra de aquí es un
> indicio, no una predicción. La verdad la dará medir sobre las 13 cajas de §6.

---

## 0. Resumen en diez líneas

1. El campo cambió mucho desde 2025. En 2026 dominan los **VLM especializados de 0,8–1,2B**
   (PaddleOCR-VL-1.6, GLM-OCR, HunyuanOCR-1.5, MinerU2.5-Pro, OvisOCR2, TeleOCR), que superan a
   modelos generales de 235B en documentos. Pero **casi todos están optimizados para PDF → Markdown**,
   no para «qué número es cuál» en una etiqueta.
2. Sólo tres modelos abiertos traen **KIE con esquema como tarea nativa**: **GLM-OCR** (MIT),
   **HunyuanOCR** (licencia Tencent, válida en EE. UU.) y los VLM generales (**Qwen3.5**, Apache 2.0).
3. En **fotos** (no escaneos) la degradación es real y está medida: 4–10 puntos en
   Wild-OmniDocBench; los pipelines clásicos se hunden con la perspectiva (PP-StructureV3 = 37,98 en
   _skew_ contra 84,68 en escaneo, Real5-OmniDocBench).
4. El **OCR clásico** también se renovó: **PP-OCRv6** (jun 2026, 1,5M–34,5M parámetros, Apache 2.0)
   corre **en el navegador** con SDK oficial (PaddleOCR.js) y con uno comunitario más rápido
   (ppu-paddle-ocr, PP-OCRv6 tiny de ~6 MB). Da texto, cajas y score por línea, pero no semántica.
5. **Supabase Edge Functions no puede alojar ningún modelo útil** (256 MB, 2 s de CPU). Los VLM van en
   un servidor de inferencia (vLLM / llama.cpp, por ejemplo el Mac de Bay 2) o en el navegador vía
   WebGPU (descargas de ~650 MB para un VLM de 0,8–0,9B en q4).
6. Descartados por licencia para uso comercial: **LayoutLMv3** (CC BY-NC-SA), **Qwen2.5-VL-3B** y
   **Nanonets-OCR2-3B** (licencia de investigación de Qwen), **Surya 2 / Chandra 2** (gratis sólo
   por debajo de 5 M / 2 M USD de facturación o financiación).
7. Descartados por abandono: **EasyOCR** (última release sep 2024) y **MMOCR** (jul 2023).
8. Funcionalidades que vale la pena copiar aunque no se use el modelo: clasificador de orientación
   de página y de línea, rectificación (UVDoc), **esquema JSON en el prompt + decodificación
   restringida con `null` permitido**, evidencia por campo (bbox o polígono), _whitelist_ de
   caracteres por campo, confianza por _logprobs_ (y darle al VLM **imagen + texto OCR**, que según
   ConfBench mejora exactitud y calibración), y un banco de «dígitos corruptos» al estilo CHAOS-Bench
   para cazar autocorrecciones.
9. **Top 3** (§8): Qwen3.5-4B/9B como lector estructurado principal · GLM-OCR 0.9B como segundo
   lector y árbitro de dígitos (HunyuanOCR-1.5 en la misma prueba A/B) · PP-OCRv6 +
   orientación + zxing-wasm en la PWA como capa local.
10. Ninguno sustituye la **validación determinista** del §3 del documento de partida. Los modelos
    abiertos pequeños no razonan como un modelo de frontera («20.?0 → la resta da 3,90»), y eso
    ya vive fuera del modelo por diseño.

---

## 1. Qué exige nuestro caso (criterios de evaluación)

Sacado de `01-lo-aprendido.md` y convertido en requisitos medibles:

| #   | Requisito                                                                                                     | Por qué (caso real)                     |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| C1  | **KIE con esquema fijo**: SKU, UPC, GTIN, modelo, talla, color, N.W., G.W., frame/serie, PO, carton, MK, lote | Un OCR devuelve 8–10 números sin nombre |
| C2  | **`null` antes que un dígito inventado**, con confianza y evidencia por campo                                 | El riesgo propio de la IA (§5)          |
| C3  | Robustez a **foto**: perspectiva, cartón curvo, film con brillo, poca luz, desenfoque                         | Todas las fotos de la sesión            |
| C4  | **Texto blanco sobre negro** (cajas de SKU/MODEL invertidas) y tipografía térmica condensada                  | Tipos A y B                             |
| C5  | Asociar clave↔valor **por disposición** (dos columnas, valor corrido)                                         | 03-3850BK: `13 KGS` encima de `N.W.`    |
| C6  | **Varias fotos por caja** (dos caras dañadas), etiquetas apiladas                                             | 03-4149BR, 03-3925BK                    |
| C7  | Códigos de barras **exactos** cuando la barra está sana                                                       | UPC, Code 128 del SKU, serie            |
| C8  | Corre donde vive PickD: PWA Android (Chrome), Cloudflare Pages, Supabase (Postgres + Edge Deno)               | Stack actual                            |
| C9  | Licencia apta para uso comercial de un almacén de EE. UU.                                                     | Jamis es empresa, no startup            |
| C10 | Mantenimiento vivo en 2026                                                                                    | No heredar un proyecto muerto           |

Los benchmarks públicos cubren bien C3 y C5 en _documentos_, algo de C4 (_scene text_) y casi nada
de C2 y C6. Por eso §3 separa lo que cada benchmark dice de verdad.

---

## 2. Mapa del terreno en septiembre de 2026

Tres familias, con fronteras borrosas:

- **A · OCR clásico ligero** (detección DB + reconocimiento CTC/atención): PP-OCRv6, RapidOCR, docTR/OnnxTR,
  Tesseract, EasyOCR, MMOCR. Rápidos, deterministas, corren en CPU/navegador, dan cajas y scores.
  No saben qué es cada número.
- **B · VLM especializados en OCR/documento** (0,26–5B): PaddleOCR-VL-1.5/1.6, GLM-OCR, HunyuanOCR-1.5,
  MinerU2.5-Pro, OvisOCR2, TeleOCR, dots.mocr, DeepSeek-OCR 2, LightOnOCR-2, Chandra 2, Surya 2, olmOCR 2,
  Nanonets-OCR2, GOT-OCR2.0, Granite-Docling. La mayoría: página → Markdown/HTML. Unos pocos: KIE y _spotting_.
- **C · VLM generales** que leen bien: Qwen3.5 (0,8–9B y mayores), Qwen3-VL, Qwen3.6/3.8-27B, Gemma 4,
  InternVL3.5, MiniCPM-V 4.5, Florence-2. Siguen instrucciones largas, admiten varias imágenes y
  _grounding_. Más caros por token.
- **Legado OCR-free / layout**: Donut (2022), LayoutLMv3 (2022). Superados.

---

## 3. Benchmarks: qué miden y cuánto sirven para fotos de etiquetas

| Benchmark                                            | Qué mide                                                                                                                           | ¿Fotos?                                          | Relevancia para nosotros                                                                                                   | Resultados abiertos destacados                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OmniDocBench v1.6** (1.651 páginas PDF, 10 tipos)  | Parsing de página: texto, tablas, fórmulas, orden                                                                                  | **No** («no incluye imágenes de escena natural») | Baja: mide PDF→Markdown                                                                                                    | TeleOCR 96,91 · OvisOCR2 96,47 · PaddleOCR-VL-1.6 96,34 · MinerU2.5-Pro 95,75 · GLM-OCR 95,22 (leaderboard, act. 11 sep 2026)                                                                                                                               |
| **Real5-OmniDocBench** (mar 2026)                    | Las 1.355 páginas de v1.5 **refotografiadas** en 5 condiciones: escaneo, curvatura, foto de pantalla, iluminación, **perspectiva** | **Sí**, reconstrucción física 1:1                | **Media-alta**: aísla qué factor rompe a quién                                                                             | PaddleOCR-VL-1.5 **92,05** (skew 91,66) · Gemini-3 Pro 89,24 · Qwen3-VL-235B 88,90 (skew 86,56) · **PP-StructureV3 64,45 (skew 37,98)** · OvisOCR2 92,29 (su card)                                                                                          |
| **Wild-OmniDocBench** (Tencent, may 2026)            | Documentos capturados con cámara                                                                                                   | **Sí**                                           | Media-alta                                                                                                                 | TeleOCR 88,53 · OvisOCR2 87,91 · PaddleOCR-VL-1.6 87,36 · MinerU2.5-Pro 87,33 · **GLM-OCR 85,08** · dots.ocr 81,84 (tabla del paper de TeleOCR: 4,7–10,1 pts menos que en digital)                                                                          |
| **OCRBench v2** (ronda 2026.06)                      | 23 subtareas: reconocimiento, _spotting_/localización, extracción de relaciones, parsing, razonamiento; incluye escena             | Parcial                                          | **Alta en localización**: «la mayoría de LMM sacan menos de 50»; _spotting_ es el punto débil                              | Open EN: Nemotron 3 Nano 30B 65,8 · Qwen3.6-35B-A3B 65,5 (recog 74,9 / spotting 58,9) · ZH: Qwen3.5-9B 64,1                                                                                                                                                 |
| **OCRBench (v1)**                                    | 1.000 preguntas de lectura, incluye escena y KIE                                                                                   | Parcial                                          | Media (saturándose)                                                                                                        | Qwen3.5-9B 89,2 · 2B 85,4 · 4B 85,0 · 0.8B 79,1 · Qwen3-VL-2B 858/1000 · HunyuanOCR 860 · **DeepSeek-OCR 430**                                                                                                                                              |
| **CC-OCR**                                           | 4 pistas: texto multi-escena, multilingüe, parsing, **KIE**; 41 % de imágenes de aplicaciones reales                               | Sí (parcial)                                     | **Alta**: tiene KIE y escena                                                                                               | Qwen3-VL-235B 0,822 (KIE 95,1) · Qwen3.5-9B 79,3 · 4B 76,7 · 2B 75,8 · 0.8B 66,7                                                                                                                                                                            |
| **KIE clásicos SROIE / CORD / FUNSD**                | Recibos y formularios **escaneados**                                                                                               | No                                               | Baja: saturados, de la era LayoutLMv3/Donut; no encontré cifras 2026 de modelos abiertos pequeños. CC-OCR-KIE es el relevo | —                                                                                                                                                                                                                                                           |
| **Nanonets-KIE / Handwritten-KIE** (IDP Leaderboard) | Campos de facturas, formularios                                                                                                    | Mayormente escaneo                               | Media                                                                                                                      | GLM-OCR 93,7 / 86,1 (su card)                                                                                                                                                                                                                               |
| **IDP Leaderboard v1.5**                             | OCR, KIE, VQA, tablas, clasificación                                                                                               | Mixto                                            | Media                                                                                                                      | Nanonets OCR-3 (**sólo API**) 85,9 · Qwen3-VL-235B 79,6 · **Qwen3.5-9B 76,7** · GLM-OCR 64,2 · Gemma-4-E4B 53,9                                                                                                                                             |
| **HunyuanOCR in-house** (spotting e IE)              | Spotting en 9 escenarios; IE en **tarjetas y tickets**                                                                             | **Sí**                                           | **Alta** (lo más cercano a etiquetas), pero es interno del autor                                                           | Spotting: HunyuanOCR 70,92 (escena 64,56) vs PaddleOCR 53,38 (escena 44,68), Qwen3-VL-2B 29,68 · IE tarjetas/tickets: HunyuanOCR **92,29/92,53** vs Qwen3-VL-2B 67,62/64,62, Qwen3-VL-235B 75,59/78,4, PP-ChatOCR 57,02/50,26, **DeepSeek-OCR 10,04/40,54** |
| **Union14M** (scene text recognition)                | Recortes de palabra en escena: curvas, ocluidas, baja resolución                                                                   | Sí                                               | Media (recortes, no páginas)                                                                                               | MNSP (CVPR 2026 Findings) 86,2 % en Union14M, 96,7 % en 6 sets estándar; sólo código de investigación                                                                                                                                                       |
| **IndustryBench-MIPU** (jun 2026)                    | Atributos de productos industriales (**placas de características**, tablas) con **varias imágenes**                                | Sí                                               | **Alta para C6**                                                                                                           | Precisión por imagen 86–94 %, pero recuperar el producto completo llega a 49,9 %; pasar a multi-imagen cuesta **15–34 pts de recall**                                                                                                                       |
| **ConfBench** (AWS, ago 2026)                        | Calibración de la confianza de VLM en extracción                                                                                   | Documentos                                       | **Alta para C2**                                                                                                           | Qwen3.6-27B verbalizada AUROC 0,72 / ECE 0,22 (logprobs 0,62); Gemma 3-12B al revés (logprobs 0,64 > verbalizada 0,58); **dar OCR + imagen** mejora exactitud y confianza en todos                                                                          |
| **CHAOS-Bench** (Tencent, jul 2026)                  | Alucinación a nivel de carácter: se inyectan letras corruptas y se mira si el modelo **autocorrige**                               | Páginas                                          | **Alta para C2** como diseño de prueba                                                                                     | Diagnóstico, sin ranking útil aquí                                                                                                                                                                                                                          |
| **UNIKIE-BENCH** (feb 2026)                          | KIE con esquemas variados y abiertos                                                                                               | Mixto                                            | Media                                                                                                                      | Degradación con esquemas diversos, claves de cola larga y _grounding_                                                                                                                                                                                       |
| **olmOCR-bench**                                     | PDF → texto con tests unitarios                                                                                                    | No                                               | Baja                                                                                                                       | Chandra 2 85,8 · dots.mocr 83,9 · Surya 2 83,3 · LightOnOCR-2 83,2 · olmOCR 2 82,4 · DeepSeek-OCR 2 76,3 · GLM-OCR 75,2                                                                                                                                     |

**Lecturas que importan para PickD:**

- **La perspectiva mata a los pipelines de cajas rectangulares.** En Real5, PP-StructureV3 (detector +
  reconocedor + layout) cae a 37,98 en perspectiva; los VLM de extremo a extremo aguantan (≈86–92).
  TeleOCR lo dice explícito: «solo eliminar la distorsión geométrica mejora sustancialmente a los
  modelos de dos etapas». **Rectificar antes de un OCR clásico no es opcional.**
- **La localización (bbox) es el punto débil de los VLM generales** (OCRBench v2, _spotting_ de
  Qwen3-VL-2B = 29,68). Si queremos «evidencia por campo» con coordenadas, o se usa un modelo que
  haga _spotting_ bien (HunyuanOCR, PaddleOCR-VL-1.5), o se cruza el valor del VLM con las cajas del OCR clásico.
- **KIE en tarjetas y tickets** (lo más parecido a etiquetas) separa mucho a los modelos: un OCR→Markdown
  como DeepSeek-OCR saca 10 % en tarjetas. **Parsear bien un PDF no predice extraer bien un campo.**
- **Multi-imagen es el cuello de botella** (IndustryBench-MIPU). Mejor extraer por foto y **fusionar
  en código** por `frame`/`carton`, como se hizo a mano con 03-4149BR.

---

## 4. Fichas por candidato

Formato: **qué hace · precisión · tamaño/latencia · dónde corre · licencia · madurez · robustez a
nuestros casos · veredicto**. «Veredicto» dice si es **reutilizable tal cual**, **fuente de
funcionalidades a copiar** o **descartado**.

### 4.A OCR clásico

#### PP-OCRv6 · PaddleOCR 3.7 (11 jun 2026)

- **Qué hace:** detección + reconocimiento de líneas en 50 idiomas (un solo modelo multilingüe); en el
  pipeline de PaddleOCR 3.x, opcionales `use_doc_orientation_classify` (PP-LCNet, 0/90/180/270°),
  `use_doc_unwarping` (UVDoc) y `use_textline_orientation` (PP-LCNet, 0/180°). Salida: `rec_text` +
  `rec_score` **por línea** + polígono.
- **Precisión (benchmark interno de Baidu):** medium det Hmean 86,2 / rec 83,2 (+4,6 / +5,1 sobre PP-OCRv5_server);
  small 84,1/81,3; tiny 80,6/73,5. Reconocimiento medium por escenario: inglés impreso 94,1 · texto de tarjeta 88,1 ·
  pantalla 82,5 · **industrial 77,4**. Detección tiny: rotación 91,0 · **industrial 62,0**. Afirma
  superar a Qwen3-VL-235B (74,9) y GPT-5.5 (64,2) en su media ponderada, y la tabla es suya.
- **Tamaño/latencia:** tiny 1,5M (det 0,43M + rec 1,1M) · small 7,7M · medium 34,5M. «5,2× speedup en
  CPU (OpenVINO), 6,1× en Apple M4 (tiny), 0,13 s en A100». En ppu-paddle-ocr (M1, Bun) un ticket
  completo tarda **~140 ms** con tiny (99,48 % de caracteres). Descarga: tiny ~6 MB, small ~30 MB, medium ~139 MB.
- **Dónde corre:** CPU, GPU, móvil, **navegador** (ONNX oficial en HF: `PaddlePaddle/PP-OCRv6_*_onnx`).
- **Licencia:** Apache 2.0. **Madurez:** PaddleOCR 89,6k ★, push 22 jul 2026, releases mensuales.
- **Robustez:** mejora declarada en «pantallas digitales, matriz de puntos, impresiones de neumático,
  texto industrial», que es lo más cercano a impresión térmica. Texto invertido y film: **no documentado**,
  hay que probarlo. Perspectiva fuerte: sin UVDoc/rectificación, se degrada (lección de Real5).
- **Veredicto:** **reutilizable tal cual** como capa local (texto + cajas + score, guía de captura,
  segunda lectura de dígitos). No sirve como KIE.
- Fuentes: https://huggingface.co/blog/PaddlePaddle/pp-ocrv6 · https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec ·
  https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det · https://github.com/PaddlePaddle/PaddleOCR ·
  https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md

#### PaddleOCR.js (`@paddleocr/paddleocr-js` 0.4.2, 11 jun 2026) y ppu-paddle-ocr (6.6.0, 13 sep 2026)

- **PaddleOCR.js (oficial, Apache 2.0):** SDK de navegador sobre ONNX Runtime Web + OpenCV.js, backend
  `auto` (WebGPU/WASM). `ocrVersion: "PP-OCRv6"` usa el par _small_; _tiny_ por nombre explícito.
  WASM con hilos o WebGPU exige cabeceras **COOP/COEP** (configurables en Cloudflare Pages con `_headers`).
- **ppu-paddle-ocr (MIT, comunidad):** TypeScript para Node, Bun, **Deno**, navegador, Web Worker,
  React Native. PP-OCRv6 tiny por defecto, WebGPU con _fallback_ a WASM («2–5× más rápido»), INT8,
  estrategias por línea. Deja fuera a propósito la orientación y la rectificación: las ofrece
  `ppu-doc-correction` (orientación de página, UVDoc, orientación de línea) como servicios aparte.
- **WebGPU en Android:** activo por defecto desde Chrome 121 en Android 12+ con GPU Qualcomm/ARM.
- **Veredicto:** **reutilizable tal cual**. ppu-paddle-ocr es más completo para una PWA (Worker, Deno)
  pero lo mantiene una sola empresa (134 ★). PaddleOCR.js es el oficial.
- Fuentes: https://www.npmjs.com/package/@paddleocr/paddleocr-js · https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr ·
  https://developer.chrome.com/blog/new-in-webgpu-121

#### RapidOCR 3.9.2 (21 jul 2026)

- Empaqueta los modelos de PaddleOCR en ONNX/OpenVINO/MNN/TensorRT/PyTorch con bindings Python, C++,
  Java y C#. Desde 3.9.0 usa **PP-OCRv6 small** por defecto; 3.8.0 añadió el clasificador PP-OCRv5 `cls`.
  Lo usan Docling y LangChain.
- **Licencia:** Apache 2.0. **Madurez:** 7,8k ★, push 15 sep 2026.
- **Veredicto:** **reutilizable** si se hace OCR clásico en servidor Python (p. ej. junto al VLM). En
  navegador no aporta sobre PaddleOCR.js.
- Fuente: https://github.com/RapidAI/RapidOCR/releases

#### docTR 1.1.0 (21 ago 2026) · OnnxTR

- Detección (DBNet, LinkNet, FAST) + reconocimiento (CRNN, SAR, MASTER, ViTSTR, **PARSeq**, VIPTR);
  cajas rotadas o `straighten_pages`; **confianza por palabra**; desde 1.1: layout (LW-DETR), tablas,
  orden de lectura y **vocab whitelisting** (limitar el alfabeto del reconocedor). Su «KIE predictor» es
  un detector **multiclase que hay que entrenar**, no KIE semántico.
- **Licencia:** Apache 2.0. **Madurez:** lo mantiene t2k GmbH (Mindee lo soltó), 6,3k ★, push 15 sep 2026;
  PyTorch (TF retirado). OnnxTR (Apache 2.0, push 15 sep 2026) es la variante ONNX.
- **Veredicto:** **fuente de funcionalidades** (whitelist por campo, confianza por palabra,
  _straighten_). No mejora a PP-OCRv6 en nuestro caso.
- Fuentes: https://github.com/mindee/doctr/releases/tag/v1.1.0 · https://github.com/felixdittrich92/OnnxTR

#### Tesseract 5.5.3 (24 jul 2026) · tesseract.js 7.0.0 (dic 2025)

- Vivo y con **confianza por símbolo** y whitelist, pero pensado para escaneo limpio. En foto con
  perspectiva o texto invertido rinde mal sin preprocesado.
- **Veredicto:** sólo **línea base** para el set de evaluación.

#### EasyOCR (Apache 2.0) · MMOCR (Apache 2.0)

- EasyOCR: última release **v1.7.2, 24 sep 2024**. MMOCR: **v1.0.1, 4 jul 2023**, último push nov 2024.
- **Veredicto:** **descartados** por falta de mantenimiento, y PP-OCRv6 los supera.

### 4.B VLM especializados en OCR/documento

#### PaddleOCR-VL 1.5 (29 ene 2026) / 1.6 (28 may 2026)

- **Qué hace:** VLM de 0,9B (encoder NaViT + ERNIE-0.3B) con tareas OCR, tabla, fórmula, gráfico, **text
  spotting** (localización + reconocimiento de línea) y **sellos**. Salida Markdown/JSON con coordenadas; en 1.5,
  **polígonos irregulares** vía PP-DocLayoutV3 para páginas torcidas o curvas.
- **Precisión:** OmniDocBench v1.5 94,5 (1.5) · v1.6 96,34 (1.6) · **Real5-OmniDocBench 92,05, mejor del
  benchmark** (skew 91,66, pantalla 91,76, iluminación 92,16) · Wild-OmniDocBench 87,36 (1.6).
- **Tamaño/latencia:** 0,9B; vLLM/SGLang, Transformers ≥5, **llama.cpp (GGUF)**, CPU «con rendimiento
  reducido». ONNX de la comunidad (`onnx-community/PaddleOCR-VL-1.5-ONNX`, decoder q4 234 MB + visión q4 231 MB + embedding 424 MB).
- **Licencia:** Apache 2.0. **Madurez:** alta (equipo Paddle, releases cada 2–4 meses).
- **Robustez:** la mejor evidencia pública en foto. **No trae KIE con esquema** (PP-ChatOCRv4 lo resuelve
  con un LLM encima).
- **Veredicto:** **reutilizable** como lector de _spotting_ robusto en foto (texto + polígono), si
  GLM-OCR o Qwen no dan buena evidencia de posición. No es la primera opción para decir «qué número es cuál».
- Fuentes: https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5 · https://arxiv.org/abs/2601.21957 ·
  https://arxiv.org/abs/2603.04205

#### PP-StructureV3 / PP-ChatOCRv4 (PaddleOCR 3.x)

- PP-StructureV3: pipeline modular de layout + OCR + tablas. Frágil en foto (Real5 64,45; skew 37,98).
- PP-ChatOCRv4: KIE = PP-Structure + recuperación + **LLM** (ERNIE 4.5) + VLM PP-DocBee2 + **fusión de
  resultados**. 85,55 % Recall@1 en 638 documentos internos, contra Qwen2.5-VL-72B 80,26 %.
- **Veredicto:** **copiar el patrón** (texto OCR + VLM + fusión), no el pipeline, que depende de ERNIE.
- Fuentes: https://arxiv.org/abs/2507.05595 · http://www.paddleocr.ai/main/en/version3.x/algorithm/PP-ChatOCRv4/PP-ChatOCRv4.html

#### GLM-OCR (Zhipu/Z.ai · pesos feb 2026, paper mar 2026)

- **Qué hace:** 0,9B (CogViT 0,4B + GLM 0,5B), Multi-Token Prediction. **Dos modos:** parsing de documento
  y **extracción con esquema JSON** («genera JSON directamente desde la imagen completa»). El prompt
  es la plantilla JSON con claves vacías.
- **Precisión:** OmniDocBench v1.5 94,62 · v1.6 95,22 · **Nanonets-KIE 93,7 · Handwritten-KIE 86,1** · OCRBench (Text) 94,0
  · olmOCR-bench 75,2 · IDP Leaderboard 64,2 · **Wild-OmniDocBench 85,08** (10,1 pts menos que en digital,
  la mayor caída de los cinco especializados que mide TeleOCR).
- **Tamaño/latencia:** 0,67 imágenes/s y 1,86 páginas PDF/s en su despliegue (GPU no especificada).
  vLLM, SGLang, **Ollama**, Transformers. **Transformers.js v4 lo soporta** (navegador/Deno con WebGPU);
  `onnx-community/GLM-OCR-ONNX` en q4f16 ≈ 337 + 53 + 262 MB ≈ **650 MB** de descarga.
- **Licencia:** pesos **MIT**; PP-DocLayoutV3 del pipeline, Apache 2.0.
- **Madurez:** 7,4k ★, 1,87 M descargas, card actualizada 11 sep 2026.
- **Robustez:** muy bueno en KIE de documento; en foto pierde más que PaddleOCR-VL. Sin instrucciones
  largas («sólo dos escenarios de prompt»): no se le pueden dar reglas de dominio en texto libre.
- **Veredicto:** **reutilizable tal cual** como extractor KIE barato y **árbitro de dígitos**. Candidato fuerte.
- Fuentes: https://huggingface.co/zai-org/GLM-OCR · https://arxiv.org/abs/2603.10910 · https://github.com/zai-org/GLM-OCR

#### HunyuanOCR 1.0 (25 nov 2025) / 1.5 (7 jul 2026)

- **Qué hace:** VLM de 1B de extremo a extremo: parsing, **text spotting con coordenadas**, **extracción
  de información abierta** («extrae los campos ['k1','k2'…] y devuélvelos en JSON»), subtítulos,
  traducción de fotos. La 1.5 añade decodificación especulativa DFlash (6,37× en Transformers, 2,14× en
  vLLM), **despliegue en PC con llama.cpp (GGUF)**, imágenes hasta 4K y multi-imagen.
- **Precisión (1.0, benchmarks internos):** spotting 70,92 (escena 64,56; tickets 63,51) · **IE en tarjetas
  92,29 y tickets 92,53** (Gemini-2.5-Pro 80,59/80,66; Qwen3-VL-235B 75,59/78,4) · OCRBench 860 ·
  OmniDocBench 94,10 · Wild-OmniDocBench 85,21. 1.5: «top-tier end-to-end en OmniDocBench v1.6».
- **Licencia:** **Tencent Hunyuan Community License**: territorio mundial **excepto UE, Reino Unido y
  Corea del Sur**; licencia aparte por encima de 100 M MAU; prohíbe usar salidas para entrenar modelos
  competidores. **Para un almacén en EE. UU. es usable**, pero no es OSI y hay que dejarlo registrado.
- **Madurez:** 2k ★, push 13 sep 2026; publica también sus benchmarks (Wild-OmniDocBench, CHAOS-Bench).
- **Veredicto:** **reutilizable** con reserva legal. Es el único modelo pequeño que junta _spotting_
  y extracción con buenos números en tarjetas y tickets. Tiene que entrar en el A/B.
- Fuentes: https://github.com/Tencent-Hunyuan/HunyuanOCR · https://huggingface.co/tencent/HunyuanOCR ·
  https://huggingface.co/tencent/HunyuanOCR/blob/main/LICENSE · https://arxiv.org/abs/2607.04884

#### TeleOCR (China Telecom · pesos 14–17 ago 2026, paper v3 10 sep 2026)

- 1,2B (encoder de Qwen2.5-VL + Qwen3-0.6B). Pensado para **documentos capturados con cámara**: modelado
  consciente de la geometría y datos sintéticos de captura real. OmniDocBench v1.6 96,87 · **Wild-OmniDocBench 88,53
  (mejor)** · PureDocBench Real-Degraded 70,85. Apache 2.0; GGUF/llama.cpp de la comunidad. El repo anuncia los
  pesos también como «NaviDC-OCR».
- **Madurez:** muy nuevo (197 ★). Salida Markdown, sin KIE.
- **Veredicto:** **fuente de ideas** (entrenar con distorsión geométrica sintética); vigilarlo.
- Fuentes: https://arxiv.org/html/2608.12898v3 · https://github.com/caipeng328/TeleOCR

#### OvisOCR2 (Alibaba ATH-MaaS · 15 jul 2026)

- 0,8B sobre Qwen3.5-0.8B, extremo a extremo, **sólo Markdown** (sin KIE). OmniDocBench v1.6 96,58 ·
  Real5 92,29 · Wild 87,91 (el que menos cae en foto: 4,67 pts). Apache 2.0.
- **Veredicto:** **descartado** para KIE; prueba de que un Qwen3.5-0.8B afinado aguanta bien la foto.
- Fuente: https://huggingface.co/ATH-MaaS/OvisOCR2

#### MinerU2.5-Pro (1,2B, abr 2026) · MinerU 3.4.5 (14 ago 2026)

- Líder de PDF (v1.6 95,75; Wild 87,33). Licencia propia basada en Apache 2.0: uso comercial libre salvo
  > 100 M MAU o >20 M USD/mes, y **obligación de mencionar MinerU** en servicios online.
- **Veredicto:** **descartado**: PDF → Markdown, sin KIE.
- Fuentes: https://github.com/opendatalab/MinerU · https://huggingface.co/opendatalab/MinerU2.5-Pro-2604-1.2B

#### dots.ocr (jul 2025) → dots.mocr (19 mar 2026)

- 3B (visión 1,2B + LLM 1,7B). Parsing multilingüe, _grounding_, prompt `prompt_scene_spotting` e
  imagen→SVG. olmOCR-bench 83,9; Wild (dots.ocr) 81,84. Licencia MIT con cláusula de atribución
  («Built with dots.ocr»). Integrado en vLLM. Sin actividad desde mar 2026.
- **Veredicto:** alternativa de _spotting_ en escena; **no prioritario**.
- Fuentes: https://github.com/rednote-hilab/dots.mocr · https://huggingface.co/rednote-hilab/dots.ocr-1.5

#### DeepSeek-OCR (oct 2025, MIT) / DeepSeek-OCR 2 (27 ene 2026, Apache 2.0)

- 3B, compresión óptica de contexto, prompts `Free OCR` / `<|grounding|>`. OmniDocBench v1.5 91,09 (v2);
  olmOCR-bench 76,3. En IE de tarjetas y tickets, DeepSeek-OCR v1 **10,04 / 40,54** y OCRBench 430.
- **Veredicto:** **descartado** para etiquetas: optimizado para comprimir páginas, no para campos.
- Fuentes: https://huggingface.co/deepseek-ai/DeepSeek-OCR-2 · tabla IE en el README v1.0 de HunyuanOCR

#### LightOnOCR-2-1B (ene 2026)

- 1B, Apache 2.0, PDF→Markdown rápido (5,71 págs/s en H100; olmOCR 83,2). ONNX en transformers.js.
- **Veredicto:** **descartado** (sin KIE ni foto).
- Fuente: https://huggingface.co/lightonai/LightOnOCR-2-1B

#### Chandra OCR 2 (mar 2026) · Surya 2 (v0.22, 20 jul 2026) · Marker 2.0 (20 jul 2026)

- Chandra 2: 5B sobre Qwen3.5, olmOCR 85,8, Markdown/HTML/JSON con layout. Surya 2: **ahora es un VLM de
  650M** (antes era un pipeline), olmOCR 83,3, necesita vLLM o llama.cpp.
- **Licencia de los pesos:** OpenRAIL-M modificada: **gratis sólo para investigación, uso personal y
  startups con menos de 2 M USD (Chandra) / 5 M USD (Surya)** de financiación o facturación; prohibido
  competir con su API. El código es Apache 2.0.
- **Veredicto:** **descartados por licencia** para Jamis.
- Fuentes: https://github.com/datalab-to/surya · https://huggingface.co/datalab-to/chandra-ocr-2

#### olmOCR 2 (Ai2, oct 2025)

- 7B sobre Qwen2.5-VL-7B, Apache 2.0, entrenado con recompensas de tests unitarios (olmOCR-bench 82,4).
  Corpus de PDF. Último push mar 2026.
- **Veredicto:** **descartado**; copiar la idea de **tests unitarios como recompensa y evaluación** si se afina un modelo.
- Fuente: https://allenai.org/blog/olmocr-2

#### Nanonets-OCR-s (jun 2025) / OCR2 (oct 2025) / OCR-3 (9 abr 2026)

- OCR2-3B hereda la **Qwen Research License (no comercial)**; OCR2-1.5B-exp es Apache 2.0.
  **OCR-3 (35B MoE, primero del IDP Leaderboard con 85,9) es sólo API**, con bbox y score de confianza por elemento.
- **Veredicto:** **descartado** como pesos; OCR-3 enseña qué salida pedir (valor + bbox + confianza).
- Fuentes: https://huggingface.co/nanonets/Nanonets-OCR2-3B · https://nanonets.com/research/nanonets-ocr-3

#### GOT-OCR2.0 (sep 2024) · Granite-Docling-258M (sep 2025)

- GOT: 580M, Apache 2.0 en HF, OCR por región con prompt de caja o color; repo sin actividad desde feb 2025.
  Granite-Docling: 258M, Apache 2.0, conversión de documentos (ONNX en transformers.js).
- **Veredicto:** **descartados** (superados; sin KIE; no son de foto).

### 4.C VLM generales

#### Qwen3.5 · 0.8B / 2B / 4B / 9B (2 mar 2026) — y mayores (27B, 35B-A3B, 122B-A10B, 397B-A17B)

- **Qué hace:** base visión-lenguaje unificada (fusión temprana), modo _thinking_ opcional (0.8B y 2B
  vienen en _non-thinking_), contexto de 262K, _grounding_ (RefCOCO en la card), **varias imágenes**,
  llamada a herramientas.
- **Precisión:** OCRBench 79,1 / 85,4 / 85,0 / 89,2 · CC-OCR 66,7 / 75,8 / 76,7 / 79,3 · OmniDocBench1.5 70,6 / 80,9 /
  86,2 / 87,7 (0.8B / 2B / 4B / 9B). IDP Leaderboard: **9B 76,7** (por encima de GLM-OCR 64,2 en conjunto).
  OCRBench v2 ZH: 9B 64,1 (2.º abierto).
- **Tamaño/latencia:** en 4 bits ~6 GB (9B), ~3 GB (4B), menos de 2 GB (2B y 0.8B). vLLM, SGLang, **llama.cpp,
  Ollama, LM Studio**, **Transformers.js v4** (0.8B/2B/4B con WebGPU; `onnx-community/Qwen3.5-0.8B-ONNX` q4f16 ≈ 650 MB).
- **Licencia:** Apache 2.0. **Madurez:** familia principal de Alibaba; base de OvisOCR2 y de Chandra 2.
- **Robustez:** los VLM generales leen a través del daño y asocian por disposición (lo que hizo Claude
  en la sesión), a su escala. Débiles en localización precisa; con _thinking_, riesgo de bucles en 0.8B.
  Autocorrigen hacia lo verosímil: hay que medirlo (§6).
- **Veredicto:** **reutilizable tal cual** como lector estructurado principal: sigue un esquema largo
  con reglas del dominio, acepta imagen + texto OCR, varias fotos y salida JSON restringida.
  **Afinable** (LoRA) cuando haya fotos etiquetadas.
- Fuentes: https://huggingface.co/Qwen/Qwen3.5-0.8B · https://huggingface.co/Qwen/Qwen3.5-2B ·
  https://huggingface.co/Qwen/Qwen3.5-4B · https://huggingface.co/Qwen/Qwen3.5-9B · https://github.com/QwenLM/Qwen3.8 ·
  https://artificialanalysis.ai/articles/qwen3-5-small-models

#### Qwen3-VL (oct 2025) · Qwen3.6-27B (22 abr 2026) · Qwen3.8-27B (14 ago 2026)

- Qwen3-VL 2B–235B, Apache 2.0. El 235B es la referencia abierta en CC-OCR (0,822; KIE 95,1) y Real5 (88,90).
  Los pequeños quedan superados por Qwen3.5 (Qwen3-VL-2B: spotting 29,68, IE en tarjetas 67,62).
- Qwen3.6-27B: único abierto con calibración medida en ConfBench (AUROC 0,72 verbalizada).
  Qwen3.8-27B: Apache 2.0, OmniDocBench1.5 91,1; figura en Workers AI como `@cf/qwen/qwen3.8-27b`
  (el catálogo lo marca con visión; el changelog del 26 ago lo lista como texto: **verificar**).
- **Veredicto:** los 27B son la opción «más calidad sin GPU propia» si Workers AI acepta imagen; el resto, superado.
- Fuentes: https://github.com/QwenLM/Qwen3-VL · https://arxiv.org/html/2608.01792 · https://developers.cloudflare.com/workers-ai/models/

#### Qwen2.5-VL (ene 2025)

- 7B Apache 2.0; **3B con Qwen Research License (no comercial)**; 72B con licencia Qwen.
- **Veredicto:** **descartado** (superado; el 3B además no es comercial).

#### Gemma 4 · E2B / E4B / 26B-A4B / 31B (2 abr 2026)

- **Apache 2.0** (Gemma 3 no lo era). Presupuesto visual configurable (70–1120 tokens; los altos «para OCR»).
  OmniDocBench (edit distance, ↓): E2B 0,290 · E4B 0,181 · 26B 0,149 · 31B 0,131: bastante peor que los
  especializados. IDP Leaderboard E4B 53,9. Transformers.js v4.1 lo soporta; E2B tiene export ONNX
  «qat-mobile». Workers AI aloja `gemma-4-26b-a4b-it` con visión.
- **Veredicto:** **no prioritario** para lectura de dígitos; el 26B en Workers AI sirve de alternativa
  alojada si Qwen no está disponible con imagen.
- Fuentes: https://huggingface.co/google/gemma-4-E4B · https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/

#### InternVL3.5 (ago 2025) · MiniCPM-V 4.5 (ago 2025)

- InternVL3.5 1B–241B, Apache 2.0, sin release nueva en 2026 (push sep 2025). MiniCPM-V 4.5: 8,7B, Apache 2.0,
  fuerte en OCRBench, llama.cpp e iOS.
- **Veredicto:** **superados** por Qwen3.5 en tamaño equivalente; sin ventaja para nosotros.

#### Florence-2 (jun 2024)

- 0,23/0,77B, MIT, tareas `<OCR>` y `<OCR_WITH_REGION>`, ONNX en transformers.js (el `base-ft` tiene 23k descargas/mes).
- **Veredicto:** **descartado**: sin KIE, débil en texto denso o dañado; Qwen3.5-0.8B lo supera en el mismo nicho de navegador.

### 4.D Legado OCR-free / layout

- **Donut** (MIT, 2022): OCR-free, hay que **afinarlo por tipo de documento**; repo parado desde jul 2024. **Descartado.**
- **LayoutLMv3** (2022): necesita texto y cajas de un OCR externo, y los pesos son **CC BY-NC-SA 4.0 (no comercial)**.
  **Descartado.** Sólo es útil el concepto: texto + posición + imagen, que hoy hace cualquier VLM.

### 4.E Códigos de barras (complemento obligado, C7)

- **zxing-wasm 3.1.4** (MIT, 10 sep 2026) sobre **zxing-cpp 3.1.1** (Apache 2.0, 29 jul 2026): UPC-A/EAN,
  Code 128, DataBar, QR… en WASM, igual en todos los navegadores.
- **`BarcodeDetector`** nativo en Chrome/Android (formatos `upc_a`, `code_128`, `ean_13`…), sin Safari ni Firefox.
- **Veredicto:** **reutilizable tal cual**. Primer paso del motor, como pide §7.2 del documento de partida.
- Fuentes: https://github.com/Sec-ant/zxing-wasm · https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API

---

## 5. Tabla comparativa

Leyenda de licencia: 🟢 permisiva (Apache/MIT) · 🟡 comercial con condiciones · 🔴 no comercial o
umbral que Jamis supera. «Nav.» = navegador (WebGPU/WASM).

| Modelo (fecha)                          | Tipo              | Tamaño           | KIE con esquema                    | Cajas / score                | Evidencia en foto o KIE                                                | Corre en                                | Licencia                    | Actividad              | Veredicto                           |
| --------------------------------------- | ----------------- | ---------------- | ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------- | --------------------------- | ---------------------- | ----------------------------------- |
| **PP-OCRv6** (jun 26)                   | Det+rec           | 1,5M/7,7M/34,5M  | No                                 | Polígono + score/línea       | Rec medium 83,2; industrial 77,4 (interno)                             | CPU, móvil, **Nav.**                    | 🟢 Apache                   | Alta                   | **Reutilizar** (capa local)         |
| PaddleOCR.js 0.4.2 / ppu-paddle-ocr 6.6 | SDK               | ~6–139 MB        | No                                 | Sí                           | ~140 ms/ticket M1 (tiny)                                               | **Nav.**, Deno, RN                      | 🟢 Apache / MIT             | Alta                   | **Reutilizar**                      |
| RapidOCR 3.9.2 (jul 26)                 | Runtime PP-OCR    | = PP-OCRv6 small | No                                 | Sí                           | = PP-OCRv6                                                             | CPU/GPU, Py/C++/Java/C#                 | 🟢 Apache                   | Alta                   | Reutilizar en servidor              |
| docTR 1.1 / OnnxTR (ago 26)             | Det+rec+layout    | ~25–100M         | Detector multiclase (entrenar)     | Score/palabra, cajas rotadas | —                                                                      | CPU/GPU, ONNX                           | 🟢 Apache                   | Alta                   | Copiar funcionalidades              |
| Tesseract 5.5.3                         | Clásico           | —                | No                                 | Score/símbolo                | Débil en foto                                                          | CPU, Nav.                               | 🟢 Apache                   | Media                  | Línea base                          |
| EasyOCR / MMOCR                         | Det+rec           | —                | No                                 | Sí                           | —                                                                      | CPU/GPU                                 | 🟢 Apache                   | **Muerta** (2024/2023) | Descartar                           |
| **PaddleOCR-VL-1.5/1.6** (ene/may 26)   | VLM doc           | 0,9B             | No (spotting, sellos)              | Polígonos                    | **Real5 92,05** · Wild 87,36                                           | GPU, CPU, llama.cpp, ONNX               | 🟢 Apache                   | Alta                   | Reutilizar para spotting            |
| **GLM-OCR** (feb 26)                    | VLM doc + KIE     | 0,9B             | **Sí (JSON)**                      | Vía layout                   | **Nanonets-KIE 93,7** · Wild 85,08                                     | GPU, Ollama, **Nav. (≈650 MB)**         | 🟢 MIT                      | Alta                   | **Reutilizar (A/B)**                |
| **HunyuanOCR-1.5** (jul 26)             | VLM OCR e2e       | 1B               | **Sí (JSON)**                      | **Spotting con coordenadas** | **IE tarjetas 92,29 / tickets 92,53** · spotting 70,92 (interno, v1.0) | GPU, **llama.cpp**                      | 🟡 Tencent (excl. UE/UK/KR) | Alta                   | **Reutilizar (A/B)** con nota legal |
| TeleOCR (ago 26)                        | VLM doc           | 1,2B             | No                                 | Layout                       | **Wild 88,53**                                                         | GPU, GGUF comunidad                     | 🟢 Apache                   | Nueva                  | Vigilar                             |
| OvisOCR2 (jul 26)                       | VLM doc e2e       | 0,8B             | No                                 | No                           | Real5 92,29 · Wild 87,91                                               | GPU                                     | 🟢 Apache                   | Alta                   | Descartar (sin KIE)                 |
| MinerU2.5-Pro (abr 26)                  | VLM doc           | 1,2B             | No                                 | Layout                       | Wild 87,33                                                             | GPU                                     | 🟡 propia (atribución)      | Alta                   | Descartar                           |
| dots.mocr (mar 26)                      | VLM doc           | 3B               | Parcial (prompts)                  | Grounding, scene spotting    | Wild (dots.ocr) 81,84                                                  | GPU vLLM                                | 🟡 MIT + atribución         | Media                  | No prioritario                      |
| DeepSeek-OCR 2 (ene 26)                 | VLM doc           | 3B               | No                                 | Grounding                    | IE tarjetas (v1) **10,04**                                             | GPU                                     | 🟢 Apache                   | Baja                   | Descartar                           |
| LightOnOCR-2 (ene 26)                   | VLM doc           | 1B               | No                                 | Bbox de imágenes             | olmOCR 83,2                                                            | GPU, Nav.                               | 🟢 Apache                   | Media                  | Descartar                           |
| Chandra 2 / Surya 2 (mar/jul 26)        | VLM doc           | 5B / 650M        | JSON de layout                     | Sí                           | olmOCR 85,8 / 83,3                                                     | GPU, llama.cpp                          | 🔴 < 2 M / 5 M USD          | Alta                   | **Descartar (licencia)**            |
| olmOCR 2 (oct 25)                       | VLM doc           | 7B               | No                                 | No                           | olmOCR 82,4                                                            | GPU                                     | 🟢 Apache                   | Baja                   | Descartar                           |
| Nanonets-OCR2-3B (oct 25)               | VLM doc           | 3B               | Tags                               | No                           | —                                                                      | GPU                                     | 🔴 Qwen Research            | Baja                   | Descartar                           |
| GOT-OCR2.0 / Granite-Docling            | VLM doc           | 580M / 258M      | No                                 | Región                       | —                                                                      | GPU, Nav.                               | 🟢                          | Parada / baja          | Descartar                           |
| **Qwen3.5 0.8–9B** (mar 26)             | VLM general       | 0,8–9B           | **Sí (prompt + JSON restringido)** | Grounding (débil)            | OCRBench 79–89 · CC-OCR 67–79 · **IDP 9B 76,7**                        | GPU, **llama.cpp**, Nav. (0.8–4B)       | 🟢 Apache                   | Alta                   | **Reutilizar (principal)**          |
| Qwen3.6/3.8-27B (abr/ago 26)            | VLM general       | 27B              | Sí                                 | Grounding                    | ConfBench AUROC 0,72 (3.6)                                             | GPU, Workers AI (3.8, verificar visión) | 🟢 Apache                   | Alta                   | Alternativa alojada                 |
| Qwen3-VL (oct 25)                       | VLM general       | 2–235B           | Sí                                 | Grounding                    | 235B: CC-OCR KIE 95,1, Real5 88,90                                     | GPU                                     | 🟢 Apache                   | Media                  | Superado (pequeños)                 |
| Qwen2.5-VL (ene 25)                     | VLM general       | 3–72B            | Sí                                 | Sí                           | —                                                                      | GPU                                     | 🔴 3B · 🟢 7B               | Baja                   | Descartar                           |
| Gemma 4 (abr 26)                        | VLM general       | E2B–31B          | Sí                                 | —                            | OmniDoc ED 0,131–0,290 · IDP E4B 53,9                                  | Móvil, Nav. (texto), Workers AI 26B     | 🟢 Apache                   | Alta                   | No prioritario                      |
| InternVL3.5 / MiniCPM-V 4.5             | VLM general       | 1–241B / 8,7B    | Sí                                 | Sí                           | —                                                                      | GPU, llama.cpp                          | 🟢 Apache                   | Baja                   | Superados                           |
| Florence-2 (jun 24)                     | VLM ligero        | 0,23–0,77B       | No                                 | OCR con región               | —                                                                      | **Nav.**                                | 🟢 MIT                      | Baja                   | Descartar                           |
| Donut / LayoutLMv3 (2022)               | OCR-free / layout | 0,2–0,4B         | Afinar                             | — / necesita OCR             | CORD/FUNSD (escaneo)                                                   | GPU                                     | 🟢 MIT / 🔴 NC              | Muerta                 | Descartar                           |
| **zxing-wasm / BarcodeDetector**        | Barras            | ~1 MB            | —                                  | Exacto                       | Decodificación exacta                                                  | **Nav.**                                | 🟢 MIT/Apache               | Alta                   | **Reutilizar**                      |

---

## 6. Dónde corre cada cosa en el stack de PickD

| Lugar                                                                                                                   | Qué cabe                                                                                                                                                        | Qué no                                                                                                                                                                                                  | Nota                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PWA en Android (Chrome)**                                                                                             | zxing-wasm/BarcodeDetector; **PP-OCRv6 tiny/small** con PaddleOCR.js o ppu-paddle-ocr (WebGPU o WASM); orientación y UVDoc ONNX                                 | Un VLM de 0,8–0,9B es _posible_ (transformers.js v4: GLM-OCR, Qwen3.5, PaddleOCR-VL) pero son **~650–900 MB** de descarga y latencia de segundos a decenas de segundos en un gama media (**sin medir**) | COOP/COEP en `_headers` de Pages para WASM con hilos; la descarga se cachea                                                                                                                |
| **Supabase Edge Function (Deno)**                                                                                       | Orquestar: auth, guardar foto en R2, llamar al servidor de inferencia, **validadores deterministas**                                                            | **Ningún modelo**: 256 MB de memoria, **2 s de CPU** por petición, 20 MB de función                                                                                                                     | PP-OCRv6 tiny en Deno existe (ppu), pero 2 s de CPU con WASM sobre una foto de 12 MP no da margen                                                                                          |
| **Servidor de inferencia propio** (vLLM en GPU, o **llama.cpp** en Apple Silicon: el Mac de Bay 2 ya corre el watchdog) | Qwen3.5-2B/4B/9B, GLM-OCR, HunyuanOCR-1.5, PaddleOCR-VL-1.5 (GGUF/llama.cpp o vLLM)                                                                             | —                                                                                                                                                                                                       | Datos privados en casa (la foto de FedEx tiene un nombre de persona). Latencia por etiqueta **a medir**; una etiqueta recortada genera ~200–400 tokens de JSON, mucho menos que una página |
| **Cloudflare Workers AI** (misma cuenta que Pages)                                                                      | Pesos abiertos alojados con visión: `gemma-4-26b-a4b-it`, `llama-4-scout`, `mistral-small-3.1-24b`, `moondream3.1-9B-A2B`, `qwen3.8-27b` (**verificar visión**) | Los especializados (GLM-OCR, PaddleOCR-VL, HunyuanOCR) **no** están                                                                                                                                     | Sin GPU que operar; menos control (logprobs, gramáticas)                                                                                                                                   |

---

## 7. Funcionalidades clave que vale la pena copiar

Aunque se elija otro motor, estas piezas tienen fuente abierta y resuelven un requisito concreto:

1. **Orientación en dos niveles** (C3, C4). PP-LCNet de página (0/90/180/270°) y de línea (0/180°) en PaddleOCR 3.x;
   `straighten_pages` en docTR. Las cajas se fotografían de lado y boca abajo. Modelos ONNX de pocos MB.
2. **Rectificación geométrica antes del OCR clásico** (C3). UVDoc (`use_doc_unwarping`, también en
   `ppu-doc-correction`), o polígonos irregulares como PP-DocLayoutV3. Real5 muestra que la perspectiva
   es lo que tumba a los pipelines (37,98 contra 84,68).
3. **Esquema JSON en el prompt + decodificación restringida con `null` permitido** (C1, C2). GLM-OCR y
   HunyuanOCR demuestran que el esquema-plantilla funciona en modelos de 1B. Con vLLM (_structured
   outputs_: `guided_json` / `guided_regex`) o gramáticas GBNF de llama.cpp, cada campo lleva su forma:
   `^\d{2}-\d{4}[A-Z]{0,3}$`, UPC `^845436\d{6}$`, peso `^\d{1,2}(\.\d{1,2})?$`, **y siempre `| null`**.
   Si no se permite `null`, la restricción **obliga** a inventar un valor bien formado, que es justo el
   riesgo del §5. _(Recomendación propia sobre herramientas documentadas.)_
4. **Evidencia por campo = recorte** (C2). Pedir `bbox` por campo (Nanonets OCR-3 lo da como contrato;
   _spotting_ de HunyuanOCR y PaddleOCR-VL; _grounding_ de Qwen). Como los VLM generales localizan mal
   (OCRBench v2), **cruzar el valor con las cajas del OCR clásico**: la línea de PP-OCRv6 cuyo texto
   coincide da el recorte que se enseña a la persona.
5. **Confianza que signifique algo** (C2).
   - OCR clásico: `rec_score` por línea (PP-OCR), por palabra (docTR), por símbolo (Tesseract); con CTC se
     puede sacar la probabilidad **por carácter** del _post-process_.
   - VLM: _logprobs_ de los tokens del valor (según ConfBench, la variante del **primer token** es la
     mejor de las logprob) o confianza verbalizada; cuál calibra mejor **depende del modelo**, así que
     se mide con el set propio.
   - **Dar al VLM imagen + texto OCR** mejora exactitud y confianza en todos los modelos de ConfBench,
     y es el mismo patrón de fusión de PP-ChatOCRv4.
6. **Whitelist de caracteres por campo** (docTR 1.1). Para SKU/UPC/peso se reconoce con el alfabeto del
   campo: elimina `O/0`, `I/1`, `S/5` donde sólo caben dígitos.
7. **Texto invertido**. No hay documentación específica en ningún proyecto. Truco barato: reconocer el
   recorte **y su negativo** y quedarse con el de mayor score. Los VLM lo leen de forma nativa.
   _(Propuesta propia, a validar con los tipos A y B.)_
8. **Banco de «dígitos corruptos»** al estilo CHAOS-Bench (C2). Tomar fotos reales, alterar un dígito
   del UPC o del SKU con bbox conocida y comprobar si el modelo informa lo que se ve, lo marca dudoso o
   **lo autocorrige hacia el catálogo**. Es la prueba directa del riesgo «inventar un dígito verosímil».
9. **Multi-imagen: extraer por foto y fusionar en código** (C6). IndustryBench-MIPU mide 15–34 pts de
   recall perdidos al pedir la fusión al modelo. Unir por `frame`/`carton` iguales, como en 03-4149BR.
10. **Votación entre motores independientes**. Si PP-OCRv6 y el VLM coinciden en un UPC que pasa el
    dígito de control, confianza alta; si discrepan, se muestra la duda. Ya lo hace PP-ChatOCRv4 con su
    módulo de fusión. _(Aplicación propia.)_
11. **Tests unitarios como métrica** (olmOCR 2): cada caja de §6 se vuelve un conjunto de aserciones por
    campo (`sku == "03-4149BR"`, `upc passes checksum`, `gw == 16`), que después sirven de recompensa
    si se afina un modelo.

---

## 8. Recomendación

### Arquitectura con piezas abiertas (propuesta, a validar con las 13 cajas)

```
PWA (Android Chrome)
 ├─ captura guiada: PP-OCRv6 tiny en vivo → ¿hay texto?, orientación, nitidez
 ├─ zxing-wasm / BarcodeDetector → UPC, Code 128 (verdad si el checksum pasa)
 └─ PP-OCRv6 small + orientación (+UVDoc) sobre la foto final → líneas {texto, polígono, score}
        │  (foto → R2; líneas + barras → Edge Function)
Supabase Edge Function (sólo orquesta)
 └─ llama al servidor de inferencia con: imagen(es) + líneas OCR + esquema
Servidor de inferencia (llama.cpp en el Mac de Bay 2, o vLLM en GPU)
 ├─ Lector principal: Qwen3.5-4B (→ 9B si no alcanza), JSON restringido con null, logprobs
 └─ Segundo lector: GLM-OCR (KIE JSON)  ·  en la misma prueba: HunyuanOCR-1.5
Validación determinista (§3 del doc de partida) + fusión por foto/caja + cruce con catálogo
UI: valor · recorte de evidencia · confianza · pregunta mínima
```

### Top 3

1. **Qwen3.5-4B (y 9B) como lector estructurado principal.** Reutilizable tal cual.
   - Es el único candidato abierto y permisivo (Apache 2.0) que sigue un **esquema largo con reglas del
     dominio** («GTIN = 00 + UPC», «G.W. es el de la caja», «`null` si no se ve»), acepta **varias fotos**
     e **imagen + texto OCR**, y hace _grounding_.
   - Números: OCRBench 85,0/89,2 · CC-OCR 76,7/79,3 · IDP Leaderboard (9B) 76,7, doce puntos sobre GLM-OCR.
   - Cabe en ~3/6 GB en 4 bits (llama.cpp en un Mac), admite JSON restringido y logprobs en vLLM y
     llama.cpp, y **se puede afinar** (es la base de OvisOCR2 y Chandra 2) cuando haya unos cientos de
     fotos etiquetadas.
   - Riesgo: localiza mal (se compensa con el punto 3) y autocorrige (se mide con la prueba 7.8).
2. **GLM-OCR 0.9B como segundo lector y árbitro de dígitos, en A/B con HunyuanOCR-1.5.**
   - GLM-OCR (MIT) trae **KIE con esquema JSON nativo**, Nanonets-KIE 93,7, cuesta una fracción de un 4B
     y corre en Ollama, vLLM e incluso transformers.js. En foto cae más (Wild 85,08), así que se le pasa la
     imagen ya rectificada.
   - HunyuanOCR-1.5 (1B, llama.cpp) tiene los **mejores números publicados en tarjetas y tickets**
     (92,29 / 92,53) y _spotting_ con coordenadas en el mismo modelo. Su licencia excluye UE, Reino Unido y
     Corea: válida para Jamis en EE. UU., pero hay que registrarlo.
   - Dos lectores independientes que coinciden más un checksum que pasa es la confianza más barata que existe.
3. **PP-OCRv6 + orientación (+UVDoc) + zxing-wasm en la PWA.** Reutilizable tal cual.
   - PP-OCRv6 (Apache 2.0, jun 2026) corre en el móvil con WebGPU/WASM (tiny ~6 MB, small ~30 MB) vía
     PaddleOCR.js oficial o ppu-paddle-ocr.
   - Resuelve lo que los VLM no: **guía de encuadre en vivo**, **cajas y scores para la evidencia**,
     **texto OCR que mejora al VLM** (ConfBench), votación de dígitos, y funciona **sin red**.
   - zxing-wasm da las barras exactas, que son la verdad cuando validan.

**Alternativas si el A/B lo pide:** PaddleOCR-VL-1.5 (Apache 2.0, el mejor en fotos de documento,
Real5 92,05) como lector de _spotting_ con polígonos; Qwen3.8-27B o Gemma 4 26B en Workers AI si no se
quiere operar un servidor (confirmar entrada de imagen y si se exponen logprobs).

### Qué medir antes de decidir (plan mínimo)

- **Set:** las 15 fotos de las 13 cajas (§6), campo por campo. Añadir variantes corruptas (7.8) y fotos
  giradas o con reflejo del mismo lote.
- **Métricas por campo:** exacto · `null` correcto · **error con confianza alta** (la métrica que
  importa) · evidencia bien localizada · latencia por foto en el hardware real (Mac de Bay 2, teléfono del piso).
- **Candidatos:** Qwen3.5-2B/4B/9B · GLM-OCR · HunyuanOCR-1.5 · PaddleOCR-VL-1.5 (_spotting_) ·
  PP-OCRv6 small/medium (líneas) · Tesseract como suelo.
- **Umbral para el piso:** cero errores silenciosos en campos con checksum (UPC/GTIN) y en SKU tras
  `canonical_sku`; la duda se enseña, no se esconde.

---

## 9. Fuentes

**Leaderboards y benchmarks**

- OmniDocBench (leaderboard v1.6, act. 11 sep 2026): https://github.com/opendatalab/OmniDocBench
- Real5-OmniDocBench: https://arxiv.org/abs/2603.04205 · https://arxiv.org/html/2603.04205v1
- Wild-OmniDocBench: https://github.com/VirtualLUOUCAS/Wild_OmniDocBench
- OCRBench v2 (ronda 2026.06): https://99franklin.github.io/ocrbench_v2/ · https://arxiv.org/abs/2501.00321
- CC-OCR: https://arxiv.org/abs/2412.02210 · https://llm-stats.com/benchmarks/cc-ocr
- IDP Leaderboard: https://www.idp-leaderboard.org/
- olmOCR-bench: https://huggingface.co/datasets/allenai/olmOCR-bench
- ConfBench (confianza en extracción): https://arxiv.org/html/2608.01792
- CHAOS-Bench (alucinación por carácter): https://github.com/Tencent-Hunyuan/HunyuanOCR/tree/main/benchmarks/CHAOS-Bench
- UNIKIE-BENCH: https://arxiv.org/abs/2602.07038
- IndustryBench-MIPU (multi-imagen, placas industriales): https://arxiv.org/abs/2606.14383
- Union14M / MNSP (scene text recognition): https://github.com/Mountchicken/Union14M · https://arxiv.org/abs/2605.14885
- Ranking de modelos OCR abiertos (Roboflow, 3 ago 2026): https://blog.roboflow.com/best-open-source-ocr-models/

**PaddleOCR**

- Repo y notas de release: https://github.com/PaddlePaddle/PaddleOCR · https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@main/README.md
- PP-OCRv6: https://huggingface.co/blog/PaddlePaddle/pp-ocrv6 · https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec · https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det
- Pipeline OCR (orientación/UVDoc): https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md
- PaddleOCR-VL-1.5: https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5 · https://arxiv.org/abs/2601.21957
- PaddleOCR 3.0 / PP-ChatOCRv4: https://arxiv.org/abs/2507.05595 · http://www.paddleocr.ai/main/en/version3.x/algorithm/PP-ChatOCRv4/PP-ChatOCRv4.html
- PaddleOCR.js: https://www.npmjs.com/package/@paddleocr/paddleocr-js
- ppu-paddle-ocr: https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr · https://jsr.io/@snowfluke/ppu-paddle-ocr

**VLM especializados**

- GLM-OCR: https://huggingface.co/zai-org/GLM-OCR · https://arxiv.org/abs/2603.10910 · https://www.marktechpost.com/2026/03/15/zhipu-ai-introduces-glm-ocr-a-0-9b-multimodal-ocr-model-for-document-parsing-and-key-information-extraction-kie/
- HunyuanOCR: https://github.com/Tencent-Hunyuan/HunyuanOCR · https://huggingface.co/tencent/HunyuanOCR · https://huggingface.co/tencent/HunyuanOCR/blob/main/LICENSE · https://arxiv.org/abs/2607.04884
- TeleOCR: https://arxiv.org/html/2608.12898v3 · https://github.com/caipeng328/TeleOCR · https://huggingface.co/StarDoc-AI/TeleOCR
- OvisOCR2: https://huggingface.co/ATH-MaaS/OvisOCR2 · https://arxiv.org/html/2607.13639v1
- MinerU: https://github.com/opendatalab/MinerU · https://huggingface.co/opendatalab/MinerU2.5-Pro-2604-1.2B · https://arxiv.org/abs/2604.04771
- dots.mocr: https://github.com/rednote-hilab/dots.mocr · https://huggingface.co/rednote-hilab/dots.ocr-1.5
- DeepSeek-OCR 2: https://huggingface.co/deepseek-ai/DeepSeek-OCR-2 · https://arxiv.org/abs/2601.20552
- LightOnOCR-2: https://huggingface.co/lightonai/LightOnOCR-2-1B
- Chandra 2 / Surya 2: https://huggingface.co/datalab-to/chandra-ocr-2 · https://github.com/datalab-to/chandra · https://github.com/datalab-to/surya
- olmOCR 2: https://allenai.org/blog/olmocr-2 · https://arxiv.org/abs/2510.19817
- Nanonets: https://huggingface.co/nanonets/Nanonets-OCR2-3B · https://nanonets.com/research/nanonets-ocr-3 · https://github.com/NanoNets/docext
- GOT-OCR2.0: https://huggingface.co/stepfun-ai/GOT-OCR2_0 · Granite-Docling: https://huggingface.co/ibm-granite/granite-docling-258M

**VLM generales**

- Qwen3.5: https://huggingface.co/Qwen/Qwen3.5-0.8B · https://huggingface.co/Qwen/Qwen3.5-2B · https://huggingface.co/Qwen/Qwen3.5-4B · https://huggingface.co/Qwen/Qwen3.5-9B · https://artificialanalysis.ai/articles/qwen3-5-small-models
- Familia Qwen (fechas 3.5/3.6/3.8): https://github.com/QwenLM/Qwen3.8 · https://huggingface.co/Qwen/Qwen3.8-27B
- Qwen3-VL: https://github.com/QwenLM/Qwen3-VL · https://arxiv.org/abs/2511.21631
- Qwen2.5-VL-3B (licencia de investigación): https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct
- Gemma 4: https://huggingface.co/google/gemma-4-E4B · https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/
- InternVL3.5: https://huggingface.co/OpenGVLab/InternVL3_5-2B · MiniCPM-V 4.5: https://huggingface.co/openbmb/MiniCPM-V-4_5
- Florence-2: https://huggingface.co/microsoft/Florence-2-large · Donut: https://github.com/clovaai/donut · LayoutLMv3: https://huggingface.co/microsoft/layoutlmv3-base

**OCR clásico y barras**

- RapidOCR: https://github.com/RapidAI/RapidOCR/releases
- docTR: https://github.com/mindee/doctr/releases/tag/v1.1.0 · OnnxTR: https://github.com/felixdittrich92/OnnxTR
- EasyOCR: https://github.com/JaidedAI/EasyOCR · MMOCR: https://github.com/open-mmlab/mmocr · Tesseract: https://github.com/tesseract-ocr/tesseract
- zxing-wasm: https://github.com/Sec-ant/zxing-wasm · zxing-cpp: https://github.com/zxing-cpp/zxing-cpp · BarcodeDetector: https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API

**Ejecución**

- Transformers.js v4 (WebGPU; GLM-OCR, LightOnOCR, Qwen3.5-VL, Gemma 4): https://github.com/huggingface/transformers.js/releases
- ONNX para navegador: https://huggingface.co/onnx-community/GLM-OCR-ONNX · https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX · https://huggingface.co/onnx-community/PaddleOCR-VL-1.5-ONNX
- WebGPU en Android (Chrome 121): https://developer.chrome.com/blog/new-in-webgpu-121
- Límites de Supabase Edge Functions: https://supabase.com/docs/guides/functions/limits
- Workers AI (catálogo y changelog): https://developers.cloudflare.com/workers-ai/models/ · https://developers.cloudflare.com/changelog/post/2026-08-26-new-workers-ai-models/
- vLLM structured outputs: https://docs.vllm.ai/en/v0.8.2/features/structured_outputs.html

> Metadatos de GitHub (estrellas, último push, última release) consultados con la API de GitHub el
> 15 sep 2026; licencias y fechas de modelos con la API de Hugging Face el mismo día.
