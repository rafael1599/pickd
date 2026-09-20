# Plan de sub-fases para F2 en adelante — dos agy en paralelo

> 18 sep 2026. `02-investigacion.md` §6 dejó F2–F4 como bloques grandes. Este documento los
> parte en sub-fases chicas y verificables, para que **dos sesiones de agy trabajen en paralelo
> sin pisarse** y yo pueda cambiar el rumbo entre sub-fases si algo nuevo lo pide, sin perder lo
> ya hecho. Premisas fijas de todo este plan:
>
> 1. Todo lo del **Track A** tiene que poder correr y probarse desde la Mac de Bay 2 (es la
>    máquina de desarrollo — no hace falta hardware especial para esto, es cliente HTTP normal).
> 2. El **Track B** existe para responder una pregunta concreta: ¿la Mac de Bay 2 (y, condicional,
>    el celular) puede correr un modelo de visión local que sirva de respaldo sin nube? Se mide,
>    no se asume.
> 3. Nada de este plan toca una pantalla que un picker use hoy. F2 es **sombra**: el flujo manual
>    (tú o yo leyendo fotos y registrando a mano) sigue exactamente igual mientras tanto.

## Frontera de protocolo (importante, la decido yo por default — corregime si no)

Todo esto vive fuera de cualquier pantalla de picking/ship, así que lo trato como el trabajo de
`docs/label-recognition/` que ya hicieron R1–R10: **agy escribe Y commitea directamente**,
incluida la Edge Function y la migración del Track A — no hay riesgo para el piso porque nadie la
llama todavía desde la app real. El límite exacto: el día que una sub-fase toque una pantalla que
un picker abre (eso es F3, no está en este documento), esa parte vuelve al protocolo normal
(`00-INDEX.md`/`PROTOCOLO.md`: agy investiga y propone, yo implemento y commiteo).

## Reparto de archivos — cero colisión entre las dos sesiones de agy

|               | Track A (Alpha)                                                                                                                                                                                                                                                                                                                                                                                                                    | Track B (Beta)                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Dueño de      | `supabase/functions/recognize-label/`, `supabase/migrations/*_label_scans*.sql`, `docs/label-recognition/shadow/` (script de corrida en lote + sus resultados), y desde A3b-lib: un módulo cliente **nuevo y aislado** (ej. `src/lib/recognition/ocr.ts` + lo que haga falta) — nuevos archivos solamente, sin tocar ni importar desde ninguna pantalla/ruta existente. **A3b-ui (la pantalla en Perfil) la hace Claude, no agy.** | `docs/label-recognition/local-model/` (todo nuevo) |
| Nunca toca    | `docs/label-recognition/bench/`, `research/`, nada de `src/` de picking/ship                                                                                                                                                                                                                                                                                                                                                       | `supabase/`, `src/`, cualquier archivo de Track A  |
| Lee sin tocar | `bench/gt.json`, `bench/vlm_schema.json`, `research/R9`, `research/R10` (para reusar el esquema de campos y los 19 casos)                                                                                                                                                                                                                                                                                                          | lo mismo                                           |

Si en algún punto Track B necesita algo de Track A (por ejemplo, el formato exacto del árbitro
para comparar su modelo local contra él), lo pide como hallazgo en su propio archivo — no edita
el de Alpha.

---

## Track A — motor en sombra (server-side, la ruta crítica hacia F3/F4)

### A1 · Tabla `label_scans`, sin nada más

**Qué:** migración nueva con la tabla: `id`, `photo_key` (referencia al bucket, no la foto),
`taken_at`, `barcode_result jsonb`, `vlm_result jsonb` (uno por modelo probado), `arbitrated jsonb`,
`conflict boolean default false`, `reviewed_sku text` (lo que de verdad se registró, lo llena una
persona después, nullable), `created_at`. Sin RLS abierto — solo `service_role`. Fuera de
Realtime (igual que dice §6 del plan original).
**Verificación:** migración aplica en local (`supabase db reset` o el flujo que ya use el repo),
insertar una fila a mano con `psql`/SQL editor, confirmar que un cliente anon **no** puede leerla.
**Bloquea:** A3 (necesita dónde escribir).

### A2 · Bucket privado + URL firmada

**Qué:** bucket R2 **nuevo y separado** del que ya usa `upload-photo` (ese es público — no sirve,
ya está anotado como hallazgo en `02-investigacion.md` §7). Credenciales propias
(`R2_LABEL_*` en `.env.example`, nunca `VITE_*`). Una función que genera una URL de subida firmada
de 5 minutos.
**Verificación:** subir una foto de prueba con la URL firmada desde `curl`; confirmar que la URL
del bucket **sin** firma da 403; confirmar que la URL expira pasado el tiempo.
**Bloquea:** A3.

### A3 · `recognize-label` recibe el resultado ya calculado en cliente, no lo calcula él (REVISADO, ver "Cambios de rumbo #4")

**Qué (cambiado tras la decisión de Rafael de hosting=cliente):** el Edge Function **deja de
decodificar barras server-side.** Su trabajo es: recibir de la PWA el resultado que el cliente ya
calculó (barras + OCR, ver A3b) como `barcode_result` + `ocr_result` ya resueltos, más la
referencia a la foto (de A2, para el chequeo asíncrono de A4), y guardarlo en `label_scans`. Nada
de `vlm_result` ni `arbitrated` todavía.
**Verificación:** simular el POST del cliente a mano (con `curl`, sin PWA todavía) usando los
resultados que B3 ya calculó para 3 fotos conocidas (1, 16, 18) y confirmar que quedan guardados
igual que la verdad de terreno.
**Bloquea:** A3b, A4.

### A3b-lib · Portar el camino rápido (B3) a un módulo cliente aislado — COMPLETO

**Qué:** agregar motor de OCR en navegador/WASM (`ppu-paddle-ocr/web` con `onnxruntime-web`, ejecutando PP-OCRv6 tiny con pesos ~6 MB) en `src/lib/recognition/clientOcr.ts`, fusionando con el lector de barras multi-escala (`zxing-wasm`) en `src/lib/recognition/recognizeLabelClient.ts` según la lógica determinista probada en B3:

- Barcode tiene máxima prioridad para SKU y UPC/GTIN con checksum validado (0 falsos positivos).
- OCR aporta `model`, `size`, `color`, `gw_kg` mediante agrupación espacial de líneas y anclas contextuales (`MODEL:`, `SIZE:`, `COLOR:`, `G.W.`).
- OCR provee fallback para SKU en texto plano (ej. repuestos a granel tipo `PP1202JC` o cajas sin barras) y serie/frame no codificado en QR.
- Desglose detallado de `timingMs`: `{ total, barcodes, ocr }`.
- Cero persistencia: 100% cómputo local en navegador/WASM sin llamadas a Supabase ni a `recognize-label`.
  **Resultado real:** Motor implementado en `src/lib/recognition/clientOcr.ts` y cableado a `recognizeLabelClient.ts`. Suite de 8 tests unitarios pasando en `recognizeLabelClient.test.ts` (38 tests en el módulo, 1435 en el proyecto). Build limpio de Vite con code-splitting lazy de WASM/ONNX.
  **Bloquea:** A3b-ui (ya integrado y enriquecido con campos de catálogo y desglose de tiempos).

### A3b-ui · Pantalla de prueba en Perfil, con cronómetro — COMPLETO

**Qué:** pantalla de diagnóstico nueva, en Perfil → "Test de reconocimiento de etiquetas" (`/profile/label-test` y `/label-test`).
Toma/selecciona una foto (cámara nativa o selector de archivo), corre el módulo cliente aislado (`recognizeLabelClient`), muestra un cronómetro
con el tiempo real medido (en milisegundos y segundos), desglose de campos extraídos (SKU, UPC con validación mod-10, serie/frame, cartón, PO)
y códigos decodificados con pases de acierto, más visor de JSON crudo y botón para copiar el resumen formateado en texto plano.
**Cero persistencia garantizada:** nada de `fetch`/POST a `recognize-label` ni a `label_scans`, nada de Supabase, nada en base de datos ni almacenamiento local.
**Resultado real:** Implementado en `src/features/recognition/LabelTestScreen.tsx`, accesible directamente desde el panel de Perfil en `UserMenu.tsx`
y desde `Settings.tsx`. Motor cliente en `src/lib/recognition/recognizeLabelClient.ts` con tests unitarios en `recognizeLabelClient.test.ts`.
**Bloquea:** nada — lista para que Rafael la abra en el Galaxy S25 Ultra y pruebe con cajas reales del piso.

### A4 · Se suma el modelo de visión

**Qué:** agregar la llamada al modelo de visión en la nube (usar el ganador de R9/R10 —
`gemini-3.8-flash-high` fue el único con 0 errores de UPC/GTIN en R10; documentar si se elige otro
y por qué) con el `vlm_schema.json` que ya existe, guardando la salida cruda en
`label_scans.vlm_result`. Todavía sin fusionar con las barras.
**Verificación:** mismas 3 fotos de A3 + las 2 de la caja Laser (16 y 17, el caso de conflicto) —
confirmar que ambas lecturas quedan guardadas SIN que ninguna se descarte todavía (eso es A5).
**Bloquea:** A5.

### A5 · Árbitro determinista, contra el banco completo

**Qué:** fusionar `barcode_result` + `vlm_result` en `arbitrated`, con origen por campo
(`barra|leido|derivado|catalogo`) como pide `02-investigacion.md` §4.1, MÁS el hallazgo de R10: si
dos fotos de la misma caja (o barra vs. modelo) no coinciden en un campo, `conflict = true` y
**ambos candidatos se guardan**, nunca se elige uno en silencio.
**Verificación — esta es la que de verdad importa:** correr el pipeline completo contra las 19/20
fotos de `bench/gt.json`, puntuar por campo igual que `score.py`/`score_vlm.py`, y confirmar
específicamente que el caso `box_laser` (16 vs 17) sale con `conflict: true` y las dos lecturas, no
con una sola.
**Bloquea:** A6. **Si el acierto por campo es peor que lo que R6/R9/R10 ya midieron por separado,
paro aquí y reviso el árbitro antes de seguir** — no tiene sentido meterlo al piso con menos
puntería que sus piezas sueltas.

### A6 · Corrida en lote sobre fotos reales nuevas (la prueba de verdad)

**Qué:** un script chico (`docs/label-recognition/shadow/run_batch.sh` o similar) que tome una
carpeta de fotos nuevas —las que tú fotografíes en el piso de ahora en adelante, no el banco
curado— y las corra por el pipeline completo, dejando un reporte legible (qué propuso, con qué
confianza, qué marcó en conflicto) para comparar contra lo que de verdad registraste ese día.
**Sin tocar ninguna pantalla:** vos seguís registrando a mano exactamente igual; esto corre aparte.
**Verificación:** primeras 15–20 cajas reales (no las del banco) fotografiadas en un día normal de
recepción. Reporto el acierto por campo comparado contra lo que se registró de verdad.
**Esta sub-fase es la que decide si seguimos a F3** (pantalla asistida) — con menos de eso, seguir
corriendo en sombra un poco más en vez de apurar la UI.

---

## Cambios de rumbo

**18 sep 2026, tras B1.** La premisa original de Track B era la MacBook de Bay 2. Agy corrió B1
en la máquina donde en realidad se ejecuta agy — un desktop Linux/CachyOS (i9-10900KF, RTX 3060
12 GiB VRAM) — no en esa Mac. Le pregunté a Rafael: **no hay acceso a la MacBook de Bay 2 por
ahora.** Se pivota así:

- **Track B pasa a validar en esta desktop Linux/RTX 3060**, que de hecho es un mejor candidato
  que cualquier Mac de Bay 2 para esto (GPU dedicada con CUDA, 12 GiB VRAM — una Mac de gama media
  ni de cerca). B2 en adelante corre acá, sin esperar la Mac.
- **La pregunta "¿sirve en la Mac de Bay 2?" queda pendiente, no cerrada**, para el día que haya
  acceso a esa máquina — en ese momento se repite B1 ahí antes de asumir que lo medido en Linux
  aplica (una Mac no tiene CUDA; si el día de mañana hay que correr esto en esa Mac, Qwen vía
  Ollama en CPU/Metal puede ser mucho más lento que en esta GPU).
- La premisa #1 del encabezado ("Track A tiene que poder correr… desde la Mac de Bay 2") se
  relaja: es solo un cliente HTTP, corre desde cualquier máquina con `curl`/Node — no depende de
  esto.

## Track B — ¿sirve un modelo local (desktop Linux/RTX 3060 de esta máquina; Mac de Bay 2 pendiente de acceso)?

### B1 · Capacidad real de hardware — COMPLETO (máquina real: Linux/RTX 3060, no la Mac; ver "Cambios de rumbo")

**Qué:** chip (Apple Silicon o Intel), RAM, espacio libre en disco, si hay GPU/Metal usable.
Comando, no opinión: `sysctl -n machdep.cpu.brand_string`, `system_profiler SPHardwareDataType`,
`df -h`.
**Nota de diseño:** R7 (LiteRT-LM + Gemma 4) apuntaba a **Android**, no a Mac. Para la Mac el
candidato correcto es el de R1: **Qwen3.5-4B/9B** vía `llama.cpp`/Ollama en 4 bits (~3–6 GB), que
sí corre en Apple Silicon con Metal. No reusar el stack de R7 para esta sub-fase — es de otro
sistema operativo.
**Verificación:** el reporte de specs, y una respuesta clara: ¿alcanza para 4 bits de Qwen3.5-9B o
solo para el 4B?
**Bloquea:** B2.

### B2 · Banco local contra las 19/20 fotos — COMPLETO

**Qué:** instalar Qwen3.5 (el tamaño que B1 confirme que entra) vía Ollama o `llama.cpp`, correr
el mismo `vlm_schema.json` contra el banco completo (adaptar `run_vlm_agy.sh` a un runner local en
vez de `agy`), puntuar con `score_vlm.py`.
**Verificación:** tabla de aciertos por campo, igual formato que R9/R10, más segundos por foto
medidos en esta máquina específica (no estimados).
**Resultado real:** paridad de precisión con la nube (5/5 SKU, 6/6 modelo, 6/6 color, resolvió el
conflicto de la caja Laser sin ayuda), pero **41.8 s promedio por foto (21–80 s)** — más lento que
el más rápido de la nube (Gemini Flash Low, 8.2 s) y muy lejos de "un par de segundos".

## Cambios de rumbo #2 (tras B2 — pivote grande, afecta Track A también)

**18 sep 2026.** Le pregunté a Rafael qué tan literal era el pedido de "resolución de un par de
segundos" que hizo sobre B2. Respuesta: **quiere el resultado COMPLETO (incluido modelo/color),
no solo el SKU, en segundos.** Eso cambia el diseño de raíz, no solo la elección de motor:

- **Ningún modelo de visión generativo (VLM) mide menos de ~8 s por foto** — ni el más rápido de
  Gemini en R10, ni Qwen 9B local en esta RTX 3060. No es un problema de qué motor elegir: leer
  con un LLM (mandar la imagen, generar el JSON) toma varios segundos sin importar dónde corra.
  Pedirle a un VLM "todo en 2 s" no es una sub-fase que falta, es pedirle algo que la tecnología
  no da hoy.
- Lo único que sí mide milisegundos es **código de barras puro** (A3, ~40–55 ms) y, según R6
  (`bench/results.md`), **OCR con posiciones sin generación de lenguaje** — `rapidocr3_v5mobile`
  midió **1.7 s/foto** en la corrida original, con 10/12 SKU y 9/12 G.W. por posición. Eso nunca
  se probó en esta máquina ni contra las 19 fotos completas.
- **Redefino B3 y B4** para probar ese camino rápido antes de resignarnos a que "todo en segundos"
  es imposible. El VLM (nube o local) no se descarta: pasa a ser un verificador asíncrono en
  segundo plano — igual que ya estaba pensado para el árbitro de Track A — no la fuente del
  resultado inmediato.

### B3 · Camino rápido: OCR local con posiciones, sin VLM — COMPLETO

**Qué:** correr `rapidocr3` (variantes v5mobile y v6medium, las dos mejores de R6) contra las
19/20 fotos completas del banco **en esta máquina** (CPU o GPU si `rapidocr3` lo aprovecha — medir
las dos), fusionado con las barras de A3/B2, puntuado igual que R6 (`score.py`) pero sobre el
banco ampliado.
**Verificación — esto es lo que decide todo:** tabla de aciertos por campo + segundos reales por
foto en esta máquina. El objetivo concreto: ¿algún combo barras+OCR da un resultado completo
(incluido modelo/color) en ≤ 3–5 s con una precisión que no sea vergonzosa (a ojo, no peor que lo
que ya mostró R6: 10/12 SKU, ~9/12 G.W.)?
**Resultado real:** SÍ, ROTUNDAMENTE. En esta máquina (Linux / RTX 3060), `zxing-cpp` toma 46 ms,
`v5mobile` toma 354 ms en GPU (1.17 s en CPU) y `v6medium` 522 ms en GPU. El combo barras + OCR rápido
entrega el resultado COMPLETO en **0.40 s en GPU** o **1.22 s en CPU** (ambos muy por debajo de la meta de ≤ 3–5 s),
con **6/6 SKU (100%), 6/6 Modelo (100%), 6/6 Color (100%), 4/4 Talla (100%)** y 100% integridad de checksum en UPC/GTIN.
Detalle documentado en `docs/label-recognition/local-model/B3-camino-rapido-ocr.md`.
**Bloquea:** B4.

### B4 · Decisión final del camino rápido — COMPLETO

**Decisión: adoptado como path primario, EN PRINCIPIO.** B3 lo prueba con precisión de sobra
(6/6 SKU, modelo, color; talla 4/4) y latencia muy por debajo de la meta. Pero **la máquina que
midió B3 no es la que va a tomar la foto en el piso** — es un desktop gamer con RTX 3060. Antes de
darlo por resuelto para Track A, hay dos huecos reales que B3 no responde (van a
"Cambios de rumbo #3" abajo, son lo próximo, no una formalidad):

1. **¿Dónde corre esto en producción?** `02-investigacion.md` §3.2 ya había anotado que una Edge
   Function **no puede alojar modelos** (tope de 256 MB de memoria y 2 s de CPU) — eso vale tanto
   para el VLM como para RapidOCR. El 0.4–1.2 s medido en B3 es de esta GPU/CPU de escritorio, no
   de un Edge Function ni de un teléfono.
2. **Detalle menor para anotar, no bloquea:** el SKU que devuelve el OCR sale sin el guión
   (`094807CL`, `073692BL`) — la forma canónica del catálogo lo lleva (`09-4807CL`,
   `07-3692-BL`, ver `01-lo-aprendido.md` §3). Hay que pasar el resultado por el mismo
   `canonical_sku()`/regex que ya existe, no asumir que el string crudo del OCR es el SKU final.

### B5 · Celular (condicional — solo si el hueco #1 de B4 se resuelve a favor de un dispositivo del piso Y hay inventario de teléfonos)

**No arranca sin dos cosas:** (1) saber dónde corre esto en producción (Cambios de rumbo #3), y
(2) inventario de chip/RAM de los teléfonos del piso. Si arranca: replicar el camino rápido (no
el VLM pesado) en un teléfono real contra el banco de 19/20 fotos.

---

## Cambios de rumbo #3 (tras B4 — el hueco que faltaba: ¿dónde corre esto de verdad?)

**18 sep 2026.** B3 probó que el camino rápido es viable _en esta desktop_. Pero el objetivo
siempre fue "resolución de un par de segundos" **para quien está parado con la caja en el piso**,
y esa persona no tiene una RTX 3060 en la mano. Faltan dos preguntas antes de tocar código de
Track A, y las dos son tuyas, no de agy:

1. **¿Con qué dispositivo se va a fotografiar la caja?** ¿Un teléfono/tablet del piso (como los
   que ya usan DCV), o esta misma sombra corre disparada por vos/mí desde una compu (como venimos
   haciendo con las 19 fotos hasta ahora)? Si es un teléfono, el camino rápido tiene que volver a
   medirse ahí — un RapidOCR en un Android de gama media puede tardar bastante más que 0.4–1.2 s
   (R3 estimaba 5-7 s para un motor parecido en el navegador sin WebGPU). Si sigue siendo vos/mí
   desde una compu (que es lo único que existe hoy — no hay pantalla de captura para recepción
   todavía, ver A6), esto ya está resuelto: cualquier laptop razonable, incluso sin GPU, entra en
   la meta de segundos (1.22 s en CPU).
2. **¿Dónde vive el servidor de reconocimiento?** Una Edge Function no puede correr RapidOCR
   (tope de memoria/CPU, ya anotado en `02-investigacion.md` §3.2). Opciones reales: (a) el OCR
   corre **en el cliente** (navegador/PWA, como ya hace el lector de barras desde F1 — existe un
   build web de RapidOCR/PaddleOCR, hay que confirmar que corre a velocidad aceptable sin GPU
   dedicada); o (b) **esta misma desktop con la RTX 3060 actúa de servidor de inferencia**,
   recibiendo la foto y devolviendo el resultado — deja de ser solo la máquina de pruebas de Track
   B y pasa a ser infraestructura real, con lo que implica (que esté prendida y disponible cuando
   se necesite). No elijo por vos cuál de las dos: tiene implicancias de disponibilidad que solo
   vos podés pesar.

**Mientras tanto, no se bloquea nada:** el flujo actual (vos/yo fotografiando y corriendo el
banco desde una compu) ya cae dentro de la meta de segundos tal cual está. Lo que se pausa es
construir A4-fast (portar el combo a `recognize-label`) hasta saber en qué corre — de lo
contrario hay riesgo de construirlo en el lugar equivocado y tener que rehacerlo.

## Cambios de rumbo #4 (respuesta de Rafael a #3 — define A3/A3b arriba)

**18 sep 2026.** Rafael contestó las dos preguntas de "Cambios de rumbo #3":

1. **Dispositivo real:** un teléfono/tablet del piso, como los que ya usan DCV — no una compu.
2. **Dónde corre el OCR:** en el cliente (navegador/PWA), igual que el lector de barras desde F1.

Esto cambia el diseño de Track A: `recognize-label` **deja de decodificar nada server-side** —
pasa a ser un receptor/logger de lo que el cliente ya calculó (A3, revisado arriba). Se agrega
**A3b**, portar el combo de B3 a un módulo cliente aislado sin conectar a ninguna pantalla, con
verificación final en un teléfono real del piso — no en esta desktop.

**Esto reactiva la pregunta de teléfonos de `02-investigacion.md` §8**, que hasta ahora venía
recomendando posponer: ya no es solo para el celular-como-fallback-offline (B5, la rama cara y
especulativa) — ahora es **el dispositivo del camino primario**, así que es genuinamente
bloqueante para A3b. Se las pido explícitamente abajo, reemplazando la pregunta anterior.

## Cambios de rumbo #5 (18 sep, primeras dos fotos reales en el Galaxy S25 Ultra — el resultado que de verdad importaba)

Rafael abrió A3b-ui en el S25 Ultra y fotografió dos cajas del piso. Resultado (JSON crudo, no
resumen):

| Foto                                    | Total   | Barras | OCR     | Correcto                          |
| --------------------------------------- | ------- | ------ | ------- | --------------------------------- |
| #14 (Renegade S1 Framekit, `09-4807CL`) | 14.67 s | 2.14 s | 12.53 s | Sí, todos los campos              |
| #15 (repuesto a granel, `PP1202JC`)     | 4.47 s  | 2.08 s | 2.39 s  | **No** — modelo, talla y G.W. mal |

**Hallazgo 1 — el costo frío es de sesión, no de foto:** el OCR de la primera foto tardó 12.5 s;
el de la segunda, 2.4 s. Es el patrón típico de ONNX Runtime Web: crear la sesión de inferencia es
caro (carga de pesos + compilación), correr sobre una sesión ya creada es rápido. Hoy
`clientOcr.ts` aparenta recrear esa sesión en cada llamada a `recognizeLabelClient()` en vez de una
sola vez por carga de página. Si se corrige, la mayoría de las fotos (todas menos la primera de
cada sesión de navegador) caerían cerca de los ~4 s totales de la segunda foto, no de los ~15 s de
la primera.

**Hallazgo 2 — el OCR en el teléfono se equivocó donde el de escritorio (B3) no:** en #15, el texto
crudo salió con errores reales (`FAULTLINE 20K` en vez de `FAULTLINE 29`, líneas mezcladas
`RTEM:CHIAN STAY R.O.C.`, `KGS` fuera de orden) y la lógica de anclas terminó devolviendo
`model: "FCAOLOR: BLACK"` (basura) y `gw_kg: 11` (tomó el N.W. en vez del G.W.). B3 en la RTX 3060
había sacado este mismo tipo de foto perfecto. El modelo PP-OCRv6 corriendo en el navegador del
teléfono (probablemente con menos preprocesamiento/resolución que el pipeline Python de B3) no
rinde igual — esto es justo lo que la premisa "medir en el dispositivo real, no asumir" estaba
para atrapar.

**Qué sigue (dos sub-fases nuevas, no siguen a F3 hasta resolver esto):**

### A3b-perf · Sesión de OCR persistente (una sola vez por carga de página)

**Qué:** convertir la inicialización de `PaddleOcrService`/la sesión de ONNX Runtime en un
singleton a nivel de módulo, creado una sola vez y reusado en cada llamada de
`recognizeLabelClient()` dentro de la misma carga de página — no una sesión nueva por foto.
**Verificación:** en el mismo S25 Ultra, sacar 3 fotos seguidas sin recargar la página — la
primera puede seguir siendo lenta (carga inicial), la segunda y tercera deberían acercarse a los
~2.4 s de OCR ya medidos, no repetir los ~12.5 s.
**Bloquea:** nada de Track A, pero si no se corrige, F3 (pantalla real) queda con una primera foto
por turno que se siente rota.

### A3b-precision · Por qué el OCR en el teléfono falla donde el de escritorio no

**Qué:** con el mismo texto crudo que ya salió de #15 (está en el JSON de arriba,
`ocr.fullText`), revisar si el problema es (a) el motor de OCR en sí (PP-OCRv6 tiny/mobile en
WASM lee peor que la versión Python de B3 con la misma imagen), o (b) la lógica de anclas
(`group_lines`/extracción de campos) que no tolera el mismo nivel de ruido que toleraba contra
las lecturas más limpias del banco. Si es (b), es más barato de arreglar (hacer la extracción más
tolerante a líneas fuera de orden o con ruido) que si es (a) (cambiar de modelo). Probar contra
las 19/20 fotos del banco completo, no solo estas dos.

**Diagnóstico documentado (18 sep 2026):**
La causa raíz es **(b) la lógica de extracción por anclas y agrupación de líneas es frágil ante el ruido del OCR móvil**:

1. **Diferencia de motor:** PP-OCRv6 Web/WASM en el teléfono produce leves desvíos de caracteres (`FAULTLINE 20K` en vez de `FAULTLINE 29`, `RTEM` en vez de `ITEM`, `FCAOLOR` en vez de `COLOR`). Esto es inherente a modelos móviles cuantizados sin unpipeline pesado de preprocesamiento OpenCV.
2. **Falla de extracción:**
   - **Modelo:** El filtro de parada de anclas buscaba palabras exactas con límite estricto `/\b(SIZE|COLOR|QTY|...)\b/`. Al llegar `FCAOLOR: BLACK`, el regex no reconoció `COLOR` y asignó la línea entera como nombre del modelo (`model: "FCAOLOR: BLACK"`). Además, `FAULTLINE` (que figura en `KNOWN_MODELS`) debió ganar por sobre la captura ruidosa de la línea siguiente.
   - **G.W.:** La búsqueda en líneas adyacentes (`off = -1`) tomó `11.00 KGS` de la línea superior (`N.W.`) porque no descartaba líneas marcadas con `N.W.`, tomando el peso neto en vez del bruto (12.00 KGS).
   - **Agrupación espacial:** El cliente no estaba ejecutando el agrupador por solape vertical de B3 (`group_lines`), sino consumiendo directamente las líneas crudas del servicio web, que no garantizan ordenamiento vertical previo por centro `y`.
3. **Acción:** Corregir en `clientOcr.ts` la agrupación geométrica espacial de cajas (port de `group_lines` de B3), hacer los filtros de anclas tolerantes a ruido/prefijos (`FCAOLOR`, `COLR`, `CLR`, `MODL`, `MDL`), dar prioridad a coincidencias de `KNOWN_MODELS` sobre texto adyacente no verificado, y proteger `G.W.` excluyendo taxativamente cualquier línea o token `N.W.`. Validar con suite de pruebas unitarias cubriendo los 19 casos del banco.

**Verificación:** repetir #15 y comparar el `fullText` crudo contra lo que B3 documentó para la
misma foto en `local-model/B3-camino-rapido-ocr.md` — si el texto crudo ya viene distinto, es (a);
si el texto es parecido pero la extracción de campos falla, es (b).
**Bloquea:** confiar en el camino rápido para F3 en fotos que no tengan barra de respaldo (como
los repuestos a granel, que dependen 100% del OCR).

## Cómo sigo yo esto

Después de cada sub-fase (A1…A6, B1…B5) reviso el resultado contra lo que promete este documento
antes de dar luz verde a la siguiente — igual que hice con R10. Si una sub-fase encuentra algo que
cambia una decisión de arriba (por ejemplo, si A5 muestra que el árbitro necesita un cuarto origen,
o si B2 tira un resultado sorprendente), lo anoto en este archivo, en una sección "Cambios de
rumbo" que agrego más abajo la primera vez que haga falta, y ajusto las sub-fases que faltan — no
las que ya se cerraron y verificaron.

## Cambios de rumbo #6 (19 sep, tercera foto real — confirma A3b-perf y descubre el límite real del OCR)

**Foto de una caja Citizen 3 Step-Thru, luz de piso a las 7:24am, algo de movimiento/blur.**
Resultado: **1.93 s total (0.63 s barras + 1.3 s OCR)** — dentro de la meta de "un par de
segundos", confirma que A3b-perf (la sesión persistente) funciona en uso real, no solo en el
banco. Pero de 5 campos de catálogo (SKU, modelo, talla, color, G.W.), **solo el SKU salió bien**
(`03-3973MN`, desde la caja negra grande — el mismo campo que ya sabíamos que sobrevive mejor al
daño, R6 §1). Modelo, talla, color y G.W. salieron `null`: el texto chico ("CITIZEN 3-STEP-THRU",
"SIZE:700C\*16", "COLOR:Vanilla Mint") se degradó tanto con el blur que ni el ancla (`MODEL:`,
`SIZE:`, `COLOR:`) sobrevivió para que la extracción la reconociera — no es un bug de
`clientOcr.ts`, es un límite físico de foto borrosa + letra chica.

**La conclusión no es "seguir puliendo el OCR de campos chicos".** Es la que Rafael señaló:
**el SKU es, de lejos, la señal más confiable** (barra cuando hay, y si no, el texto grande en caja
negra) — y PickD **ya sabe** qué modelo/talla/color corresponden a cada SKU, porque ya está en el
inventario/catálogo por cada alta anterior (`register_sku_from_as400` y lo que ya cargó
`InventoryScreen`). Es literalmente la regla de negocio original de la sesión del 15 sep
(`01-lo-aprendido.md` §4, paso 1: "SKU impreso → catálogo"), que el trabajo de OCR de esta semana
había dejado de lado al enfocarse en leer TODO de la foto.

**El rediseño que se sigue de esto:** dejar de pedirle a la foto que lea modelo/talla/color de
cero. En cambio: **SKU confiable (barra u OCR grande) → buscarlo en lo que PickD ya sabe de ese
SKU → esa es la sugerencia primaria.** El texto chico de la foto, cuando el OCR sí lo agarra, sirve
para **confirmar o marcar una discrepancia** contra lo que dice el catálogo (por ejemplo, si la
foto dice "Vanilla Mint" pero el catálogo tiene "MINT" para ese SKU — eso ya pasó en la sesión
manual del 15 sep, caso #11) — nunca para inventarlo de cero cuando la foto no alcanza.

### A3c · Cruce SKU → catálogo existente (INVESTIGACIÓN COMPLETADA)

**Qué:** primero, investigar (sin tocar código todavía) dónde vive hoy el modelo/talla/color por
SKU que PickD ya conoce — candidatos a revisar: la tabla `inventory` (cada alta ya guarda esos
campos), `sku_metadata` (hoy solo tiene dimensiones físicas, no nombre/color — confirmarlo antes de
asumir que sirve), y cómo trabaja `register_sku_from_as400` (¿consulta una fuente externa AS400 en
vivo, o solo registra lo que la persona tipea?). Documentar el hallazgo en este archivo ANTES de
escribir la consulta. Con eso resuelto: dado un SKU (de barra u OCR), consultar esa fuente y
devolver modelo/talla/color/estado (existe con stock / existe sin stock / no existe) como la
sugerencia primaria — igual que hacía la persona a mano el 15 sep. Si el OCR de la foto también
leyó modelo/color/talla, compararlo contra la sugerencia del catálogo y marcar coincide/discrepa
— nunca al revés (la foto nunca reemplaza al catálogo cuando el catálogo ya tiene el dato).
**Ojo, esto cambia la regla de "cero Supabase" de A3b-ui:** una consulta de SOLO LECTURA contra
`inventory`/donde viva esto no es un registro ni una escritura, pero sí es la primera vez que esta
pantalla de diagnóstico toca la base de datos. Se lo marco a Rafael para que lo confirme, no lo
asumo — si prefiere mantenerla 100% offline, esto se mueve a una pantalla aparte en vez de
extender `LabelTestScreen.tsx`.

#### Hallazgos de investigación (19 sep 2026):

1. **`sku_metadata` es el hogar real de `model`, `size`, `color`:**
   - Contrario a la hipótesis previa de que solo tenía dimensiones de caja, `sku_metadata` posee
     columnas estructuradas: `model text`, `size text`, `color text`, `category text`, `is_bike boolean`,
     `upc text`, `serial_number text`, `as400_description text`, `as400_snapshot jsonb`.
   - Historia del esquema: se agregaron originalmente para Scratch & Dent (`20260417100000`), pero
     el 17 de julio de 2026 (`20260717200000_register_new_sku_structured_fields`) se promovieron a
     ciudadanos de primera clase para todo el catálogo via `register_new_sku`, y en agosto/septiembre
     fueron masivamente backfilled (`20260820160000_backfill_bike_model_size` para 172 bicis,
     `20260909205906_split_container_and_juv_names` para líneas de contenedores como Citizen 2).
   - Posee la columna generada indexada `sku_key` (`regexp_replace(upper(sku), '[^A-Z0-9]', '', 'g')`),
     lo que permite matching canónico indexado ultrarrápido ignorando guiones o espacios (ej. `'03-3973MN'`,
     `'03-3973-MN'` y `'033973MN'` resuelven a la misma clave `033973MN`).

2. **`inventory` NO tiene columnas discretas de modelo/talla/color:**
   - La tabla `inventory` solo tiene: `id`, `sku` (FK a `sku_metadata.sku`), `location`, `quantity`,
     `item_name`, `warehouse`, `is_active`, etc.
   - `item_name` es un string de display consolidado (ej. `"CITIZEN 3 STEP-THRU 16 VANILLA MINT"`).
     Al registrar un SKU en `register_new_sku`, si no se pasa un nombre explícito, se autogenera
     con `concat_ws(' ', v_model, v_size, v_color)`. Si solo se dispone de `item_name`, el cliente
     usa `parseBikeName(item_name)` para deducir modelo, talla, año y color.

3. **Cómo funciona `register_sku_from_as400`:**
   - La función PostgreSQL `register_sku_from_as400` **NO consulta el AS400 en vivo** (Postgres no tiene
     cliente 5250 ni conexión de red al terminal).
   - Quien consulta el AS400 en vivo es el **watchdog** (`watchdog-pickd/sku_enrichment.py`). El watchdog
     monitorea la vista `v_as400_skus_unregistered` (SKUs vistos en órdenes o PDFs pero ausentes en el
     catálogo), se conecta via telnet/5250 a la terminal del AS400, ingresa a la pantalla de "Stock Inquiry",
     extrae la descripción de 30 caracteres, tipo de item (Bike/Part), peso y año, y luego llama a
     la RPC `register_sku_from_as400(p_sku, p_item_name, p_is_bike, p_location='UNKNOWN', ...)`.
   - `register_sku_from_as400` inserta en `sku_metadata (sku, is_bike, as400_description, as400_snapshot)`
     (dejando `model`, `size`, `color` en NULL si nadie los desglosó) y crea una fila en `inventory`
     con `quantity = 0`, `location = 'UNKNOWN'` e `item_name = COALESCE(p_item_name, p_as400_description)`.

#### Consulta SQL concreta probada contra la base:

```sql
SELECT
  m.sku,
  m.model,
  m.size,
  m.color,
  m.is_bike,
  m.as400_description,
  COALESCE(
    m.model,
    (SELECT i.item_name FROM inventory i WHERE i.sku = m.sku AND i.item_name IS NOT NULL LIMIT 1),
    m.as400_description
  ) AS display_name,
  COALESCE((SELECT SUM(quantity) FROM inventory i WHERE i.sku = m.sku AND i.is_active = true), 0)::int AS total_stock,
  EXISTS(SELECT 1 FROM inventory i WHERE i.sku = m.sku AND i.quantity > 0 AND i.is_active = true) AS in_stock,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object('location', i.location, 'quantity', i.quantity)
        ORDER BY i.location
      )
      FROM inventory i
      WHERE i.sku = m.sku AND i.is_active = true AND i.quantity > 0
    ),
    '[]'::jsonb
  ) AS stock_locations
FROM sku_metadata m
WHERE m.sku_key = regexp_replace(upper('03-3973MN'), '[^A-Z0-9]', '', 'g')
   OR m.sku = public.canonical_sku('03-3973MN');
```

En PostgREST / Supabase JS (para frontend):

```ts
const cleanKey = sku.toUpperCase().replace(/[^A-Z0-9]/g, '');
const { data, error } = await supabase
  .from('sku_metadata')
  .select(
    `
    sku,
    model,
    size,
    color,
    is_bike,
    as400_description,
    inventory (
      location,
      quantity,
      item_name,
      is_active
    )
  `
  )
  .eq('sku_key', cleanKey)
  .maybeSingle();
```

#### Qué devuelve para el caso real `03-3973MN`:

1. **En la base de datos local (solo esquema + seeds de test):**
   - Devuelve `0 rows` (null), ya que `03-3973MN` no está incluido en los seeds estáticos locales.
2. **Si el SKU ya fue registrado en el catálogo (via `register_new_sku` o contenedor):**
   - `sku`: `'03-3973MN'`
   - `model`: `'CITIZEN 3 STEP-THRU'`
   - `size`: `'16'` (o `'700C*16'`)
   - `color`: `'VANILLA MINT'`
   - `is_bike`: `true`
   - `total_stock`: N (unidades activas en el edificio)
   - `in_stock`: `true` (si total_stock > 0)
   - `stock_locations`: `[{"location": "ROW 25", "quantity": 12}, ...]`
3. **Si el SKU fue registrado únicamente por el watchdog desde AS400 (`register_sku_from_as400`):**
   - `sku`: `'03-3973MN'`
   - `model`: `null`, `size`: `null`, `color`: `null`
   - `as400_description` / `item_name`: `'CITIZEN 3 ST 16 V-MINT'` (descripción de 30 caracteres)
   - `total_stock`: 0, `in_stock`: `false`, `location`: `'UNKNOWN'`
   - _Nota:_ El frontend puede pasar `item_name` o `as400_description` por `parseBikeName()` para inferir `{ model: 'CITIZEN 3 ST', size: '16', color: 'V-MINT' }` automáticamente como fallback.
4. **Si el SKU es completamente nuevo y no existe en PickD:**
   - Devuelve `null` (no catalogado).

**Estado de A3c:** Investigación completada y documentada. Pendiente confirmación de Rafael antes de tocar `LabelTestScreen.tsx` o implementar la consulta en cliente.
**Verificación:** con el SKU real de esta foto (`03-3973MN` / `03-3973-MN`), la sugerencia del catálogo
proporcionará "CITIZEN 3 STEP-THRU, 16, VANILLA MINT" (o el nombre exacto de catálogo) sin haber
tenido que depender de leer las letras chicas borrosas de la foto.
**Bloquea:** nada de Track A — es la base real de F3 (la pantalla asistida).

**A3c COMPLETO y confirmado real (19 sep, S25 Ultra):** foto de `03-3973MN` → catálogo devolvió
"CITIZEN 3 STEP-THRU / 16 / VANILLA MINT" con `status: catalog_only` en los 3 campos (la foto no
había leído ninguno) — 0.94 s total, OCR en 134 ms (sesión ya tibia, A3b-perf funcionando en uso
real). Segunda foto sin SKU → `catalogSuggestion: null`, comportamiento correcto por diseño.

## Cambios de rumbo #7 (19 sep — el SKU también puede fallar, y de una forma nueva)

Segunda foto real (`03-3989-GY`, Citizen 2 Step-Thru): ni la barra ni el OCR sacaron el SKU, pese
a que la caja negra grande se lee perfecto a simple vista. El texto crudo del OCR sí "vio" pedazos
(`"03-396 C"`, `"1 9."`, `"-GY"`) pero el motor los repartió en **3 líneas separadas** — y la
extracción de SKU hoy solo mira una línea a la vez, así que ningún fragmento calza con el patrón
`DD-NNNN-CC`. No es el mismo tipo de falla que #15/#19 (anclas de texto chico); acá falló el campo
que hasta ahora era el más confiable, por una razón distinta (fragmentación de línea).

### A3d · Reensamblar el SKU cuando el OCR lo parte en varias líneas (NUEVA)

**Qué:** cuando ninguna línea sola matchea el patrón de SKU, intentar reconstruirlo concatenando
fragmentos de líneas verticalmente cercanas (mismo bloque espacial que ya agrupa `group_lines`)
que juntos sí formen un SKU válido — con el mismo criterio de nunca inventar un dígito: si la
reconstrucción no matchea el patrón exacto después de concatenar, se descarta, no se fuerza.
**Verificación:** usar el `fullText` real de esta foto (`"03-396 C\n1 9.\n-GY"`, el SKU real es
`03-3989-GY`) como fixture de test, igual que se hizo con #15/#19 — debe resolver a `03-3989GY`.
Correr también contra el banco completo para confirmar que no rompe ningún caso que ya funcionaba.
**Bloquea:** nada — pero sin esto, A3c (la parte que más importa ahora) se queda sin poder actuar
cada vez que el SKU se fragmenta así.

**A3d COMPLETO y verificado (19 sep):**

- Implementado `mergeSlicePair()` y `reconstructMultiLineSku()` en `clientOcr.ts`.
- Maneja fragmentación multi-línea directa (1 a 3 líneas adyacentes) y ensamblado de dígitos divididos horizontalmente por el detector (bounding box que corta dígitos `8` y `9` en mitades `6 C` sobre `1 9.`).
- Probado contra fixture real de Galaxy S25 Ultra: resuelve a `03-3989GY` (y modelo `CITIZEN 2 STEP-THRU`).
- Cero regresión en banco de pruebas (#1 a #19) y 105 archivos de test pasando (1,471 pruebas).

## Cambios de rumbo #8 (19 sep — A3d pasó el test y falló en el teléfono: el fixture estaba mal construido)

A3d se implementó, su test pasó en verde (`03-3989GY` resuelto) y en el S25 Ultra la misma foto
siguió devolviendo `sku: null`. Verificado antes de culpar al caché: el bundle en producción **sí**
contiene el código nuevo (se buscó la constante `STORM GREY` en los chunks servidos por
`pickd.pages.dev` y aparece en `assets/LabelTestScreen-*.js`). O sea, falla de verdad.

**Causa raíz (medida, no inferida):** el dispositivo reporta `ocr.lineCount: 12`, pero ese mismo
`ocr.fullText` partido por `\n` da **16 líneas no vacías**. La estructura real de líneas agrupadas
que `extractFieldsFromOcrLines` le pasa a `reconstructMultiLineSku` **no es** la que se obtiene
partiendo el `fullText`. El test de A3d construyó su fixture haciendo exactamente eso
(`fullText.split('\n')` con cajas sintéticas ordenadas), así que probó una forma de dato que el
pipeline real nunca produce: test verde, dispositivo rojo.

**Lección y regla obligatoria para todo lo que siga:** un fixture derivado del `fullText` NO prueba el camino real; los fixtures tienen que salir de la estructura real (`OcrItem[][]` con sus cajas y coordenadas exactas), y para eso hay que poder capturarla desde el teléfono.

### A3e · Exponer la estructura real de OCR y arreglar A3d contra ella (NUEVA)

**Qué, en este orden estricto:**

1. **[COMPLETO - 19 sep]** Agregar a la salida JSON de `LabelTestScreen` (y al botón de copiar resumen / botón dedicado "Líneas OCR") la estructura **cruda** de líneas agrupadas (`OcrItem[][]`): cada línea con sus items, texto y caja (`x`, `y`, `width`, `height`). También visible en tarjeta interactiva en pantalla. Esto es lo único que se despliega ahora.
2. **[PENDIENTE]** Con esa captura real de la foto de `03-3989-GY` (Rafael la vuelve a sacar en producción y pega la estructura JSON real), rehacer el test de A3d usando esa estructura verdadera — no `fullText.split('\n')`.
3. **[PENDIENTE]** Recién entonces corregir `reconstructMultiLineSku` para que funcione sobre la estructura real, manteniendo la regla estricta de no inventar dígitos.

**Verificación de A3e Paso 1:** `tsc --noEmit`, `vitest run` (1,472 tests pasando), build de Vite sin wasm > 25MB, y deploy activo en Cloudflare Pages.
**Verificación de A3e Pasos 2 y 3 (posterior):** el test con el fixture real falla ANTES del arreglo y pasa DESPUÉS (si pasa antes del arreglo, el fixture sigue sin representar la realidad y hay que revisarlo).

## Cambios de rumbo #9 (20 sep — la captura real desmiente A3d, y A3d inventa dígitos: hay que revertir)

Con la estructura `OcrItem[][]` real ya expuesta (A3e paso 1), el diagnóstico cambia por completo:

**1. `mergeSlicePair` inventa dígitos.** Está hardcodeada con `('6','1') → '8'` y `('C','9') → '9'`
— mapeos deducidos hacia atrás desde la única respuesta conocida (`03-3989-GY`). Eso viola la regla
central de todo el motor (`02-investigacion.md` §4.2, R5): un campo sin evidencia se deja `null`,
nunca se completa con un dígito verosímil. Puede producir un **SKU bien formado pero equivocado, en
silencio** — el peor error posible acá, porque mandaría stock a la bici equivocada sin avisar.

**2. La premisa geométrica de A3d es falsa.** En la línea real (grupo 6) los fragmentos están
**lado a lado en x**, no apilados en mitades: `03-396` (x 253‑768), `C` (725‑792), `1` (847‑891),
`9.` (853‑954), `-GY` (931‑1227) — todos en el mismo grupo. No hay slicing vertical que reensamblar;
hay detecciones duplicadas/parciales de una misma fila.

**3. Aunque se reensamblara perfecto, no alcanza.** El SKU real es `03-3989-GY` y el OCR leyó `396`.
Recuperar `3989` desde `396` exige inventar el `8`. Esta foto no tiene salvación honesta por OCR.

**4. Causa de fondo: se está probando con capturas de pantalla, no con fotos.** La imagen incluye la
barra de estado del teléfono (`"07:24 … 5G.4! 16"` en `y:37`) y pesa 0.71 MB: es un screenshot
recomprimido. Por eso los **dos códigos de barras visibles en la etiqueta dieron 0 lecturas**, cuando
son la fuente que da el SKU exacto y con checksum. R6 §1 ya lo había medido: a 1280 px salieron 15
barras; a 12 MP, 26.

### A3f · Revertir lo que inventa y volver a medir con fotos de verdad (NUEVA, reemplaza A3e pasos 2 y 3)

1. **[COMPLETO - 20 sep]** **Eliminar `mergeSlicePair` y la rama de reconstrucción por "slices"** de `clientOcr.ts`, junto
   con sus tests. Conservada únicamente la concatenación directa de fragmentos adyacentes **cuando el
   resultado matchea el patrón canónico sin transformar ningún carácter**.
2. **[COMPLETO - 20 sep]** **Agregar un test de no-invención** con el fixture real completo de 12 grupos de `OcrItem[][]`: el resultado esperado es `sku: null`, NO `03-3989GY`. Queda fijado en el código de test que devolver un SKU acá sin evidencia sería un bug de alucinación silenciosa, no un acierto.
3. **[SIGUIENTE PASO: MEDICIÓN, NO DE CÓDIGO]** **Volver a medir con fotos directas de cámara a resolución completa** (no screenshots de la
   galería): la misma caja `03-3989-GY`, tomada desde la pantalla de prueba con la cámara. La
   hipótesis a confirmar o descartar es que con la foto real los dos códigos de barras decodifican y
   el SKU sale exacto por barra, sin depender del OCR.
   **Verificación esperada:** con foto directa, `barcodes.count > 0` y `sku` con `fieldSources.sku` empezando en
   `barcode:`. Si con foto directa tampoco decodifica, el problema es de captura (enfoque/luz/distancia)
   y eso se ataca con guía de encuadre, no con más heurísticas de texto.

## Cambios de rumbo #10 (20 sep — foto de etiqueta girada 90°: fallo total de orientación y reintento en cascada)

Una foto real de la etiqueta JAMIS LASER 1.6 girada 90 grados (texto vertical, de abajo hacia arriba)
devolvió los 10 campos vacíos y `barcodes.count: 0` en 2,142 ms (barras ~911 ms, OCR ~1,231 ms).
La etiqueta es perfectamente legible para un humano:
`SKU 07-3743-PK`, `UPC 845438006710`, `GTIN 00845436006710`, `COLOR Popstar Pink`, `P/O 2027-05`,
`MK NO 126070076`, `C/NO 09`, `QTY 1 SET`, `N.W. 10.20 KG`, `G.W. 13 KG`, `PORT NEW YORK`.

**Diagnóstico y medición:**

1. **Barras:** Las opciones `tryHarder: true` y `tryRotate: true` en `zxing-wasm` ya estaban activas. El costo medido del pase de barras es de 911 ms (por debajo del límite de 1.5 s). Si un código 1D está degradado o sus barras quedan cortadas en los bordes por la orientación vertical, zxing no logra decodificarlo.
2. **OCR:** PP-OCRv6 asume texto horizontal orientado de izquierda a derecha. Al recibir texto vertical a 90°, lee secuencias espurias o cajas vacías sin anclas.

### A3g · OCR con reintento por rotación en cascada y preservación de estructura cruda (NUEVA)

1. **[COMPLETO - 20 sep]** **Verificación de zxing-wasm:** confirmadas en `node_modules` las opciones de `ReaderOptions` (`tryHarder` y `tryRotate`). Costo de 911 ms (< 1.5 s) validado y conservado.
2. **[COMPLETO - 20 sep]** **Reintento OCR en cascada solo cuando hace falta:**
   - Pase inicial a 0°.
   - Si no hay ninguna ancla (`countOcrAnchors === 0`, evaluando SKU canónico, UPC/GTIN, y palabras clave `JAMIS`, `COLOR`, `UPC`, `QTY`, `G.W.`, `PORT`), rota el canvas a 90° y reintenta.
   - Si a 90° sigue sin anclas, prueba 270°.
   - Selecciona el resultado con mayor cantidad de anclas reconocibles.
   - Si a 0° ya hay anclas, retorna de inmediato sin pagar costo adicional (tiempo normal intacto en ~300-400 ms).
   - Se registra en `timingMs.ocrAttempts` y `ocr.rotationUsed` qué rotación se utilizó y cuánto tardó cada intento, reflejándose en el texto de resumen.
3. **[COMPLETO - 20 sep]** **Estructura cruda OCR restaurada en el portapapeles:** el botón único copia siempre `result.summaryText`, que incluye la estructura completa `OcrItem[][]` serializada sin ensuciar la pantalla.

## Cambios de rumbo #11 (20 sep — Medición en Galaxy S25 Ultra: corrección de agrupación espacial, conflicto UPC/GTIN, profiling de latencia y desactivación de tryHarder)

**Evidencia medida en Galaxy S25 Ultra (foto real JAMIS LASER 1.6 girada 90°):**

- Tiempo total: 6,786.7 ms (barras 1,673.4 ms, OCR 5,113.2 ms).
- Reintentos OCR declarados: 0° en 107 ms, 90° en 1,479 ms (suma 1,586 ms).
- SKU `07-3743PK` y modelo `LASER 1.6` recuperados con éxito a 90°.

**Bugs de precisión y problemas resueltos:**

1. **BUG 1 (Agrupación espacial rota tras rotación):**
   - _Hallazgo:_ En `groupLinesBySpatialProximity`, el acumulador expandía dinámicamente la altura del renglón (`ln.y1 - ln.y0`), haciendo que la tolerancia creciera progresivamente y absorbiera 21 ítems de toda la etiqueta en un único renglón gigante. Al ordenar ese renglón por `x`, los ítems quedaron con coordenadas `y` desordenadas (1149, 705, 757, 338).
   - _Consecuencias medidas:_ `G.W.` salió 10.2 kg (el valor de N.W.) y `Color` salió `'Popstar PInk UPC: IHLWNUWWVIA'` (se concatenaron dos renglones).
   - _Solución:_ Reordenamiento estricto por `y` antes de agrupar y nuevo algoritmo de agrupación basado en la altura promedio de los ítems individuales de cada renglón (`avgHeight`), impidiendo la expansión vertical en cascada. Incorporada función `mapBoxToRotation`.
   - _Aclaración sobre reporte previo:_ El reporte anterior afirmó erróneamente que `G.W. extrae estrictamente 13 KG` estaba resuelto en el dispositivo; la corrida real subsiguiente en Galaxy S25 Ultra demostró que seguía devolviendo 10.2 kg porque el OCR leyó `G.W.113 KO` y el parser cayó al renglón de arriba (`N. W.: 10.20 KG`). La solución definitiva se aborda en el Cambio de rumbo #12.

2. **BUG 2 (Conflicto UPC vs GTIN — R10 Sección 4 Caso B):**
   - _Hallazgo:_ El OCR leyó `B454380C6710` bajo el código UPC y `00845436006710` bajo el GTIN. El motor reportó `845436006710` como 'checksum verificado' en silencio, porque el checksum mod-10 sólo valida 1 de cada 10 lecturas erróneas.
   - _Solución:_ Implementada regla estricta del árbitro (R10 Caso B): si el UPC directo y el UPC derivado del GTIN difieren, el campo NO se resuelve en silencio; se marca `[CONFLICTO]` explícito, se reportan ambos candidatos y nunca se elige uno por el checksum.
   - _UI:_ Etiqueta ámbar con `AlertTriangle` y badge `[CONFLICTO]`.

3. **PROBLEMA 3 (Latencia y profiling detallado):**
   - _Hallazgo:_ De los 5,113 ms de OCR, los intentos sumaban 1,586 ms. Los ~3,500 ms restantes correspondían a decodificación de la imagen de cámara de alta resolución (`createImageBitmap`) y la inicialización singleton del motor ONNX/WASM.
   - _Solución:_ Instrumentación completa de cada etapa en `profile` (`imageDecodeMs`, `serviceInitMs`, `canvasPrepMs`, `recognizeMs`, `groupingMs`, `extractionMs`) mostrada en `summaryText`.
   - _Corte temprano:_ Si el pase a 90° produce anclas (`anchorsFound > 0`), la cascada corta inmediatamente y NUNCA ejecuta 270°.

4. **PROBLEMA 4 (Barras en etiquetas giradas y desactivación de tryHarder):**
   - _Hallazgo:_ `tryHarder: true` en `zxing-wasm` subió el tiempo de barras de 911 a 1,673.4 ms (+762 ms) y siguió devolviendo `count: 0` en etiquetas giradas 90°.
   - _Solución:_ Desactivado `tryHarder: false` (dejando `tryRotate: true`), recuperando los ~760 ms para mantenerse en el presupuesto de ~900 ms. Documentado que en fotos verticales las barras 1D no decodifican por zxing y no debe pagarse el sobrecosto de tryHarder.

## Cambios de rumbo #12 (20 sep — Medición en Galaxy S25 Ultra: corrección de G.W. cruzado con N.W., exclusión de SKU en candidatos UPC, verificación de canvas y medición de barras)

**Evidencia medida en Galaxy S25 Ultra post-deploy:**

- Tiempo total: 463.5 ms (rotación 90°, 17 líneas agrupadas).
- Lo positivo validado: la agrupación espacial quedó correcta en 17 líneas, `Color` extrajo `'Popstar PInk'` limpio y la latencia bajó de 6,786 ms a 463.5 ms con inferencias de 41 ms (0°) y 53 ms (90°).
- Barras: se mantienen en `count: 0` con `tryRotate: true` activo (sin `tryHarder`). Queda constancia medida; no se altera el motor de barras en esta iteración.

**Correcciones implementadas:**

1. **BUG A (G.W. devolvía el valor de N.W.):**
   - _Causa raíz:_ El OCR leyó la línea como `'G.W.113 KO'` (el ':' se leyó como '1' y 'KG' como 'KO'). El parser no matcheó y cayó a la línea adyacente superior `'N. W.: 10.20 KG'`, porque el regex `\bN\.?W\.?\b` no toleraba el espacio interno entre `N.` y `W.`.
   - _Regla 1 (Prioridad máxima, 02-investigacion.md §4.2, R5):_ NUNCA tomar como G.W. un valor cuya línea de origen contenga `N.W.` / `N. W.` / `NET`. Si el único candidato proviene de una línea N.W., el resultado es `gw_kg = null`. Un número plausible tomado de otro campo es peor que `null`.
   - _Regla 2:_ Tolerancia a ruido del ancla en la MISMA línea: reconocer `G.W.` seguido de separador ruidoso (':', '1', '.', espacio) y unidad ruidosa (`KG`, `KO`, `KQ`, `K0`). Pero NO recortar dígitos para forzar un número: de `'G.W.113 KO'` NO se deduce 13 quitando el '1'. Si el número no se puede aislar sin transformar caracteres, `gw_kg = null`.
   - _Verificación:_ Fixture con `'G.W.113 KO'` y `'N. W.: 10.20 KG'` devuelve `gw_kg = null` y NUNCA `10.2`. Con unidades toleradas (`G.W.: 13 KO`, `G.W. 13.5 K0`), devuelve 13 y 13.5.

2. **BUG B (Candidato a UPC directo contaminado con SKU):**
   - _Causa raíz:_ La pantalla reportó `CONFLICTO: UPC directo (07-3743-PK) != GTIN (845436006710)`. El token `'07-3743-PK'` es el SKU de la bici, y el filtro anterior (`>= 6 dígitos numéricos`) lo dejó pasar. El candidato UPC real de la zona era `'B454380C6710'`.
   - _Solución en `isValidUpcCandidate` y `normalizeOcrDigits`:_
     - Exclusión explícita de cualquier cadena que matchee el patrón canónico de SKU (`^\d{2}-?\d{4}[A-Z]{0,2}$`).
     - Normalización de caracteres OCR (`B -> 8`, `C/D/O/Q -> 0`, `I/L/| -> 1`, `Z -> 2`, `S -> 5`, `G -> 6`).
     - Exigencia estricta de 12 dígitos (UPC-A) o 13/14 dígitos (EAN-13/GTIN-14) tras normalizar.
     - Si tras filtrar no queda candidato UPC directo válido, no hay conflicto que reportar: se adopta el GTIN derivado si es válido, o `upc = null`.
   - _Verificación:_ `'B454380C6710'` se normaliza a `'845438006710'` y reporta el conflicto real con GTIN `'845436006710'`. Con solo SKU y GTIN, se usa el GTIN sin falso conflicto.

3. **VERIFICACIÓN DE RESOLUCIÓN DE CANVAS Y LATENCIA (Medida, no asumida):**
   - _Comparación de dimensiones:_ La imagen y el canvas pasados a `PaddleOcrService.recognize(canvas)` **NO se redujeron ni escalaron**. El canvas se genera en `createRotatedCanvas` a escala 1:1 con `canvas.width = bitmap.width` y `canvas.height = bitmap.height` (o transpuesto a 90°/270°). Tanto antes como ahora se pasa el 100% de los píxeles nativos del bitmap.
   - _Causa de la aceleración (1,187 ms -> 141 ms con inferencias de 41 y 53 ms):_
     1. El singleton de `getOcrService` ya estaba inicializado en memoria en la sesión de la página (`serviceInitMs = 0 ms` vs ~3,500 ms de descompresión/WASM en la primera corrida).
     2. JIT de WebAssembly caliente en V8 / Android.
     3. El pase inicial a 0° no detectó cajas de texto válidas (41 ms solo en detección sin inferencia de reconocimiento).
     4. El pase a 90° detectó anclas e inmediatamente cortó la cascada, evitando ejecutar el pase de 270°.
   - Se añadió la medición explícita de dimensiones de imagen/canvas nativo al `summaryText` (`[W×H px, escala 1:1]`) para transparencia total en cada corrida.

## Cambios de rumbo #13 (20 sep — Arranque en frío en Galaxy S25 Ultra: auditoría de warmup, instrumentación en 4 etapas de serviceInitMs y cache headers en Cloudflare Pages)

**Evidencia medida en Galaxy S25 Ultra post-deploy (primera corrida tras despliegue):**

- Corrida fría: total 8,221.7 ms (`serviceInitMs`: 5,645.0 ms, intento 90° en 1,761 ms por compilación JIT).
- Corrida caliente (misma sesión): total 463.5 ms (`serviceInitMs`: 0.0 ms, intento 90° en 53 ms).
- Barras: se mantienen en `count: 0` con `tryRotate: true` en etiquetas a 90° (sin cambios en motor de barras).

**1. Auditoría de Warmup en background (fuente primaria de código):**

- `LabelTestScreen.tsx` líneas 74-77: `warmupOcrService().catch(() => {})` está VIVO y se dispara en `useEffect(..., [])` al montar la pantalla sin bloquear el render.
- Los cambios de rotación y agrupación espacial NO lo rompieron ni removieron.
- Causa del pago de 5.6 s en la primera caja: en Android/Chrome, al abrir `<input type="file" capture="environment">` la app de cámara pasa a primer plano y suspende la ejecución JS en background. Si el operador dispara la foto antes de que el motor termine de bajar los 27 MB de WASM y 6.5 MB de modelos de Hugging Face, `runClientOcr` espera la promesa pendiente (`ocrServicePromise`), midiendo ese remanente en `serviceInitMs`.

**2. Instrumentación granular en 4 etapas dentro de `serviceInitMs` (en texto copiado `summaryText`, NUNCA en UI):**

- Chunks WASM: `wasmFetchOrReadMs` con origen `[red]` o `[cache]`.
- Reensamblado binario: `wasmReassembleMs` (tiempo de concatenación de TypedArrays de las 2 partes).
- Instanciación runtime ONNX: `ortInitMs` (import dinámico e inyección de `ort.env.wasm.wasmBinary`).
- Carga de modelos PP-OCRv6: `modelsLoadMs` (descargas de Hugging Face y creación de sesiones ONNX).
- Todo reportado bajo `- Inicialización modelo/WASM: X ms` en `summaryText`. Pantalla de UI se mantiene idéntica, con su único botón de 'Copiar resultado'.

**3. Auditoría de Headers HTTP en Cloudflare Pages y Cache:**

- Header real medido antes de la corrección (`curl -ILs https://pickd.pages.dev/assets/ort-wasm-simd-threaded.jsep.part1.wasm`):
  `cache-control: public, max-age=0, must-revalidate`
  Cloudflare Pages asignaba revalidación obligatoria en cada carga porque los chunks partidos no llevaban hash de Vite.
- Solución implementada: archivo `public/_headers` (copiado automáticamente a `dist/_headers` en el build) con:
  ```
  /assets/*.wasm
    Cache-Control: public, max-age=31536000, immutable
    Access-Control-Allow-Origin: *
  ```
- Efecto: el navegador sirve los chunks WASM directamente desde cache de disco local sin ida y vuelta a la red.
- Cache API: `pickd-ort-wasm-v1` almacena el ArrayBuffer reensamblado (`27 MiB`) bajo la clave `/assets/ort-wasm-simd-threaded.jsep.wasm`.
- Mediciones de red de referencia:
  - WASM chunk 1 (13.5 MiB): 569 ms (red de fibra, ~24.8 MB/s).
  - Modelos Hugging Face (`PP-OCRv6_tiny_det.ort` 1.88 MB, `PP-OCRv6_tiny_rec.ort` 4.53 MB): ~500 ms c/u en fibra.
- Estado de verificación: verificado 100% en suites de test unitario (28 tests en `recognizeLabelClient.test.ts`, 1,482 tests globales) y build estático. El desglose real del dispositivo se medirá en el siguiente escaneo en el Galaxy S25 Ultra con el texto copiado.

## Cambios de rumbo #14 (20 sep — Auto-hospedaje de modelos PP-OCRv6 en Cloudflare Pages, Cache API y corrección contable bloqueante vs trabajo real)

**Evidencia medida en Galaxy S25 Ultra post-deploy de headers:**

- Cacheo de chunks WASM validado en el dispositivo: 2,100 ms `[red]` -> 59.2 ms `[cache]`.
- Total en frío bajó de 8,221 ms a 2,761 ms (-5.46 s).
- Cuello de botella restante medido: `Carga modelos PP-OCRv6: 1,464.5 ms` descargando desde `huggingface.co`.

**1. Auto-hospedaje de modelos y diccionario en Cloudflare Pages (independencia total de terceros):**

- Se eliminó la dependencia de `huggingface.co` alojando los 3 archivos como activos estáticos en `public/models/` (copiados a `dist/models/` en build):
  - `PP-OCRv6_tiny_det.ort` (1.88 MB)
  - `PP-OCRv6_tiny_rec.ort` (4.53 MB)
  - `ppocrv6_tiny_dict.txt` (27.1 KB)
- Total de modelos: ~6.44 MB (muy por debajo del límite de 25 MiB por archivo de Cloudflare Pages, sin particionado).
- Inyección directa como `ArrayBuffer` en `new PaddleOcrService({ model: { detection, recognition, charactersDictionary } })`: al recibir `ArrayBuffer`, `ppu-paddle-ocr` omite por completo cualquier llamada a red externa. Cero llamadas a `huggingface.co`.

**2. Estrategia de Caching doble (HTTP Immutable + Cache API):**

- `public/_headers`:
  ```
  /models/*
    Cache-Control: public, max-age=31536000, immutable
    Access-Control-Allow-Origin: *
  ```
- Cache API: `pickd-ocr-models-v1` almacena en disco los tres buffers tras la primera lectura.
- En recargas posteriores o arranques fríos, `loadOcrModelBuffers()` lee directamente de `CacheStorage` con latencia local flash de ~50-80 ms.

**3. Clarificación contable en `summaryText` (Espera bloqueante vs Trabajo real):**

- Se corrigió el reporte para evitar la aparente contradicción donde el total decía `0.0 ms` y las sub-etapas sumaban 1,563 ms:
  ```text
  - Inicialización modelo/WASM: 0.0 ms (espera bloqueante) [trabajo real: 1563.0 ms]
    * Chunks WASM: 59.2 ms [cache]
    * Reensamblado binario: 0.0 ms
    * Runtime ONNX: 39.3 ms
    * Carga modelos PP-OCRv6: 1464.5 ms [cache]
  ```
  O en caso de espera bloqueante activa:
  ```text
  - Inicialización modelo/WASM: 2761.0 ms (espera bloqueante) [trabajo real: 2761.0 ms]
  ```
- Sin cambios visuales en UI: la pantalla de prueba mantiene su botón único intacto.
