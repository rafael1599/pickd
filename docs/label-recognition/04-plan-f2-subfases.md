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

## Cómo sigo yo esto

Después de cada sub-fase (A1…A6, B1…B5) reviso el resultado contra lo que promete este documento
antes de dar luz verde a la siguiente — igual que hice con R10. Si una sub-fase encuentra algo que
cambia una decisión de arriba (por ejemplo, si A5 muestra que el árbitro necesita un cuarto origen,
o si B2 tira un resultado sorprendente), lo anoto en este archivo, en una sección "Cambios de
rumbo" que agrego más abajo la primera vez que haga falta, y ajusto las sub-fases que faltan — no
las que ya se cerraron y verificaron.
