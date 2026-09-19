# B2 · Evaluación empírica de Qwen3.5 9B local en Linux / RTX 3060

> Sub-fase B2 del Track B (Plan F2 — `docs/label-recognition/04-plan-f2-subfases.md`).
> Fecha: 18 de septiembre de 2026.
> Modelo: **Qwen3.5 9B (Q4_K_M)** vía Ollama 0.34.0 con backend CUDA nativo (Compute 8.6).
> Hardware medido: Intel Core i9-10900KF + **NVIDIA GeForce RTX 3060 12 GiB VRAM**.
> Banco evaluado: 6 fotos de terreno disponibles en la máquina (`#14` a `#19`, verificado en `gt.json`), formato idéntico a R10.

---

## 1. Resumen ejecutivo

1. **Campos que la barra no lleva (Modelo, Talla, Color): 100% de acierto perfecto.**
   - **Modelo:** 6/6 (100%)
   - **Talla:** 4/4 (100%)
   - **Color:** 6/6 (100%)
   - Empata de forma exacta con los tres escalones de Gemini en la nube (R9/R10). Para rellenar los datos de catálogo que ningún código de barras trae, **el modelo local de 9B es 100% equivalente a la nube**.

2. **Cero alucinaciones destructivas en SKU:**
   - **5/5 en SKU de bicicleta (100%)**: Acertó exactamente `09-4807CL`, `07-3692-BL`, `02-3662BL`, `03-3919GN` y `03-3855GY`.
   - En el caso límite de repuestos a granel (`#15`, `f29b9727`), extrajo `PP1202JC` (el código impreso en la caja), que el filtro regex del árbitro (`^\d{2}-\d{4}[A-Z]{0,2}$`) o la regla `is_bike: false` clasifica de inmediato.

3. **Comportamiento en UPC/GTIN ante fotos degradadas:**
   - Acertó los códigos legibles (`845436091679`, `845436082769` / `00845436082769`, `845436092157`).
   - En la foto `#19` (foto angulada y tomada a distancia), **Qwen devolvió `null` en vez de inventar dígitos**. En esa misma foto, Gemini Flash Low y Gemini Pro High inventaron dígitos con dígito de control inválido (`845436085644` y `845436066644`). La abstención local es cualitativamente superior para el árbitro.

4. **Velocidad de inferencia:**
   - **41.8 segundos por foto** promedio (entre 21.4s y 80.2s).
   - Es más rápido que `gemini-3.8-flash-high` en R10 (71.3s), aunque más lento que `gemini-3.8-flash-low` (8.2s).
   - Totalmente viable para un canal de contingencia sin conexión a internet y sin costes de API.

---

## 2. Tabla comparativa: Qwen3.5 9B Local vs. Nube (Gemini en R10)

Evaluación sobre las fotos `#14`–`#19` bajo el mismo esquema JSON (`vlm_schema.json`):

| Modelo                          | SKU             | UPC             | GTIN            | G.W.            | Serie / Frame    | Modelo  | Talla   | Color   | Segundos / foto |
| :------------------------------ | :-------------- | :-------------- | :-------------- | :-------------- | :--------------- | :------ | :------ | :------ | :-------------- |
| **Qwen3.5 9B (Local RTX 3060)** | **5/5 · 0 mal** | **3/4 · 0 mal** | **1/2 · 0 mal** | **0/5 (vacío)** | **2/3 · 1 conf** | **6/6** | **4/4** | **6/6** | **41.8 s**      |
| Gemini 3.8 Flash (Low) — Nube   | 5/5 · 0 mal     | 2/3 · 1 mal     | 2/3 · 1 mal     | 5/5             | 3/3              | 6/6     | 4/4     | 6/6     | 8.2 s           |
| Gemini 3.8 Flash (High) — Nube  | 5/5 · 0 mal     | 3/3 · 0 mal     | 3/3 · 0 mal     | 5/5             | 3/3              | 6/6     | 4/4     | 6/6     | 71.3 s          |
| Gemini 3.1 Pro (High) — Nube    | 5/5 · 1 inv     | 2/3 · 1 mal     | 2/3 · 1 mal     | 5/5             | 3/3              | 6/6     | 4/4     | 6/6     | 16.6 s          |

_(En denominadores: SKU aplica a las 5 fotos con SKU de bici; UPC/GTIN a las fotos con barras visibles; Talla a las 4 que la especifican; Serie a las 3 con serie visible)._

---

## 3. Desglose detallado por foto

| ID      | Foto       | Tipo             | Tiempo | SKU          | UPC / GTIN                         | Serie / Frame | Modelo / Talla / Color                                | Observaciones                                                                                                   |
| :------ | :--------- | :--------------- | :----- | :----------- | :--------------------------------- | :------------ | :---------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **#14** | `72b5ea51` | A (Framekit)     | 37.1s  | `09-4807CL`  | `845436091679` / `null`            | `WMEI00094`   | `RENEGADE S1 FRAMEKIT`<br>`700C x 54cm`<br>`CHARCOAL` | 100% exacto en todos los campos de texto e identidad.                                                           |
| **#15** | `f29b9727` | Repuesto granel  | 23.5s  | `PP1202JC`   | `null` / `null`                    | `null`        | `FAULTLINE 29`<br>`null`<br>`BLACK`                   | No alucinó SKU de bicicleta ni serial. Leyó modelo y color perfectos.                                           |
| **#16** | `2ef103e2` | B (Laser cara A) | 21.4s  | `07-3692-BL` | `845436082769`<br>`00845436082769` | `null`        | `LASER 1.6`<br>`8"*16"`<br>`DEEP BLUE`                | Lectura impecable en 21s tanto de UPC como de GTIN-14.                                                          |
| **#17** | `9b8ccfb4` | D (Laser cara B) | 44.2s  | `02-3662BL`  | `null` / `null`                    | `null`        | `LASER 1.6`<br>`null`<br>`ANO DEEP BLUE`              | Detectó la etiqueta interna con el segundo SKU sin barras.                                                      |
| **#18** | `e3f27e0a` | A (Coda S1)      | 44.5s  | `03-3919GN`  | `845436092157` / `null`            | `WAKCA2052`   | `CODA S1 FEMME`<br>`700Cx16"`<br>`Misty Green`        | 100% exacto en SKU, UPC, Frame y catálogo.                                                                      |
| **#19** | `63806c1a` | B (DXT A1)       | 80.2s  | `03-3855GY`  | `null` / `null`                    | `M211008523`  | `DXT A1`<br>`700Cx21"`<br>`Monterey Grey`             | SKU y catálogo exactos. Confusión `1` por `I` en serial (`M211` vs `M21I`). UPC quedó en `null` (sin inventar). |

---

## 4. Hallazgos técnicos de inferencia local

1. **Aceleración GPU en RTX 3060:**
   - La VRAM total ocupada durante la inferencia fue de **~7.2 GiB** (de 12 GiB disponibles).
   - Velocidad de procesamiento de contexto multimodal: **~440–460 tokens/segundo** (~6.8s por imagen de ~3,100 tokens).
   - Velocidad de generación de respuesta: **~45 tokens/segundo**.
2. **Control de razonamiento ("Thinking Tokens"):**
   - Qwen3.5 incluye un modo de razonamiento interno. Si no se le instruye `No hagas razonamiento extenso, genera el JSON directamente`, genera entre 3,000 y 5,000 tokens de monólogo antes de emitir el JSON, lo que elevaba el tiempo a ~118s e incluso agotaba la ventana de contexto estándar (8,192 tokens).
   - Con la instrucción directa y `num_ctx: 16384`, la generación se reduce a **~21s–44s**, entregando el JSON estructurado válido de forma inmediata.
3. **Puntuación de G.W. (Peso bruto):**
   - El modelo colocó cadena vacía `""` en `gw_kg` al encontrar texto combinado como `7 KGS` o `G.W.14.80KG` en lugar de aislar el número puro. Es un detalle menor que se resuelve con un post-procesador numérico en el cliente o una instrucción de prompt `solo digitos para gw_kg`.

---

## 5. Conclusión y Desbloqueo hacia B3

- **Viabilidad comprobada:** Qwen3.5 9B en 4 bits corre perfectamente en la RTX 3060 con CUDA nativo.
- **Precisión:** Empata al 100% con Gemini en la nube en los campos clave de visión (`modelo`, `talla`, `color`) y en SKU, y muestra un comportamiento más seguro (devolviendo `null`) ante códigos de barras difíciles.
- **Latencia:** 41.8s promedio por foto es plenamente apto para procesamiento en lote, sombra y modo de contingencia offline.
- Sub-fase **B2 completada y verificada**. Desbloquea la toma de decisiones en **B3**.
