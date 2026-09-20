# Motor de reconocimiento de etiquetas — investigación y recomendación

> 15 sep 2026. Siete investigadores en paralelo, dos de ellos con **pruebas reales sobre las 15 fotos**
> de `01-lo-aprendido.md`. Los informes completos, con todas las fuentes, están en `research/R1…R7`. El
> arnés de la prueba (sin fotos ni salidas crudas: una trae datos personales) está en `bench/`.
>
> |     | Ángulo                                                                        |
> | --- | ----------------------------------------------------------------------------- |
> | R1  | OCR y modelos de visión abiertos (estado del arte sep 2026)                   |
> | R2  | APIs en la nube y LLMs de visión con salida estructurada; costes              |
> | R3  | Barras y OCR en el navegador/teléfono, **medido con las fotos**               |
> | R4  | Productos de logística que ya leen etiquetas; qué copiar                      |
> | R5  | Técnicas de precisión, alucinación de dígitos y evaluación                    |
> | R6  | Banco local: zxing + 4 OCR abiertos, **puntuado contra la verdad de terreno** |
> | R7  | App «servidor local» con modelos abiertos en Android (idea de Rafael)         |
>
> **16 sep 2026.** Tres informes más, escritos por Gemini 3.1 Pro lanzado con `agy` (Antigravity
> CLI) en vez de por agentes de Claude. Van aparte porque su nivel de evidencia es más flojo:
>
> |     | Ángulo                                                                |
> | --- | --------------------------------------------------------------------- |
> | R8  | Modelos de visión dentro del navegador en el S25 Ultra y el iPhone 16 |
> | R8b | Verificación de R8: refuta 3 de sus 6 afirmaciones centrales          |
> | R9  | Banco de modelos de visión sobre nuestras 13 fotos, por campo         |
>
> **18–20 sep 2026.** Dos informes empíricos adicionales:
>
> |     | Ángulo                                                                                    |
> | --- | ----------------------------------------------------------------------------------------- |
> | R10 | Evaluación empírica de 6 cajas nuevas: repuestos, contradicción multietiqueta y PO sample |
> | R11 | Barras en baja resolución, desenfoque macro y arquitectura de captura en vivo (cámara)    |

---

## 1. La respuesta corta

**No existe un motor que lo haga todo, y el mejor del mercado (Scandit Smart Label Capture) tampoco sabe
nada de Jamis ni del AS400.** Lo que gana, en la literatura y en nuestras fotos, es una **cadena de
fuentes independientes con un árbitro en código**:

```
foto(s) a resolución completa
  → BARRAS (zxing-wasm, en el teléfono)        verdad exacta cuando valida
  → LECTURA DE CAMPOS (modelo de visión)       qué número es cuál; daño; etiquetas apiladas
  → [OCR con posiciones, opcional]             evidencia y respaldo sin red
  → ÁRBITRO DETERMINISTA                       checksum, SKU canónico, hermanas, G.W.−N.W., origen por campo
  → CATÁLOGO PickD + AS400                     candidatos, "ninguno" siempre posible
  → PROPUESTA + la pregunta mínima             destino, ¿es nueva?
```

Ninguna pieza sola es fiable, y la evidencia es consistente: **el acuerdo entre fuentes distintas es la
única señal de confianza que funciona** (R5). La confianza que declara el propio modelo apenas sirve.

## 2. Lo que dijeron nuestras fotos (R3 + R6)

| Fuente                                                | SKU        | UPC/GTIN | G.W.               | Serie/frame | Tiempo       |
| ----------------------------------------------------- | ---------- | -------- | ------------------ | ----------- | ------------ |
| Barras (zxing, foto completa + mosaicos)              | 5/12 fotos | 8/10     | — (no va en barra) | 3/6         | ~0,7 s       |
| OCR PP-OCRv6 small                                    | 10/12      | 5/10     | 10/12              | 6/6         | ~2 s (M1)    |
| OCR PP-OCRv6 tiny, en Chrome (53 campos, 8 etiquetas) | —          | —        | —                  | —           | 44/53 campos |
| Tesseract.js v7 (mismos 53)                           | —          | —        | —                  | —           | 20/53        |
| **Barras + PP-OCRv6 small, por caja**                 | **11/11**  | **8/9**  | **9/11**           | **6/6**     |              |

**Hallazgos que cambian el diseño:**

1. **Las barras no dieron ni una lectura falsa.** El dígito de control descartó 7 lecturas internas malas.
   Donde fallan es donde no hay barra (el tipo B no trae la del SKU; la D no trae ninguna).
2. **Las etiquetas A llevan un QR** con código de fábrica, frame, cantidad, carton y lote, y la barra
   `ITEM` es un **Code 39 con el SKU**. En la cara dañada de 03-4149BR dio `03-4149BR` exacto: el dígito
   que en la sesión manual hubo que razonar. Code 39 no lleva checksum (macOS leyó `P1G3` donde el QR
   dice `P1493`), así que sólo vale confirmado por otra fuente.
3. **En el tipo A, el UPC sólo sale de la barra.** Los dígitos van partidos alrededor de ella
   (`8 45436 09295 9`) y el OCR los pega mal.
4. **La resolución importa:** a 1280 px (lo que hacen hoy `useBarcodeScanner` y `useQRScanner`) salieron
   15 barras; a 12 MP 26, y juntando pasadas 33, de ~44 visibles.
5. **El OCR, ante daño, no calla: inventa con forma válida.** Un trazo de rotulador hizo que los cinco
   PP-OCR leyeran `03-4143BR` donde el Code 39 decía `03-4149BR`. Confusiones confirmadas: `I→1`
   (`M21I→M211`, ×10), `8→9` en un GTIN, `3→2` en un peso (`20.30→20.20`). El checksum atrapa las del
   UPC; las de serie y peso pasan.
6. **Ligar valor y etiqueta es un problema de posición:** por orden de lectura se acierta el G.W. en 5–9
   de 12; por geometría, 9–11. Eso es lo que un modelo de visión hace bien (01 §5).
7. **Texto blanco sobre negro no afecta a PP-OCR**; el daño físico sí.

## 3. Cada capa: qué usar

### 3.1 Barras — en la PWA, siempre

- **`barcode-detector` (zxing-wasm 3.1, gratis, ~0,9 MB)** + el `BarcodeDetector` nativo cuando exista,
  uniendo resultados. Foto con `ImageCapture.takePhoto()` a resolución completa, decodificada entera y en
  mosaicos 2×2/3×3, dentro de un Worker. Validación: checksum UPC/GTIN, prefijo 845436, lectura del QR;
  Code 39 sólo con confirmación.
- Comercial sólo si se pasa a vídeo en vivo con muchas barras a escala: STRICH (desde €99/mes), Scandit
  (cotización) (R3, R4).

### 3.2 Lectura de campos — modelo de visión en la nube, primero

- **Principal: Gemini 3.8 Flash** (nº 1 de 53 en la prueba pública más parecida, Roboflow «Data
  Extraction», 97,3 %; razonamiento bajo o tarda hasta 57 s). **Verificador: Claude Sonnet 5**, mejor
  copiando carácter a carácter (91,7 %), en el ~20 % dudoso. Distinto proveedor: errores y caídas no
  correlacionados (R2).
- **Coste** (6.000 fotos/mes): ~$65 hasta dic 2026, ~$101 desde ene 2027 con Gemini + Claude en lo dudoso.
  La decisión es de acierto, no de precio.
- **Descartados como motor:** Cloud Vision, Textract, Azure y Document AI devuelven texto sin nombre o
  cobran $15–30 por 1.000 fotos preguntando campo a campo; Mistral OCR pierde la disposición; Haiku 4.5
  lee peor y puede retirarse desde el 15 oct 2026.
- **Cómo:** Edge Function `recognize-label` que sólo orquesta (R1: no puede alojar modelos: 256 MB, 2 s
  de CPU). Foto en un **bucket privado** con URL firmada de 5 min, nunca en el R2 público.

### 3.3 Modelos abiertos propios — la alternativa si la nube no conviene

- **Qwen3.5-4B → 9B** (Apache 2.0): el único abierto y permisivo que sigue un esquema largo con reglas y
  acepta varias fotos más el texto del OCR; ~3/6 GB en 4 bits, llama.cpp con JSON restringido. **GLM-OCR
  0.9B** (MIT) como segundo lector; HunyuanOCR-1.5 en A/B (su licencia excluye UE/UK/Corea: vale en EE.
  UU., hay que dejarlo escrito). Correrían en el Mac de Bay 2 o en una GPU (R1).
- **Descartados por licencia:** LayoutLMv3, Qwen2.5-VL-3B y Nanonets-OCR2-3B no permiten uso comercial;
  Surya 2 y Chandra 2 sólo son gratis por debajo de 5 M / 2 M USD. **Por abandono:** EasyOCR, MMOCR.
- **OCR con posiciones en el navegador:** PP-OCRv6 tiny (~6 MB) con `ppu-paddle-ocr/web` en un Worker,
  ~5–7 s por foto estimado en un Android medio sin WebGPU. Sirve de evidencia para el modelo de visión
  (imagen + texto OCR es lo que mejor funciona, ConfBench 2026) y de respaldo sin red (R3).

### 3.4 En el teléfono, sin internet (R7, la idea de Rafael)

- **Funciona hoy, pero no es más rápido que la nube, y en gama media no sirve.** Runtime **LiteRT-LM**
  (el mismo de AI Edge Gallery, Apache 2.0, con salida a esquema JSON desde jul 2026) y **Gemma 4 E4B**
  (12 GB) / **E2B** (8 GB), las únicas con builds oficiales de Android y resolución de imagen variable.

  | Dónde                                                | Por foto           |
  | ---------------------------------------------------- | ------------------ |
  | Gama alta (clase Galaxy S26 Ultra), GPU, Gemma 4 E2B | ~4–8 s             |
  | Mismo teléfono, E4B                                  | ~8–16 s            |
  | Gama media (Pixel 8a, Galaxy A55), CPU               | ~45–60 s, inusable |
  | Nube, Gemini 3.8 Flash / Sonnet 5                    | ~7 s / ~3 s        |

  _Estimaciones desde benchmarks publicados, no medidas con nuestras fotos._

- **Precisión:** en el IDP Leaderboard, Gemma 4 E4B 53,9 contra 82,0 de Gemini 3 Flash. Y los pequeños
  fallan justo en las cajas difíciles (dañadas, apiladas, dos caras).
- **Integración robusta:** app Android delgada que muestra `pickd.pages.dev` en un WebView y pasa mensajes
  **sólo a ese origen**. Sin puerto abierto, sin permiso de red local, y el deploy por push sigue igual.
  **Servidor en `127.0.0.1`: no para producción.** Chrome 142+ pide permiso de red local, el servicio
  en segundo plano tiene tope de 6 h/día en Android 15+, cualquier app del teléfono alcanza el puerto, y
  Gemini Nano se niega a correr en segundo plano. Sirve para medir: **OlliteRT** (Apache 2.0) expone
  LiteRT-LM como API estilo OpenAI en un día de trabajo.
- **Riesgos:** GPUs inestables según el modelo de teléfono (basura en A55, sin OpenCL en Pixel 8, falla en
  Pixel 9 tras 1–3 turnos) → lista blanca de teléfonos + nube de respaldo. ~20 % de batería a 200 fotos/
  día y 2,6–3,7 GB de descarga por teléfono.
- **Umbral propuesto antes de construir la app nativa:** ≥ 90 % por campo verificable, 0 dígitos
  inventados que pasen los validadores y ≤ 10 s por caja, medido con las 15 fotos en AI Edge Gallery.

## 4. Técnicas que deciden la precisión (R5, priorizadas)

1. **Árbitro determinista con origen por campo** (`barra | leído | derivado | catálogo | humano`). Un
   valor de un solo canal o derivado nunca se auto-acepta en SKU/UPC.
2. **Salida «tal como está impreso»:** `?` por carácter ilegible, `null` permitido y la legibilidad antes
   que el valor. El modelo no normaliza ni calcula: eso es código. **Forzar la forma sin permitir `null`
   obliga a inventar un valor bien formado** (R1).
3. **Banco de evaluación antes de afinar prompts.** Tres condiciones: una persona re-verifica la verdad de
   terreno (la leyó Claude); se evalúa contra el catálogo **de antes** de la sesión (5 de 13 cajas ya se
   dieron de alta); y ~300 casos sintéticos con dígitos tapados para medir cuánto inventa cada motor.
4. **Captura con compuertas:** blur/reflejo detectados al disparar, dígitos de ≥ ~30 px, recorte por
   etiqueta a resolución nativa. Nada de super-resolución generativa.
5. **Dos canales independientes y una escala de evidencia A–D** en vez de logprobs (AUROC 0,705; Gemini
   2.5 Flash ni los devuelve). Mejor **barra + VLM** que dos VLMs: dos modelos coinciden en el 60 % de los
   casos en que ambos fallan (ICML 2025).
6. **Catálogo como prior fuera del modelo:** candidatos por UPC, SKU canónico, distancia que castiga
   menos los glifos confundibles, modelo+talla+color y serie. **Nunca la lista de SKUs como enum cerrado:**
   el 38 % de nuestras cajas fueron altas nuevas y las habría forzado a un SKU existente.
7. **Una lectura por foto y fusión en código,** comprobando con frame/carton que es la misma caja. Meter
   todas las fotos en un prompt cuesta 15–34 puntos de recall.

**Despliegue:** sombra → asistido → automático **por tipo de campo** tras ≥ 300 aceptaciones seguidas
sin error silencioso (cota ≤ 1 %). Con 13 cajas sólo se puede afirmar un error silencioso < ~20 %.
Auditoría: en el 5–10 % de las cajas aceptadas, el operario teclea sin ver la propuesta (con el valor
precargado lo confirma sin mirar). Un error silencioso devuelve el campo a asistido.

## 5. Qué copiar de los mejores (R4, R1)

1. **Un esquema por tipo de etiqueta (A–F)**: cada campo con ancla (`G.W.`), patrón, obligatorio y
   posición; valor o `null`, texto crudo, legibilidad y recuadro como evidencia. Es Smart Label Capture
   de Scandit.
2. **Barras primero y cruzadas con el texto**: una barra válida es verdad; si contradice al modelo, baja
   la confianza de esa foto.
3. **Captura guiada**: lista de campos en verde/ámbar/gris, recorte que respalda cada dato, teclear lo
   que no se lee, varias caras de la caja.
4. **Confianza por señales**, no declarada: checksum, forma del SKU, acuerdo entre caras y entre barra y
   texto, G.W.−N.W.
5. **Tabla de excepciones con el catálogo** (Vimaan): cero o varias coincidencias → no se escribe nada. Y
   un registro de lo aceptado/corregido que hace crecer el set de prueba solo (como Open Food Facts, que
   también lee las barras aparte porque su modelo de visión no las lee).
6. **Orientación y rectificación** antes del OCR; **alfabeto restringido por campo** (docTR 1.1).
7. **Prueba de dígitos corruptos**: tapar o alterar un dígito en fotos reales y ver si el motor lo
   reporta, lo marca dudoso o lo «corrige» hacia el catálogo.

## 6. Recomendación

**Construir sobre piezas abiertas + nube, no comprar un SDK, y no empezar por el modelo en el teléfono.**
Con fotos (no vídeo), decenas de cajas al día y una PWA, cualquier diseño razonable cuesta < $200/mes y la
precisión la dan las barras y el árbitro, no el modelo más caro.

| Fase                                   | Qué                                                                                                                                                                                                                                                                                  | Por qué primero                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **F0 · Banco**                         | Re-verificar la verdad de terreno a mano; arnés que pase barras + OCR + Gemini + Sonnet (y Gemma 4 si hay teléfono) por el banco (ampliado a 19 cajas / 20 fotos en R10); métricas por campo y error silencioso; test de dígitos tapados y etiquetas contradictorias. < $2 en APIs.  | Sin esto, cada decisión posterior es opinión.                           |
| **F1 · Barras bien hechas**            | `useBarcodeScanner`/`useQRScanner` a resolución completa, varias barras por foto, QR de las A, Code 39 con confirmación. Si una caja tiene etiquetas contradictorias o múltiples lecturas, mostrar ambas y dejar que la persona elija en vez de resolver en silencio (hallazgo R10). | Útil hoy en todo PickD, y es la fuente que no inventa.                  |
| **F2 · Motor en sombra**               | Edge Function `recognize-label` + bucket privado + tabla `label_scans` (fuera de Realtime). El flujo manual sigue; se compara lo que el motor habría propuesto.                                                                                                                      | Mide en el piso real sin riesgo.                                        |
| **F3 · Asistido**                      | Pantalla de captura guiada con checklist por campo y evidencias; la persona confirma destino y «¿es nueva?»; auditoría a ciegas del 5–10 %.                                                                                                                                          | Donde se ahorra el trabajo.                                             |
| **F4 · Automático por campo**          | Tras ≥ 300 aceptaciones sin error silencioso en ese campo.                                                                                                                                                                                                                           | La cota lo permite.                                                     |
| **F-local (en paralelo, condicional)** | Inventario de teléfonos (chip, RAM). Si hay gama alta ≥ 8 GB: las 15 fotos en AI Edge Gallery con Gemma 4 E2B/E4B, y prototipo con OlliteRT. Si pasa el umbral de §3.4: app nativa delgada con WebView.                                                                              | Sin internet y sin coste por foto, pero sólo si el hardware lo aguanta. |

## 7. Hallazgos en el repo (arreglar independientemente)

- `useBarcodeScanner.ts` y `useQRScanner` reducen la foto a **1280 px** y el respaldo `@zxing/browser`
  devuelve **una sola barra**. En iPhone no hay detector nativo.
- `VITE_OPENAI_API_KEY` sigue declarada en `src/vite-env.d.ts:5` y `.env.example:7`. Toda `VITE_*` llega
  al navegador: quitarla.
- El bucket R2 de fotos es **público**: las fotos de etiquetas no pueden ir ahí.
- `CLAUDE.md` dice «AI: Gemini 2.5 Flash + GPT-4o», pero no hay ninguna integración de IA en `src/` ni en
  `supabase/functions/`. Esa línea está desfasada.
- Brave altera la lectura de imágenes del canvas: desactivarle la protección de huella para
  `pickd.pages.dev` o las barras leídas desde canvas pueden salir corruptas.

## 8. Lo que falta decidir (Rafael)

1. **¿Qué teléfonos hay en el piso?** Chip y RAM. Decide si F-local tiene sentido.
2. **¿Se aceptan fotos de etiquetas en Google y Anthropic?** No llevan datos del cliente salvo las de
   FedEx; se pueden recortar a la etiqueta de Jamis antes de enviar.
3. **¿Arrancamos F0?** Es la base de todo lo demás y cuesta < $2.

## 9. No verificado todavía

- Ningún tiempo en Android se midió: todos son estimaciones desde un Mac M1 y benchmarks publicados.
- Precios de Scandit, PackageX, Vimaan y Zebra: no son públicos.
- Si Gemini y Claude respetan `pattern` en la salida estructurada, y la latencia real con varias fotos por
  caja.
- Cuánto tarda el codificador de imagen de Gemma 4 en una GPU de teléfono: no está publicado.
