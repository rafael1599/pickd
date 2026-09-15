# R5 · Técnicas para maximizar la precisión y medirla

> Investigación del 15 sep 2026 para el motor de reconocimiento de etiquetas de caja de PickD.
> Punto de partida: `docs/label-recognition/01-lo-aprendido.md` (13 cajas, 15 fotos, validaciones
> deterministas hechas a mano). Todas las cifras llevan su fuente entre corchetes `[n]` (lista al final).
> Lo que es **inferencia mía** y no un resultado publicado va marcado como _(inferencia)_.
> Varias fuentes son preprints de 2026 sin revisión por pares; se indica cuando pesa.

---

## 0. Resumen ejecutivo

**La tesis:** el riesgo que importa no es la tasa de acierto sino el **error silencioso**, es decir, un
valor equivocado que se acepta sin que nadie lo mire. Los VLM fallan justo ahí: bajo blur, oclusión o
poco contraste completan con lo que les dicta el lenguaje [1], y en cadenas de alta entropía (UPC,
series, part numbers) el error sale fluido e invisible [13]. Pedirles que se abstengan ayuda, pero no
alcanza [6]. Sus señales de confianza internas (logprobs, confianza verbalizada, autoconsistencia por
muestreo) se quedan cortas en extracción de campos [2][5]. Lo que sí separa bien lo fiable de lo que
no es **evidencia independiente**: una segunda lectura con otra estructura, OCR/barras que respalden
el valor, otras vistas de la misma etiqueta y validadores deterministas [2][3][4]. Nuestro dominio es
especialmente favorable: casi todo campo crítico tiene checksum, redundancia (GTIN = `00`+UPC), serie
de hermanas o aritmética de pesos.

**Las 7 técnicas, por prioridad** (detalle en §7):

| #   | Técnica                                                                                                                                                                                                                                      | Ataca                    | Coste |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----- |
| 1   | **Árbitro determinista + procedencia por campo**: barras primero; checksum, prefijo 845436, GTIN, SKU canónico, serie de hermanas y G.W.−N.W. como código. Cada valor lleva su origen (`barcode`, `leído`, `derivado`, `catálogo`, `humano`) | Dígito inventado         | Bajo  |
| 2   | **Esquema de salida «tal como está impreso»**: `?` por carácter ilegible, `null` permitido, `legibility`, texto de evidencia y bbox. La normalización y cualquier cálculo van en código                                                      | Presión por rellenar     | Bajo  |
| 3   | **Banco de evaluación por instancia de campo** con la métrica estrella «error silencioso entre aceptados», más un **test de enmascarado de dígitos**. Se monta antes de tocar prompts                                                        | No saber cuánto se falla | Medio |
| 4   | **Captura con compuertas + recorte por etiqueta a resolución nativa**: blur, reflejo y tamaño de dígito evaluados en el momento; segunda foto con otro ángulo; nada de super-resolución generativa                                           | Glifos confundidos       | Medio |
| 5   | **Dos lecturas estructuralmente distintas + escalera de evidencia A–D** (VLM por campos contra transcripción libre/OCR con bbox, más barras). La auto-aceptación la decide la escalera, no los logprobs                                      | Confianza mal calibrada  | Medio |
| 6   | **Catálogo como prior fuera del decodificador**: candidatos por UPC exacto, SKU canónico, distancia con costes de confusión, modelo+talla+color y serie. Ranking con margen, «ninguno» siempre posible y lectura ciega antes de comparar     | Asociación y ambigüedad  | Medio |
| 7   | **Fusión multi-foto por campo** (una extracción por foto y fusión en código), comprobando que es la misma caja (frame/carton)                                                                                                                | Caras dañadas            | Medio |

---

## 1. El marco: qué error se mide y qué se tolera

### 1.1 Matriz de resultados por instancia de campo

Una etiqueta tiene ~10 campos. La unidad de medida es **(foto o caja, campo)**, no la caja [§6 del doc
01; 14]. Para cada instancia hay cinco resultados posibles:

| Verdad de terreno \ Sistema                    | Aceptado auto (valor)         | Pide confirmación (valor)       | Abstiene (`null`/`?`)   |
| ---------------------------------------------- | ----------------------------- | ------------------------------- | ----------------------- |
| **Campo presente y legible**, valor correcto   | ✅ acierto automático         | 🟡 revisión innecesaria (coste) | 🟠 pérdida de cobertura |
| **Campo presente y legible**, valor incorrecto | 🔴 **ERROR SILENCIOSO**       | 🟢 error atrapado               | —                       |
| **Campo ausente o ilegible**                   | 🔴 **ALUCINACIÓN SILENCIOSA** | 🟢 alucinación atrapada         | ✅ abstención correcta  |

- **Métrica estrella:** `errores silenciosos / campos aceptados automáticamente`, por tipo de campo. Es
  el _selective risk_ de la literatura de predicción selectiva [49], y lo que Dubrov recomienda
  reportar: «critical-field error rates among accepted extractions» [14].
- **Métrica de coste:** cobertura = `aceptados auto / total` (lo que le ahorra al operario).
- **Métrica de abstención:** `abstenciones correctas / campos ausentes o ilegibles` y
  `abstenciones innecesarias / campos legibles`.
- La curva riesgo-cobertura (y su área, AURC) resume el compromiso al barrer el umbral [49]; es la
  métrica que usan ExtractConf y ConfBench [2][3].

ExtractBench trata el esquema como especificación ejecutable: **cada campo declara su métrica**
(identificadores con exact match, cantidades con tolerancia, nombres por equivalencia semántica) y
distingue **omisión** de **alucinación** [52]. Adoptamos ese criterio (§6.1).

### 1.2 Procedencia: el mismo valor no vale lo mismo según de dónde salga

_(inferencia, de la sesión del doc 01 y de [2][4])_ Cada valor final lleva un origen:

| Origen     | Ejemplo                                                                   | Fuerza                                                                                                 |
| ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `barcode`  | ZXing decodifica `845436089331` con dígito de control válido              | Muy alta (errores de sustitución raros y casi siempre atrapados por el control [32])                   |
| `leído`    | El VLM transcribe los dígitos impresos                                    | Media: es justo lo que se alucina                                                                      |
| `derivado` | `8454360915?4` → el control fuerza `…91594`; `20.?0` → 16,40+3,90 = 20,30 | **Candidato, no lectura.** Si otro dígito está mal, la derivación produce un valor válido y equivocado |
| `catálogo` | Color y nombre desde el AS400                                             | Alta para lo que el catálogo sabe; nula para lo que el piso no ha registrado                           |
| `humano`   | El operario confirma o corrige                                            | Verdad operativa (y la etiqueta para el banco de pruebas)                                              |

Regla que se desprende: **un valor `derivado` o `leído` por un solo canal nunca se auto-acepta en un
campo crítico**. Necesita un segundo canal independiente que coincida.

---

## 2. Mitigar la alucinación de dígitos en VLMs

### 2.1 Lo que dice la evidencia

- **Degradación → invención.** KIE-HVQA (NeurIPS 2025) es el primer benchmark de alucinación OCR con
  degradaciones reales (blur, oclusión, bajo contraste) sobre documentos de identidad y facturas.
  Los MLLM «no perciben adecuadamente la degradación y la ambigüedad» y se apoyan en priors
  lingüísticos. Entrenar con recompensa por negarse ante lo ilegible mejoró en 22 puntos absolutos la
  exactitud libre de alucinación de Qwen2.5-VL-7B frente a GPT-4o [1]. _Para nosotros:_ sin
  fine-tuning, esa conducta hay que forzarla desde fuera.
- **Cadenas de alta entropía.** En números de cuenta, totales, códigos y part numbers el prior del
  lenguaje es casi uniforme, y el modelo «se apoya más justo donde el prior informa menos». Una página
  puede tener 99 % de acierto por carácter y no servir [13]. Ejemplo típico: «$42.50» → «$45.20»,
  sintácticamente válido [14].
- **Números rotados y localización.** OCRBench v2: GPT-4o lee mal números en imágenes giradas 90°. Y
  aunque InternVL3-14B acierta 78,3 % en VQA con posición, el IoU de la región que devuelve es solo
  12,9 %: los LMM saben _más o menos_ dónde está la respuesta, no exactamente [16].
- **Abstención por prompt.** En MM-AQA, Claude Sonnet 4.5 se abstuvo correctamente solo en el 1,2 %
  de las preguntas sin respuesta (GPT-5, 4,9 %). Una cláusula explícita de abstención lo sube al
  41,5 %, con una pérdida de 1–5 puntos en las que sí tienen respuesta. Los autores concluyen que el
  prompt no basta [6]. **Pedir `null` es necesario pero no suficiente.**
- **Resolución.** Con caracteres sin contexto (justo nuestro caso: SKU, UPC, series), los MLLM igualan
  al OCR clásico a ~300 ppi y caen mucho por debajo de 150 ppi [17]. El tamaño del objeto afecta de
  forma causal a la percepción de detalles, y recortar la zona relevante mejora sin entrenar [18].

### 2.2 Salida con esquema: qué garantiza y qué no

- **Qué garantiza.** Claude (`output_config.format`, o `strict: true` en tools) compila el esquema a
  gramática y no puede emitir JSON inválido [21]. Gemini soporta `anyOf`, `type:'null'`, `enum`,
  `minimum/maximum` y `$ref`, y **desde el 5 nov 2025 respeta el orden de propiedades del esquema** en
  Gemini 2.5+ [24][23].
- **Qué no garantiza.** Ninguno garantiza que el valor sea _cierto_: Gemini dice explícitamente
  «always validate values in your application» [23]. Claude **no soporta** `minLength/maxLength` ni
  restricciones numéricas (los SDKs las quitan y validan en local), y la documentación de `pattern` es
  ambigua [21]. En Gemini `pattern` no aparece en la lista [23]. **Conclusión: regex y checksums se
  validan en código (Zod), nunca se confían al proveedor.**
- **Formato estricto y razonamiento.** _Let Me Speak Freely?_ (EMNLP Industry 2024) encontró que el
  decoding restringido puede empeorar tareas de razonamiento y mejorar las de clasificación [29].
  JSONSchemaBench (2025) encontró que en general no daña y a veces mejora la calidad [30]. _(inferencia)_
  Transcribir es más percepción que razonamiento, así que el riesgo es bajo. Aun así conviene dejar un
  campo de observación breve **antes** del valor, para que el modelo se comprometa con la legibilidad
  antes de escribir dígitos (el orden de propiedades lo permite [24]).
- **Presión por completar.** ExtractConf describe el extractor guiado por campos («Hunter») como
  **propenso a alucinar valores de campos ausentes o ambiguos por presión de completar el slot**,
  mientras que el lector guiado por el documento («Mapper») solo aflora lo visible [2]. Un esquema
  con `required` y sin salida `null` es exactamente esa presión.

**Diseño recomendado** (por campo; las etiquetas A–F comparten el mismo esquema con campos opcionales):

```jsonc
{
  "label_type": "A|B|C|D|E|F|unknown",          // enum cerrado CON "unknown"
  "labels_stacked": true,                          // hay otra etiqueta debajo
  "fields": {
    "upc": {
      "legibility": "clear|partial|illegible|absent",   // PRIMERO: compromete antes de dígitos
      "as_printed": "8454360915?4",                      // literal; '?' = carácter no visible
      "key_text": "UPC NO",                              // la clave impresa que lo nombra
      "bbox": [ymin, xmin, ymax, xmax],                  // aproximado; se usa para recortar/mostrar
      "note": "cinta con brillo sobre el 11.º dígito"    // corto, opcional
    },
    "sku": { ... }, "gtin14": { ... }, "model": { ... }, "size": { ... },
    "color": { ... }, "nw": { ... }, "gw": { ... }, "serial": { ... }, "frame": { ... },
    "po": { ... }, "carton_no": { ... }, "factory_code": { ... }
  },
  "handwriting": ["10 JAN", "7/8"],
  "other_labels": ["FedEx Return To Shipper"]
}
```

Reglas del prompt _(inferencia, apoyada en [1][2][6][13])_:

1. «Transcribe **exactamente** lo impreso. Si un carácter no se ve, escribe `?`. **No completes**
   dígitos por el prefijo de la marca, por la serie ni por el dígito de control». Hay que decirlo
   explícitamente, porque el modelo _sabe_ que los UPC de Jamis empiezan por 845436.
2. «No calcules dígitos de control ni conviertas unidades». Normalizar (`03-4000-BL` → `03-4000BL`,
   `700C*23"` → `23`) lo hacen `canonical_sku()` y los parsers existentes.
3. `null` o `legibility: absent` son respuestas válidas y esperadas; decir que se medirá la
   invención (cláusula de consecuencias, [6]).
4. Pedir `key_text` obliga a asociar clave y valor por disposición, que es la ventaja del VLM (doc 01
   §5) y deja una evidencia que el OCR puede verificar.

### 2.3 Confianza por campo: qué señales sirven

| Señal                                                                                    | Qué dice la evidencia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Veredicto para PickD                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Logprobs**                                                                             | ExtractConf (GPT-4o, DocILE): AUROC 0,705, y «colapsan a casi todo positivo» en umbrales prácticos [2]. En VLMs los logits están muy mal calibrados (abstención 66–67 %) [5]. En ConfBench, first-token es la mejor agregación, pero pierde contra la confianza verbalizada en modelos capaces [3]. **Disponibilidad:** Gemini 2.5 Flash devuelve «Logprobs is not enabled» desde oct 2025 en la Gemini API (según el foro, funciona vía Vertex) [27]. La API de Claude no los expone (ConfBench evalúa a Claude solo con confianza verbalizada) [3] | **No construir sobre logprobs**                                                                                                              |
| **Confianza verbalizada**                                                                | Muy dependiente del modelo. ConfBench, OCR+imagen: Claude Opus 4.6 AUROC 0,84 / ECE 0,05; Sonnet 4.5 0,77 / 0,13; Haiku 4.5 0,74 / 0,17; Gemma 3-12B 0,58 / 0,31 [3]. En OCR puro con modelos pequeños, 45–60 % [5]                                                                                                                                                                                                                                                                                                                                  | Útil como una señal más, **medida por modelo**. Ojo: PickD tiene Gemini primario y GPT-4o de respaldo, así que hacen falta dos calibraciones |
| **Autoconsistencia (re-muestrear)**                                                      | 5 llamadas: AUROC 0,744 a 5× coste, y solo 6 valores posibles de confianza [2]                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Poco valor por su coste                                                                                                                      |
| **Consistencia multivista** (perturbar la _entrada_: recortes, escalas, desplazamientos) | GRC con K=5 vistas y umbral m=3: LLaVA-Phi3 baja el CER medio de 110,5 % a 8,4 % con 89,5 % de cobertura, y los fallos catastróficos de 33,7‰ a 0,3‰. A igual cobertura, el umbral de confianza deja un CER de 30,9 % [4]. **No detecta el «consenso estable pero equivocado»** [4]                                                                                                                                                                                                                                                                  | Sí, sobre todo si las vistas son **fotos distintas**, no solo recortes                                                                       |
| **Consenso entre modelos**                                                               | Consensus Entropy: +42,1 % F1 detectando errores OCR frente a VLM-como-juez [8]. Pero los LLM tienen **errores correlacionados**: en un leaderboard coinciden el 60 % de las veces que ambos fallan, y más cuanto más precisos son [9]                                                                                                                                                                                                                                                                                                               | Dos VLMs que coinciden valen **menos** que un VLM y un decodificador de barras que coinciden                                                 |
| **Anclaje en OCR** (¿el valor aparece en los tokens del OCR?)                            | Mejor señal individual de ExtractConf: AUROC 0,896, por encima de logprobs+entropía (0,880), porque los fallos vienen del documento, no del modelo [2]                                                                                                                                                                                                                                                                                                                                                                                               | **Sí**: barato y ortogonal                                                                                                                   |
| **Dos lecturas estructuralmente distintas** (Hunter vs Mapper)                           | Añadir el acuerdo con el Mapper fue la mayor ganancia del ablation (+1,7 pp AUROC, −34 % AURC). Fusión de 40 señales: AUROC 0,928, 99,1 % de exactitud al 80 % de cobertura tras recalibración isotónica (ECE 0,034) [2]                                                                                                                                                                                                                                                                                                                             | Sí; el clasificador fusionado cuando haya datos (§6.5)                                                                                       |
| **Sondas en estados latentes**                                                           | +7,6 pp de exactitud de abstención frente al mejor baseline; la señal está en capas intermedias [5]                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Fuera de alcance (requiere pesos abiertos)                                                                                                   |
| **Validadores deterministas**                                                            | Ver §2.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **La señal más fuerte que tenemos**                                                                                                          |

**Verificar antes que abstenerse.** ReCoVERR, en vez de abstenerse ante la duda, busca evidencia
adicional que confirme o contradiga, y responde hasta 20 % más preguntas sin perder exactitud [7].
En nuestro caso esa evidencia son la barra, la otra cara de la caja, el catálogo y la serie.

### 2.4 Verificación cruzada determinista

Comprobado con script sobre la verdad de terreno del doc 01 _(scratchpad `upc_check.py`)_: los 8 UPC y
el GTIN-14 de §6 pasan el dígito de control, y el `…02459…` que sugería la foto del 03-4149BR no pasa.

| Validador                              | Qué atrapa                                                                                                                                  | Qué NO atrapa                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Control GTIN mod 10** (pesos 3/1)    | **Todo** error de un dígito; ~89 % de las transposiciones adyacentes [36]                                                                   | Transposiciones de dígitos que difieren en 5 (0↔5, 1↔6…) [36]; dos errores que se compensan (1 de cada 10 combinaciones pasa)                                                                                             |
| **Resolver comodines**                 | Con un `?`, exactamente un dígito cumple el control: `8454360915?4` → `845436091594`                                                        | Con dos `?` pasan 10 candidatos. Además supone que el resto está bien leído → **`derivado`**                                                                                                                              |
| **Prefijo 845436**                     | UPC de otra marca / lectura corrida                                                                                                         | Solo cubre los primeros 6 dígitos                                                                                                                                                                                         |
| **GTIN-14 = `00`+UPC**                 | Segunda lectura gratis _si es independiente_                                                                                                | **Si el modelo copia el UPC al GTIN, el error se duplica.** Solo cuenta como independiente si sale de otra región recortada u otra barra (GS1: el indicador 0 y el relleno con ceros conservan el dígito de control [37]) |
| **Serie de hermanas**                  | SKU+1 ↔ UPC+1 ↔ talla siguiente. De 03-4149BR=`845436091594` el script predice 4150→`…091600`, 4151→`…091617` _(predicción; no verificada)_ | Series no contiguas, altas fuera de orden                                                                                                                                                                                 |
| **G.W. − N.W. constante por fábrica**  | `20.?0` → 20,30 (3,90 kg en las B)                                                                                                          | Da un candidato derivado; hay que ver al menos un dígito                                                                                                                                                                  |
| **Código de fábrica** (`7RA1`, `G541`) | Modelo y talla por segunda vía                                                                                                              | Tabla incompleta; `WMEI` no identifica modelo                                                                                                                                                                             |
| **SKU canónico** `DD-NNNN[CCC]`        | Formas imposibles                                                                                                                           | Un SKU bien formado pero de otra bici                                                                                                                                                                                     |

**Códigos de barras: exactos, pero no infalibles.**

- El UPC es vulnerable a sustituciones 1↔7 y 2↔8, que el control atrapa «casi siempre» [32].
- En el benchmark (de un fabricante, así que hay sesgo) ZXing-C++ leyó 82,4 % de EAN-13 enfocados y
  **10,2 % desenfocados**, con algún _misread_ en las librerías abiertas [31]. Que la barra no se lea
  es frecuente, y ese hueco lo cubre el VLM.
- En la PWA: `BarcodeDetector` viene por defecto desde Chrome 134, pero **Safari/iOS no lo
  implementa** [35]. El polyfill `barcode-detector` usa ZXing-C++ en WebAssembly [34]; `zxing-wasm`
  corre en navegador, Node, Bun y **Deno** (o sea, también en una Edge Function de Supabase) y expone
  `tryHarder`, `tryRotate`, `tryInvert`, `tryDownscale`, `tryDenoise` y `position` por símbolo [33].
- _(inferencia)_ Se decodifica **cada símbolo del recorte de etiqueta a resolución completa**. Cada
  símbolo se asigna a un campo por forma (12 dígitos que empiezan por 845436 → UPC; regex de SKU;
  regex de serie) y por cercanía de su `position` a la bbox del `key_text`.

---

## 3. Arquitecturas híbridas OCR + VLM + reglas

### 3.1 Resultados publicados

- **Dar al VLM la imagen y además el OCR es lo mejor en extracción y en calibración.** En ConfBench
  (1.346 facturas degradadas, 70K entidades), OCR+imagen ocupa sistemáticamente la mejor zona. Frente
  a solo imagen gana entre 3 (Opus) y 6 (Gemma) puntos de AUROC, y solo OCR queda segundo [3].
- **VLM que consulta OCR experto y «vuelve a mirar».** DianJin-OCR-R1: el VLM lee, llama a modelos
  OCR expertos como referencia, compara, busca errores u omisiones y responde. Supera a su versión sin
  herramientas y a los expertos solos en ReST y OmniDocBench [10]. Motivo: los VLM inventan palabras
  por prior lingüístico y los OCR dedicados alucinan menos pero no razonan [10].
- **Localizar primero y leer después.** En KYC con documentos largos (PaddleOCR + VLM compacto), la
  canalización multietapa mejora hasta 31,9 pp de exactitud por campo frente a mandar el documento
  entero al VLM, y lo que más pesa es la **selección de la región** [11]. _(inferencia)_ Nuestro
  equivalente es recortar cada etiqueta.
- **OCR tradicional + LLM en documentos repetitivos:** F1 0,997 con PaddleOCR en imágenes, con
  enrutado por tipo de documento [12].
- **En producción:** Reducto combina VLMs especializados, OCR tradicional y detección de layout en un
  pipeline híbrido, precisamente contra las alucinaciones de modelos frontera [15]. La guía de Dubrov
  (2026) propone enrutar por niveles (OCR rápido → VLM → humano) y verificar los campos críticos con
  un segundo modelo o un OCR independiente [14].
- **Una advertencia sobre OCR→LLM solo con texto:** es la arquitectura que más probablemente
  «blanquea un error convirtiéndolo en prosa fluida» [13], y además pierde la asociación espacial que
  el VLM resolvió en la sesión (doc 01 §5).
- **Localización nativa:** Gemini devuelve `box_2d` normalizado a 0–1000 [26]; las coordenadas de
  Claude son aproximadas [22]; la localización fina de los LMM sigue floja (IoU 12,9 %) [16]. OCR
  clásico con bbox por símbolo: PP-OCRv5 (<100M parámetros, compite con VLMs de miles de millones)
  [53] o Cloud Vision `DOCUMENT_TEXT_DETECTION`, con confianza y bbox **por símbolo** [54].

### 3.2 Tres patrones y la elección

| Patrón                                                                                                                                             | Pro                                                                                       | Contra                                                                                           | Para PickD |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| **A. OCR → LLM (solo texto)**                                                                                                                      | Barato, bbox precisas                                                                     | Pierde layout, blanquea errores [13]; falla con texto blanco sobre negro y dos columnas (doc 01) | No         |
| **B. VLM primero → OCR/barras verifican**                                                                                                          | Aprovecha la asociación clave-valor del VLM                                               | Si el verificador no lee, no hay segunda señal                                                   | Parcial    |
| **C. Canales en paralelo + árbitro** (barras ∥ OCR con bbox ∥ VLM con imagen+tokens OCR → reglas deterministas + catálogo → escalera de evidencia) | Señales ortogonales y errores poco correlacionados [9]; es lo que fusiona ExtractConf [2] | Dos o tres llamadas por foto                                                                     | **Sí**     |

### 3.3 Pipeline propuesto _(inferencia; cada paso se apoya en lo citado)_

```
CAPTURA (PWA)
 1. Foto a resolución completa (no fotograma de vídeo), 1–4 caras por caja.
 2. Compuertas en el dispositivo: nitidez (varianza del Laplaciano), reflejo (manchas saturadas),
    tamaño aparente de la etiqueta → "repite la foto" al instante [41].
 3. BarcodeDetector nativo / zxing-wasm sobre la foto completa → símbolos + posición [33][34][35].

SERVIDOR (Edge Function)
 4. Localizar etiquetas: box_2d del VLM (pasada barata, baja resolución) u OCR de detección [26][53].
    Margen generoso (la bbox de un LMM es aproximada [16][22]).
 5. Recortar cada etiqueta a resolución NATIVA, rectificar perspectiva y orientación [16].
    zxing-wasm otra vez sobre cada recorte (tryHarder/tryRotate/tryDownscale) [33].
 6. Canal OCR (símbolos con bbox y confianza) sobre cada recorte [53][54].
 7. Canal VLM "Hunter": recortes (+ vista general reducida) + tokens OCR → esquema §2.2 [3].
 8. Canal VLM "Mapper" (u OCR como Mapper): "transcribe todas las líneas con su bbox", sin esquema
    de campos [2]. Idealmente otro proveedor que el Hunter [9].

ÁRBITRO (código puro, con tests, como el resto de utils de PickD)
 9. Normalizar (canonical_sku, parsers de talla/peso), validar (§2.4), resolver comodines → candidatos
    'derivado'.
10. Anclar: ¿el valor del Hunter aparece en OCR/Mapper (con coste de confusión) cerca de su key_text?
11. Fusionar por campo entre fotos de la MISMA caja (§4.5).
12. Candidatos de catálogo (§5) y escalera de evidencia A–D (§6.6) → aceptar / confirmar / preguntar.
```

Coste por foto _(inferencia)_: una llamada VLM con los recortes en un solo request (Claude acepta
varias imágenes etiquetadas «Image 1:», «Image 2:» [22]), una de OCR y el decodificado de barras, que
es gratis. El Mapper con otro modelo puede ir **solo** cuando falten barras o haya conflicto.

---

## 4. Preprocesado de fotos de cartón con film

### 4.1 Mejor prevenir en la captura que corregir después

- Detectar blur en capturas móviles de documentos antes de reconocer es práctica establecida: se
  rechaza y se vuelve a pedir la foto [41].
- **Reflejos del film.** Con varias fuentes de luz el reflejo _se mueve_ entre fotos y se puede
  reconstruir una imagen sin él [39]. _(inferencia)_ En un móvil el equivalente es pedir **una segunda
  foto inclinando el teléfono** cuando la compuerta detecta saturación sobre la etiqueta, y fusionar
  **lecturas** (§4.5), no píxeles.
- La eliminación neuronal de brillos existe (DocHR14K, 14.902 pares reales), y en GPT-4o subió la
  similitud del texto de 80,9 % a 83,5 % [38]. Es poco, y la red incluye un módulo de difusión que
  «restaura detalles», o sea, puede inventar trazos. No la usaría para dígitos.

### 4.2 Recorte por etiqueta y resolución

- Límites de los modelos: Claude reduce la imagen a **1568 px** de lado largo (estándar) o **2576 px**
  (Claude 4.7+) antes de verla; recomienda recortar si el texto importa y avisa de que la compresión
  JPEG fuerte degrada la lectura [22]. Gemini 3 permite fijar `media_resolution` por imagen (LOW 280 …
  ULTRA_HIGH 2240 tokens) [25]. Un plano de 12 MP de la caja entera reducido a 1568 px deja los dígitos
  del UPC diminutos.
- Paridad con OCR a ~300 ppi y caída por debajo de 150 ppi [17]. _(inferencia)_ A 300 ppi un texto de
  10 pt mide ~42 px de em, y un dígito unos 30 px de alto. **Regla práctica: que en el recorte enviado
  los dígitos midan ≥ 30 px**, y si no, pedir acercarse.
- Recortar la región relevante mejora sin entrenar la percepción de detalles pequeños [18]. Gemini 3
  Flash ya hace _zoom_ agentivo con ejecución de código (+5–10 % en benchmarks de visión según Google)
  [19], y los o3/o4-mini de OpenAI recortan y rotan dentro de su razonamiento [55]. _(inferencia)_
  Preferimos **recortes deterministas y reproducibles** hechos por nosotros: el mismo recorte entra al
  OCR, a las barras y a la pantalla de confirmación, y la evaluación es repetible.

### 4.3 Perspectiva y orientación

Rectificar con homografía los cuatro vértices de la etiqueta ayuda sobre todo a OCR y barras; los
VLMs toleran más, pero leen mal números girados 90° [16]. Como mínimo hay que normalizar la
orientación.

### 4.4 Super-resolución: no generativa

Los modelos generales de super-resolución «fallan catastróficamente con texto: caracteres
distorsionados, contenido alucinado». Incluso TextSR, diseñado para texto, reconoce que si su OCR guía
se equivoca genera «caracteres incorrectos con otro significado» [40]. Para dígitos solo interpolación
(Lanczos) del recorte y, sobre todo, **otra foto más cerca**.

### 4.5 Varias fotos de la misma caja

- **Una extracción por foto y fusión en código.** En IndustryBench-MIPU (27.652 imágenes, 9 MLLMs),
  pasar de una imagen a varias por producto **cuesta 15–34 pp de recall**, con precisión alta (86–94 %)
  [20]. Integrar evidencia entre imágenes dentro del modelo es el cuello de botella. _(inferencia)_
  Mandar las 3 caras en un prompt y pedir un JSON es peor que 3 lecturas y un `merge` determinista.
- **Primero, ¿es la misma caja?** Frame y carton coinciden (doc 01, 03-4149BR). Si no coinciden,
  **no se fusiona**: son dos cajas.
- **Votación por carácter con léxico.** ROVER alinea salidas de varios reconocedores y vota [42];
  LV-ROVER añade verificación contra léxico (en 2026, −44 % de CER por el ensemble y −70 % con
  postproceso en OCR de maltés) [42]. Nuestro «léxico» son el control, la serie y el catálogo. Ejemplo
  ilustrativo (no son las lecturas reales) con el 03-4149BR: cara 1 `84543609?594`, cara 2
  `845436?91594` → alineación → `845436091594`, valor
  **`leído` por dos vistas**, y además pasa el control.
- **Multivista dentro de una foto.** Para un campo en conflicto, 3–5 recortes con desplazamiento o
  escala distintos y consenso ≥ 3/5 [4]. Solo para campos críticos en duda, por coste.

---

## 5. El catálogo como prior

### 5.1 Por qué no restringir el decodificador a los SKUs válidos

- vLLM/XGrammar pueden forzar `choice`/regex/gramática [30], y Claude y Gemini aceptan `enum` [21][23].
  Parece tentador meter los ~2.200 SKUs como enum.
- _(inferencia, con dato del doc 01)_ **Sería el peor error posible.** Un enum convierte «no lo veo» en
  «el SKU válido más parecido», o sea, **fabrica un error silencioso que parece verificado**. Y el
  mundo es abierto: **5 de 13 cajas (38 %) fueron altas**, no estaban en PickD (03-4149BR, 09-4807CL,
  09-4796CL, 03-4000BL, 03-3850BK). Con enum el sistema las habría forzado a otro SKU.
- Se restringe la **forma** (enums cerrados con `unknown` para `label_type` y `legibility`) y el
  **valor** se deja libre.

### 5.2 Generación y ranking de candidatos (en código)

1. **UPC por barra** = UPC del catálogo → candidato exacto. Hoy solo ~10 SKUs lo tienen (doc 01 §4);
   cada caja rellena uno, así que la señal crece con el uso.
2. **SKU canónico exacto** contra `sku_metadata` **y el universo AS400** (`v_as400_skus_unregistered`
   y `as400_snapshot`), no solo PickD. Lo que el AS400 conoce y PickD no se registra con
   `register_sku_from_as400`.
3. **Distancia con costes de confusión.** Levenshtein ponderado: `0/O/D`, `1/I/L/7`, `5/S`, `8/B/3`,
   `2/Z`, `6/G` cuestan menos que otras sustituciones. Es la técnica estándar en OCR de matrículas
   (EUSIPCO 2022) [43] y hay librería [43]. Se aprende la matriz de las correcciones del operario (§6.5).
4. **Modelo + talla + color** contra la descripción del AS400 (`parseBikeName`,
   `expandModelAbbreviation`), sobre todo para etiquetas D sin SKU (cajas 12 y 13).
5. **Serie de hermanas:** predice el UPC a partir del SKU vecino y viceversa (§2.4).

**Ranking con margen** _(inferencia)_: se auto-resuelve solo si hay un único candidato con evidencia A
(§6.6) y el segundo queda a ≥ 2 sustituciones «caras». Si no, se muestran los 3 primeros con la
diferencia resaltada.

### 5.3 Lectura ciega antes de comparar

- _Retrieve-and-rank_ (RAR) usa el MLLM para reordenar candidatos traídos por recuperación cuando el
  vocabulario es grande [44].
- _(inferencia)_ **Mostrarle los candidatos al modelo lo ancla**: igual que el humano con el valor
  pre-rellenado [50], y la «presión de completar» de [2]. Por eso la secuencia es:
  1. **Pasada ciega:** transcribir sin catálogo (esquema §2.2).
  2. El código genera candidatos y localiza **las posiciones donde difieren**.
  3. Solo si hace falta, **pasada dirigida**: «en este recorte, ¿el 9.º carácter es 3, 8 o
     ilegible?», siempre con la opción _ninguno/ilegible_. Es la verificación con evidencia de
     ReCoVERR [7] aplicada a un carácter.

---

## 6. Evaluación

### 6.1 Formato de la verdad de terreno

Un JSON por caja, **sin PII** (la foto de FedEx trae un nombre; las fotos siguen fuera del repo como
dice el doc 01 y el JSON las referencia por hash):

```jsonc
{
  "box_id": "b03",
  "photos": ["sha256:…", "sha256:…"],
  "label_types": ["A", "A"],
  "catalog_snapshot": "2026-09-15T08:00", // catálogo ANTES de la sesión (ver 6.2)
  "fields": {
    "sku": { "value": "03-4149BR", "presence": "partial", "metric": "exact" },
    "upc": { "value": "845436091594", "presence": "partial", "metric": "exact" },
    "gw": { "value": 16, "presence": "clear", "metric": "abs<=0.05" },
    "color": { "value": "COPPER TONE", "presence": "clear", "metric": "normalized_exact" },
    "serial": { "value": null, "presence": "absent", "metric": "abstain" },
  },
  "expected_action": "register_new", // salida de negocio (doc 01 §4)
  "verified_by": "human-double-key", // ver 6.2
}
```

Métricas por campo:

- **Identificadores** (SKU, UPC, GTIN, serie, frame): exact match tras la forma canónica. **CER**
  sobre `as_printed` solo como diagnóstico (un CER bajo con exact match fallido es lo típico de un
  VLM [13]).
- **Pesos:** tolerancia absoluta (0,05 kg en las B de dos decimales; 0 en las A de enteros).
- **Texto** (modelo, color): exacto tras normalizar con las funciones de PickD.
- **`presence: absent/illegible`:** acierto = abstención; cualquier valor = alucinación.
- **Por caja:** SKU top-1 y acción de negocio correcta (reponer / alta / frame / identidad dudosa).

### 6.2 El set inicial de 13 cajas / 15 fotos: tres cuidados

1. **Circularidad.** La verdad de terreno la produjo Claude leyendo, más validaciones y la
   confirmación de Rafael. Evaluar un VLM contra etiquetas hechas por un VLM infla el resultado.
   **Hay que re-verificar cada campo contra la foto con una persona**, idealmente escribiendo a ciegas
   y comparando después. ConfBench recuerda que evaluar la calibración es «mucho más sensible al error
   de anotación que evaluar la exactitud» [3].
2. **Fuga por catálogo.** Las 5 altas ya están en PickD. Si el prior (§5) consulta el catálogo de
   hoy, la evaluación saldrá perfecta y falsa. Se evalúa contra un **snapshot anterior a la sesión**.
3. **Incluir ausencias.** Contando el doc 01 §6 salen ~78 campos presentes y ~8 ausentes esperados:
   sin SKU en las cajas 12 y 13, sin UPC en 9, 10, 11 y 13, sin G.W. en 11 y 13. Esos 8 son el primer
   test de abstención. Casos duros que ya existen: dos caras dañadas (#3), peso borroso (#6), valor
   desplazado respecto a su clave (#10), etiquetas apiladas (#2, #9, #10) y texto a mano (#12).

### 6.3 Test de enmascarado de dígitos: medir directamente el riesgo principal

_(inferencia; es la versión barata y dirigida de KIE-HVQA [1] y de las degradaciones de ConfBench [3])_

- Sobre los recortes de las 15 fotos, **tapar digitalmente** 1, 2 o 3 dígitos de UPC/SKU/peso con un
  parche del color del cartón, una franja de «cinta con brillo» o blur local.
- **Resultado esperado:** `?` en esa posición o `legibility: partial`. **Fallo:** cualquier dígito.
- Con 8 UPC × 12 posiciones × 3 tipos de parche salen ~290 casos solo de UPC, en una tarde. La métrica
  es la **tasa de invención** por modelo y prompt: la cifra que decide si un modelo sirve.
- Añadir **pares cambiados**: modificar digitalmente un dígito visible (p. ej. `…091594` →
  `…091894`) y comprobar que el modelo lee lo que _está_, no lo que el control o el catálogo
  «prefieren».
- Advertencia: la degradación sintética no equivale a la natural, y la calibración que sale de ella
  puede no transferirse [3]. Por eso esto **complementa** al set real y no lo sustituye.

### 6.4 Estadística honesta con pocos datos

- **Regla de tres:** 0 errores en n casos → cota superior al 95 % ≈ 3/n [46]. Calculado exacto
  (Clopper-Pearson unilateral):

| n (instancias de un tipo de campo, aceptadas auto) | 0 errores | 1 error  | 2 errores |
| -------------------------------------------------- | --------- | -------- | --------- |
| 13                                                 | ≤ 20,6 %  | ≤ 31,6 % | ≤ 41,0 %  |
| 50                                                 | ≤ 5,8 %   | ≤ 9,1 %  | ≤ 12,1 %  |
| 100                                                | ≤ 3,0 %   | ≤ 4,7 %  | ≤ 6,2 %   |
| 300                                                | ≤ 1,0 %   | ≤ 1,6 %  | ≤ 2,1 %   |
| 600                                                | ≤ 0,5 %   | ≤ 0,8 %  | ≤ 1,1 %   |
| 1000                                               | ≤ 0,3 %   | ≤ 0,5 %  | ≤ 0,6 %   |

- **Consecuencia:** con 13 cajas **no se puede afirmar** nada mejor que «el error silencioso de UPC está
  por debajo de ~20 %». El set inicial sirve para **encontrar modos de fallo** (análisis de errores
  [51]), no para certificar umbrales.
- Ajustar un umbral hasta que el riesgo empírico en calibración quede bajo α **no da garantía** y crea
  una «falsa sensación de seguridad». Hay que usar cotas exactas (Clopper-Pearson) o
  _Learn-then-Test_, con muestras bastante más grandes de lo habitual [47][48].
- Todo cambio de **modelo, versión o prompt** reinicia el contador de ese tipo de campo. ConfBench: la
  estrategia óptima de confianza cambia con el modelo [3]. El eval se corre como puerta, igual que el
  `pre-push` corre vitest.

### 6.5 Crecer con las correcciones del operario

Qué registrar por instancia de campo _(inferencia)_: recorte (hash), salida de cada canal
(barra/OCR/Hunter/Mapper), valor propuesto, nivel de evidencia, **valor final**, quién lo fijó, si el
operario **cambió** algo y el tiempo hasta decidir. Modelo, versión de prompt y snapshot de catálogo.

Qué entra al banco de pruebas, en tres flujos:

1. **Toda corrección** (el sistema propuso X y el operario puso Y): son los errores atrapados.
2. **Muestreo por incertidumbre:** instancias donde los canales discrepan. Es el aprendizaje activo
   clásico: etiquetar lo más informativo.
3. **Auditoría aleatoria de lo auto-aceptado:** la única forma de _estimar_ el error silencioso en
   producción. Sin este flujo, el aprendizaje activo sesga el banco hacia lo difícil y nunca ve los
   errores que el sistema no sabía que cometía. _(inferencia)_ Se hace con **reingreso ciego**: al
   operario se le pide teclear o elegir el valor **sin enseñarle la propuesta**, en un 5–10 % de las
   cajas aceptadas. Si ve el valor pre-rellenado, el sesgo de automatización hace que confirme sin
   mirar [50].

Además:

- **Estratificar** por tipo de etiqueta A–F y por fábrica, y congelar un **holdout** que no se toca
  al iterar prompts (el set de desarrollo sí).
- **Recalibrar** la confianza fusionada cuando haya datos. ExtractConf recalibró con una Lasso ligera
  sobre **~165 muestras del dominio** (ECE −89 % en recibos) [2]. Antes de eso, la escalera ordinal
  de §6.6 basada en reglas.
- **Aprender la matriz de confusión** de glifos (para §5.2) de los pares (propuesto, final).

### 6.6 Umbrales: escalera de evidencia y despliegue por fases

**Escalera por campo** _(inferencia, construida con [2][3][4][7] y el doc 01)_:

| Nivel | Condición (todas las reglas del campo pasan)                                                                                                                                                    | Acción                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **A** | Dos canales **independientes** coinciden: barra decodificada = dígitos leídos, **o** leído en dos fotos/vistas = catálogo exacto único, **o** leído + ancla OCR + serie de hermanas consistente | Auto-aceptar (tras superar la puerta de fase)                                                            |
| **B** | Un canal leído con `legibility: clear` + anclado en OCR + validadores OK + catálogo exacto único                                                                                                | Aceptar con el recorte visible; confirmar con un toque en campos críticos                                |
| **C** | Valor `derivado` (comodín resuelto, resta de pesos), catálogo difuso, top-2 con poco margen, o canales en conflicto                                                                             | **Confirmación obligatoria**: recorte ampliado y posiciones dudosas resaltadas, sin botón «aceptar todo» |
| **D** | `null`/ilegible y sin candidatos, o identidad dudosa (el X.24 del doc 01)                                                                                                                       | Preguntar o pedir otra foto; **no escribir**                                                             |

Criticidad (doc 01 §4): **SKU y UPC** deciden qué fila de inventario se toca, así que son críticos.
**G.W.** es crítico solo si se va a sellar peso, y se sella «solo si cambia». **Color y modelo** los
manda el AS400, así que la etiqueta confirma pero no escribe.

**Fases** _(inferencia; umbrales con §6.4)_:

1. **Sombra.** El sistema propone, el operario decide todo (hoy ya confirma destino en 13/13 cajas,
   así que la pantalla existe) y se mide la matriz de §1.1.
2. **Asistida.** Niveles B y C con confirmación; nivel A se muestra ya aceptado pero se puede tocar.
3. **Automática por tipo de campo.** Se habilita el nivel A de un tipo (p. ej. UPC con barra
   coincidente) cuando acumule **≥ 300 instancias sin error silencioso** (cota ≤ 1 %) y ~600 para
   aspirar a ≤ 0,5 %. Con auditoría ciega continua y **retroceso automático** a asistida si aparece
   un error silencioso.

Referencia de la industria: Azure Document Intelligence recomienda un piloto con documentos reales
para ver la distribución de confianzas y fijar umbrales por caso de uso, «cerca de 100 %» en datos
sensibles [45].

### 6.7 La pantalla de confirmación también es parte de la precisión

- Mostrar **el recorte junto a cada valor**: citas y bboxes que atan el valor a los píxeles permiten
  revisar de verdad, no aprobar por inercia [13].
- Resaltar solo las **posiciones** en duda (el 11.º dígito), no el campo entero.
- En nivel C, que el operario **elija entre candidatos o teclee** las posiciones dudosas en vez de
  pulsar «OK» sobre un valor ya escrito [50].

---

## 7. Recomendaciones priorizadas para PickD

### 1 · Árbitro determinista + procedencia por campo _(ya validado a mano; coste bajo)_

- Módulo puro con tests: `gtinCheck`, `solveWildcards`, `gtin14FromUpc`, `siblingSeriesPredict`,
  `grossMinusNetByFactory`, `decodeFactoryCode`, más `canonical_sku`.
- Barras primero en la PWA con `BarcodeDetector` y fallback `barcode-detector`/zxing-wasm [33][34][35],
  y otra pasada en servidor sobre cada recorte.
- Todo valor lleva `origin`. **Nada `derivado` ni de un solo canal se auto-acepta en SKU/UPC.**
- _Medir:_ cuántos errores del test de enmascarado (§6.3) atrapa el árbitro sin ayuda del modelo.

### 2 · Esquema «tal como está impreso» con `?`, `null`, `legibility`, `key_text` y bbox _(bajo)_

- `legibility` antes que el valor [24], nada de normalizar ni calcular en el modelo, cláusula de
  abstención con consecuencias [6].
- Validación Zod en código: regex y checksum no dependen del proveedor [21][23].
- _Medir:_ tasa de invención en §6.3 **antes y después** del esquema, con Gemini (primario) y GPT-4o
  (respaldo) por separado.

### 3 · Banco de evaluación antes de afinar _(medio)_

- Convertir el doc 01 §6 en JSON por caja (§6.1), **re-verificado por una persona** y contra el
  **snapshot de catálogo previo** (§6.2).
- Añadir el test de enmascarado (~300 casos sintéticos).
- Script offline que reporta la matriz de §1.1 por campo y modelo, con cotas Clopper-Pearson.
  Corre en cada cambio de prompt o modelo.

### 4 · Captura con compuertas + recorte por etiqueta a resolución nativa _(medio)_

- Laplaciano y saturación en el dispositivo, con repetición inmediata [41].
- Segunda foto inclinada si hay reflejo [39].
- Recorte por etiqueta con dígitos ≥ ~30 px [17][22][25]; rectificar orientación [16].
- **Nada de super-resolución generativa** [40] ni quitabrillos con difusión [38].

### 5 · Dos lecturas distintas + escalera A–D; nada de logprobs _(medio)_

- Hunter con imagen+tokens OCR [3], y Mapper/OCR con bbox [2][53][54].
- Anclar cada valor en el OCR (la mejor señal individual [2]).
- Consenso entre fotos o vistas para los campos en conflicto [4].
- Preferir canales heterogéneos a dos VLMs parecidos, por los errores correlacionados [9].
- Con ≥ ~165–300 instancias, entrenar un combinador ligero de señales, recalibrado [2].

### 6 · Catálogo como prior fuera del decodificador _(medio)_

- Universo = PickD **y** AS400.
- Candidatos: UPC exacto, SKU canónico, Levenshtein con costes de confusión aprendidos [43],
  modelo+talla+color y serie de hermanas.
- Margen para auto-resolver y «ninguno» siempre posible, por el 38 % de altas.
- Pasada ciega → diferencias → pregunta dirigida por carácter [7][44].
- **Nunca enum de SKUs en el esquema.**

### 7 · Fusión multi-foto por campo _(medio)_

- Una extracción por foto [20], identidad de caja por frame/carton antes de fusionar, votación por
  carácter con verificación de léxico, control y serie [42].
- _Medir:_ la caja #3 (dos caras dañadas) tiene que salir en nivel A, y fotos de **dos cajas
  distintas** del mismo modelo **no** deben fusionarse.

**Transversal:** despliegue sombra → asistida → automática por tipo de campo, con ≥ 300 instancias sin
error silencioso para abrir el nivel A, auditoría ciega del 5–10 % y retroceso automático (§6.6).

---

## 8. Riesgos y preguntas abiertas

- **Consenso estable pero equivocado** (todas las vistas se equivocan igual, p. ej. un `8` impreso a
  medias que parece `3`): no lo detecta el multivista [4]. Solo lo cubren barra, control, catálogo o
  humano.
- **La serie de hermanas como prior puede autoconfirmar** un error si el catálogo ya tiene uno mal
  registrado (como el SKU con número de frame `WMEI00132` del doc 01). Las predicciones de serie son
  `derivado`, nunca `A` solas.
- **Dos proveedores, dos calibraciones.** Si el fallback a GPT-4o entra en caliente, sus propuestas
  deben tratarse con los umbrales de _su_ banco, o bajar un nivel de la escalera [3].
- **Latencia y coste** de 2–3 llamadas por foto: el Mapper puede ir solo en conflicto. Hay que medir
  cuántas cajas lo necesitan en la fase sombra.
- **Tamaño del set:** hasta tener cientos de instancias por tipo de campo, cualquier «X % de acierto»
  es un intervalo ancho (§6.4). Hay que reportarlo como intervalo.
- _Pendiente de verificar en código:_ soporte real de `pattern` en el structured output del modelo
  que se use [21][23], y disponibilidad de logprobs en el endpoint concreto (Gemini API vs Vertex)
  [27], por si alguna vez se quieren como señal secundaria.

---

## 9. Referencias

1. He, Z. et al. _Seeing is Believing? Mitigating OCR Hallucinations in Multimodal Large Language Models_ (KIE-HVQA). NeurIPS 2025. https://arxiv.org/abs/2506.20168 · https://papers.nips.cc/paper_files/paper/2025/file/6b628a3d7cb8055eb6fd2dd48c586347-Paper-Conference.pdf
2. Kumar, N. _Beyond Logprobs: A Multi-Signal Confidence Engine for LLM-Based Document Field Extraction_ (ExtractConf). jun 2026. https://arxiv.org/abs/2606.24420 · https://arxiv.org/html/2606.24420
3. Roy, P. et al. (AWS). _Can You Trust the Confidence? ConfBench for Vision-Language Models on Document Extraction._ ago 2026. https://arxiv.org/html/2608.01792
4. Gong et al. _From Plausibility to Verifiability: Risk-Controlled Generative OCR with Vision-Language Models_ (GRC). 2026. https://arxiv.org/html/2603.19790v3
5. Yao, J. et al. _Reading Between the Lines: Abstaining from VLM-Generated OCR Errors via Latent Representation Probes._ nov 2025. https://arxiv.org/abs/2511.19806 · https://arxiv.org/html/2511.19806
6. _Knowing When Not to Answer: Evaluating Abstention in Multimodal Reasoning Systems_ (MM-AQA). abr 2026. https://arxiv.org/html/2604.14799
7. Srinivasan, T. et al. _Selective "Selective Prediction": Reducing Unnecessary Abstention in Vision-Language Reasoning_ (ReCoVERR). ACL Findings 2024. https://arxiv.org/abs/2402.15610
8. Zhang, Y. et al. _Consensus Entropy: Harnessing Multi-VLM Agreement for Self-Verifying and Self-Improving OCR._ 2025 (rev. may 2026). https://arxiv.org/abs/2504.11101
9. Kim, E., Garg, A., Peng, K., Garg, N. _Correlated Errors in Large Language Models._ ICML 2025. https://arxiv.org/abs/2506.07962
10. Qwen DianJin Team. _DianJin-OCR-R1: Enhancing OCR Capabilities via a Reasoning-and-Tool Interleaved Vision-Language Model._ ago 2025. https://arxiv.org/abs/2508.13238
11. Han, Y. et al. _A Multistage Extraction Pipeline for Long Scanned Financial Documents: An Empirical Study in Industrial KYC Workflows._ abr 2026. https://arxiv.org/abs/2604.26462
12. Wang, Z., Shen, X. _Hybrid OCR-LLM Framework for Enterprise-Scale Document Information Extraction Under Copy-heavy Task._ oct 2025. https://arxiv.org/abs/2510.10138
13. LlamaIndex. _LLM OCR: Why the Errors Got Harder to Spot._ ago 2026. https://www.llamaindex.ai/blog/llm-ocr
14. Dubrov, S. _The Definitive Guide to OCR in 2026: From Pipelines to VLMs._ mar 2026. https://slavadubrov.github.io/blog/2026/03/04/ocr-guide/
15. ZenML LLMOps Database. _Reducto: Production-Scale Document Parsing with Vision-Language Models and Specialized OCR._ https://www.zenml.io/llmops-database/production-scale-document-parsing-with-vision-language-models-and-specialized-ocr
16. Fu, L. et al. _OCRBench v2: An Improved Benchmark for Evaluating Large Multimodal Models on Visual Text Localization and Reasoning._ NeurIPS 2025 D&B. https://arxiv.org/abs/2501.00321
17. Inoue, K. _Context-Independent OCR with Multimodal LLMs: Effects of Image Resolution and Visual Complexity._ mar 2025. https://arxiv.org/abs/2503.23667
18. Zhang, J. et al. _MLLMs Know Where to Look: Training-free Perception of Small Visual Details with Multimodal LLMs._ ICLR 2025. https://arxiv.org/abs/2502.17422
19. Google. _Introducing Agentic Vision in Gemini 3 Flash._ ene 2026. https://blog.google/innovation-and-ai/technology/developers-tools/agentic-vision-gemini-3-flash/
20. Qi, H. et al. _IndustryBench-MIPU: Benchmarking Multi-Image Attribute Value Extraction for Industrial Products._ jun 2026. https://arxiv.org/abs/2606.14383
21. Anthropic. _Structured outputs_ (docs). https://platform.claude.com/docs/en/build-with-claude/structured-outputs
22. Anthropic. _Vision_ (docs: límites de resolución, varias imágenes, limitaciones). https://platform.claude.com/docs/en/build-with-claude/vision
23. Google. _Structured outputs — Gemini API_ (docs). https://ai.google.dev/gemini-api/docs/structured-output
24. Google. _Gemini API: JSON Schema support and implicit property ordering._ 5 nov 2025. https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/
25. Google. _Media resolution — Gemini API_ (docs). https://ai.google.dev/gemini-api/docs/media-resolution
26. Google. _Image understanding — Gemini API_ (docs, `box_2d`). https://ai.google.dev/gemini-api/docs/image-understanding
27. Google AI Developers Forum. _Logprobs is not enabled for Gemini models_ (hilo, oct–nov 2025). https://discuss.ai.google.dev/t/logprobs-is-not-enabled-for-gemini-models/107989
28. OpenAI. _Structured model outputs_ (docs). https://developers.openai.com/api/docs/guides/structured-outputs
29. Tam, Z. R. et al. _Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of LLMs._ EMNLP Industry 2024. https://arxiv.org/abs/2408.02442 · respuesta de dottxt: https://blog.dottxt.ai/say-what-you-mean.html
30. Geng, S. et al. _JSONSchemaBench: A Rigorous Benchmark of Structured Outputs for Language Models._ 2025. https://arxiv.org/abs/2501.10868 · vLLM structured outputs: https://developers.redhat.com/articles/2025/06/03/structured-outputs-vllm-guiding-ai-responses
31. Dynamsoft (fabricante, sesgo). _1D Barcode Scanner Accuracy Benchmark: Dynamsoft vs. ZXing, ZBar, and Scandit._ act. jul 2026. https://www.dynamsoft.com/codepool/barcode-scanning-accuracy-benchmark-and-comparison.html
32. Barcode Test. _Why Do Barcodes Misread?_ https://barcode-test.com/barcode-quality-training/barcodes-misread/
33. Sec-ant. _zxing-wasm_ (ZXing-C++ en WebAssembly; web, Node, Bun, Deno). https://github.com/Sec-ant/zxing-wasm
34. Sec-ant. _barcode-detector_ (polyfill de la Barcode Detection API). https://github.com/Sec-ant/barcode-detector
35. Can I use: _BarcodeDetector API_. https://caniuse.com/mdn-api_barcodedetector · MDN: https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API · iOS sin la API: https://dev.to/ilhannegis/barcode-scanning-on-ios-the-missing-web-api-and-a-webassembly-solution-2in2
36. UPCGen. _UPC Check Digit Calculator: Formula, Worked Example, and Why It Exists._ https://upcgen.com/learn/upc-check-digit-calculator · HSM Kit, _Check Digits: Luhn, Mod 10_: https://hsmkit.com/guides/check-digits-luhn-mod10/ (verificado además con script propio)
37. GS1 / GTIN info. _GTIN data structures; ITF-14 y relleno con ceros._ https://www.gs1standards.info/gtin-data-structures/ · https://www.gtin.info/itf-14-barcodes-gtin-info/ · https://en.wikipedia.org/wiki/Global_Trade_Item_Number
38. Pan, L. et al. _Single Document Image Highlight Removal via A Large-Scale Real-World Dataset and A Location-Aware Network_ (DocHR14K). 2025. https://arxiv.org/abs/2504.14238
39. _Removal of Transparent Plastic Film Specular Reflection Based on Multi-Light Sources._ IEEE. https://ieeexplore.ieee.org/document/6271106/
40. _TextSR: Diffusion Super-Resolution with Multilingual OCR Guidance._ 2025. https://arxiv.org/abs/2505.23119
41. _Automatic blur detection in mobile captured document images: Towards quality check in mobile based document imaging applications._ IEEE. https://ieeexplore.ieee.org/document/6707602/
42. NIST SCTK. _ROVER._ https://github.com/usnistgov/SCTK/blob/master/doc/rover/rover.htm · _LV-ROVER: Lexicon Verified Recognizer Output Voting Error Reduction_: https://arxiv.org/abs/1707.07432 · _LV-ROVER-MLT_ (2026): https://arxiv.org/abs/2607.00250
43. _Weighted Edit Distance for Country Code Recognition in License Plates._ EUSIPCO 2022. https://eurasip.org/Proceedings/Eusipco/Eusipco2022/pdfs/0001111.pdf · librería: https://github.com/infoscout/weighted-levenshtein
44. _RAR: Retrieving and Ranking Augmented MLLMs for Visual Recognition._ https://pubmed.ncbi.nlm.nih.gov/41525633/
45. Microsoft. _Interpret and improve model accuracy and confidence scores_ (Azure Document Intelligence). https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/document-intelligence/concept/accuracy-confidence.md
46. _Rule of three (statistics)._ https://en.wikipedia.org/wiki/Rule_of_three_(statistics)
47. _False Sense of Safety in Selective Signal Classification: Auditing Bound Tightness and Exchangeability for Risk Control._ 2026. https://arxiv.org/abs/2606.15153
48. Angelopoulos, A. et al. _Conformal Risk Control._ https://arxiv.org/abs/2208.02814 · _Selective Conformal Risk Control_: https://arxiv.org/abs/2512.12844
49. Risk–coverage / AURC en predicción selectiva: _Entropy Alone is Insufficient for Safe Selective Prediction in LLMs_, 2026. https://arxiv.org/abs/2603.21172
50. _Exploring automation bias in human–AI collaboration: a review and implications for explainable AI._ AI & Society, 2025. https://link.springer.com/article/10.1007/s00146-025-02422-7
51. Husain, H. _A Field Guide to Rapidly Improving AI Products._ abr 2025. https://hamel.dev/blog/posts/field-guide/
52. Ferguson, N. et al. _ExtractBench: A Benchmark and Evaluation Methodology for Complex Structured Extraction._ feb 2026. https://arxiv.org/abs/2602.12247
53. _PaddleOCR 3.0 Technical Report_ (PP-OCRv5, PP-ChatOCRv4). jul 2025. https://arxiv.org/abs/2507.05595
54. Google Cloud. _Dense document text detection_ (símbolos con confianza y bbox). https://docs.cloud.google.com/vision/docs/fulltext-annotations
55. OpenAI. _Thinking with images._ abr 2025. https://openai.com/index/thinking-with-images/
