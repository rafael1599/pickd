# R10 · Evaluación empírica de 6 cajas nuevas: repuestos, contradicción multietiqueta y PO alfanumérico

> **18 de septiembre de 2026.** Ampliación del banco de pruebas a 19 cajas (20 fotos en `bench/gt.json`), incorporando 6 fotos nuevas enviadas por Rafael (`/home/confi/.claude/uploads/26a63557-6830-40d9-9d43-85353dc4aa09/`).
> Se evaluaron códigos de barras con `zxing-cpp` y visión multimodal con tres escalones de Gemini (`gemini-3.8-flash-low`, `gemini-3.8-flash-high`, `gemini-3.1-pro-high`) mediante el arnés de Antigravity (`run_vlm_agy.sh`).

---

## 1. Resumen ejecutivo

Las 6 cajas nuevas aportaron tres casos límite que no existían en las 13 cajas originales:

1. **Repuestos a granel sin barras ni SKU de bici (#15, `f29b9727`):** Caja de 10 piezas de chainstay (`PP1202JC`, `CHIAN STAY`, `FAULTLINE 29`, `10 PCS`). Flash Low y Flash High pusieron `sku: null` sin inventar un SKU; Pro High puso `CHIAN STAY` (el texto de `ITEM:`). El filtro regex de SKU del árbitro (`^\d{2}-\d{4}[A-Z]{0,2}$`) lo rechaza limpiamente en ambos casos.
2. **Conflicto directo de SKU en la misma caja (#16 vs #17, `2ef103e2` y `9b8ccfb4`):** La cara frontal (etiqueta de fábrica B) dice `07-3692-BL` con códigos de barras UPC/GTIN. La cara lateral (etiqueta interna D) dice `02-3662BL`.
   - **Hallazgo crítico de diseño:** Al consultar a Gemini en texto libre con ambas fotos, el modelo detecta y explica la discrepancia con claridad. Pero al forzarlo a un esquema JSON estructurado con un único campo `sku`, el modelo **resuelve en silencio**, devolviendo `07-3692-BL` y descartando `02-3662BL` sin alertar. La detección de etiquetas contradictorias **no puede delegarse al VLM**: debe vivir en el árbitro de código y en la interfaz humana.
3. **PO no numérico / muestra (#18, `e3f27e0a`):** La caja indica `PO NO.: UCC sample`. Tanto Flash como Pro extraen el literal exacto (`UCC sample`) sin forzar un número inventado ni fallar la extracción.

---

## 2. Resultados de códigos de barras (`zxing-cpp`)

Corridos con `bench_barcodes.py` sobre las 6 fotos nuevas:

| ID     | Foto       | Tipo Etiqueta     | Código decodificado por barras                  | Simbología           | Tiempo S0 |
| ------ | ---------- | ----------------- | ----------------------------------------------- | -------------------- | --------- |
| **14** | `72b5ea51` | A (Framekit)      | `09-4807CL`<br>`WMEI00094` (vía QR)             | Code 39<br>QR Code   | 38.7 ms   |
| **15** | `f29b9727` | Repuesto a granel | _(Ninguno — sin barras)_                        | —                    | 52.5 ms   |
| **16** | `2ef103e2` | B (Laser 1.6)     | `845436082769` (UPC)<br>`00845436082769` (GTIN) | Code 128<br>Code 128 | 54.3 ms   |
| **17** | `9b8ccfb4` | D (Interna Laser) | _(Ninguno — sin barras)_                        | —                    | 40.0 ms   |
| **18** | `e3f27e0a` | A (Coda S1)       | `WAKCA2052`, carton `B2` (vía QR)               | QR Code              | 44.7 ms   |
| **19** | `63806c1a` | B (DXT A1)        | _(No resuelto en foto lejana)_                  | —                    | 39.2 ms   |

**Observaciones de barras:**

- En la foto 14 y 18, el **código QR de las etiquetas Tipo A** entrega el número de frame (`WMEI00094`, `WAKCA2052`) y el cartón de forma limpia en <45 ms.
- En la foto 16, a pesar de que el código de barras UPC impreso tenía un raspón superficial vertical, zxing lo decodificó perfectamente como Code 128 tanto en UPC-12 como en GTIN-14.
- En la foto 19, la distancia y ángulo de la toma impidieron la decodificación por defecto sin recorte previo.

---

## 3. Resultados de Visión Multimodal (VLM)

Evaluación en las 6 fotos nuevas con los tres escalones de Gemini:

| Modelo                      | SKU         | UPC         | GTIN        | G.W. | Serie / Frame | Modelo | Talla | Color | Segundos / foto |
| --------------------------- | ----------- | ----------- | ----------- | ---- | ------------- | ------ | ----- | ----- | --------------- |
| **Gemini 3.8 Flash (Low)**  | 5/5 · 0 mal | 2/3 · 1 mal | 2/3 · 1 mal | 5/5  | 3/3           | 6/6    | 4/4   | 6/6   | **8.2 s**       |
| **Gemini 3.8 Flash (High)** | 5/5 · 0 mal | 3/3 · 0 mal | 3/3 · 0 mal | 5/5  | 3/3           | 6/6    | 4/4   | 6/6   | 71.3 s          |
| **Gemini 3.1 Pro (High)**   | 5/5 · 1 inv | 2/3 · 1 mal | 2/3 · 1 mal | 5/5  | 3/3           | 6/6    | 4/4   | 6/6   | 16.6 s          |

_(En denominadores: SKU aplica a las 5 fotos con SKU de bici; UPC/GTIN a las 3 que los llevan impresos; Talla a las 4 que la especifican; Serie a las 3 con serial/frame visible)._

### Detalle de discrepancias detectadas:

1. **Error de glifo en UPC (#19, `63806c1a`):**
   - Verdad de terreno: `845436086644`.
   - **Flash Low dijo:** `845436085644` (confusión de `6` por `5`).
   - **Pro High dijo:** `845436066644` (confusión de `8` por `6`).
   - **Flash High dijo:** `845436086644` (correcto tras 161s de cómputo).
   - **Lección:** Tanto Flash Low como Pro High produjeron códigos UPC con **dígito de control inválido**. La regla de validación de Luhn/UPC descarta inmediatamente ambas lecturas erróneas.
2. **Asignación de SKU en repuesto a granel (#15, `f29b9727`):**
   - Etiqueta indica `ITEM: CHIAN STAY`.
   - Flash Low y Flash High devolvieron `sku: null`.
   - Pro High devolvió `sku: "CHIAN STAY"`.
   - El árbitro regex descarta `"CHIAN STAY"` al no coincidir con `^\d{2}-\d{4}[A-Z]{0,2}$`.

---

## 4. Pruebas de los tres casos límite

### Caso A: Repuestos a granel (`f29b9727`)

- **Impreso:** `PP1202JC · C/NO. D0004 · ITEM: CHIAN STAY · MODEL: FAULTLINE 29 · COLOR: BLACK · Q'TY: 10 PCS · G.W.: 12.00 KGS`.
- **Comportamiento del VLM:** Modelo (`FAULTLINE 29`), Color (`BLACK`) y Peso (`12.00`) fueron leídos al 100% de exactitud por los tres modelos.
- **Manejo de identidad:** Al no ser un SKU de bicicleta, la combinación de `ITEM: CHIAN STAY` y `QTY: 10 PCS` debe marcar `is_bike: false`. PickD no debe intentar cruzarlo contra el catálogo de cuadros completos.

### Caso B: Contradicción multietiqueta en la misma caja (`2ef103e2` vs `9b8ccfb4`)

- **Foto 16 (fábrica):** `07-3692-BL` · `UPC: 845436082769` · `GTIN: 00845436082769` · `LASER 1.6` · `DEEP BLUE`.
- **Foto 17 (lateral interna):** `02-3662BL` · `LASER 1.6` · `ANO DEEP BLUE`.
- **Experimento:**
  - _Prompt libre conversacional:_ Gemini reconoce que son caras distintas y señala explícitamente: _"Existe una discrepancia directa en el SKU: una cara indica 07-3692-BL y la otra 02-3662BL"_.
  - _Prompt con JSON Schema estructurado:_ El modelo entrega un único objeto con `sku: "07-3692-BL"` (escogiendo la etiqueta que tiene código de barras) y oculta por completo la existencia de `02-3662BL`.
- **Conclusión arquitectónica:** Si dos fotos de una misma caja reportan candidatos distintos, el árbitro en código debe forzar confianza cero y presentar ambas opciones en pantalla para que el operador del almacén resuelva la ambigüedad.

### Caso C: PO alfanumérico / muestra (`e3f27e0a`)

- **Impreso:** `PO NO.: UCC sample`.
- **Comportamiento:** Ambos modelos devolvieron literalmente `UCC sample`. No se forzó ningún formato de año ni número inventado. El campo en base de datos debe ser `text`, no asumir máscara numérica estricta `^\d{4}-\d{2}$`.

---

## 5. Impacto en las fases del plan (`02-investigacion.md` §6)

El hallazgo de las etiquetas contradictorias tiene un impacto directo en el diseño de la experiencia de usuario:

- **En F1 (Barras bien hechas):** Si la caja tiene múltiples etiquetas o si el operador toma 2 fotos de caras distintas, la interfaz no debe sobrescribir silenciosamente una lectura con la otra. Si se detectan dos SKU o dos UPCs distintos para una misma caja, la UI debe mostrar ambas tarjetas con selector interactivo ("¿Cuál es la etiqueta válida?").
- **En F2 (Motor en sombra):** La Edge Function debe incluir soporte para `is_bike: boolean` y `conflicting_candidates: string[]` en el payload de `label_scans`.
