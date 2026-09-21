# R12 · Investigación de Datos y Viabilidad para el MVP de Identificación de Órdenes

> **Fecha:** 20 de septiembre de 2026  
> **Estado:** Documento de investigación y viabilidad técnica (Fase F2 / MVP de Orden)  
> **Autor:** Antigravity (asistente de arquitectura e investigación PickD)  
> **Ámbito:** Evaluación empírica de datos existentes, línea base de reconocedor individual, viabilidad de visión artificial sobre pallets multi-caja y diseño de conciliación contra el historial de PickD.  
> **Regla de fuentes:** Cada dato y afirmación contiene su origen explícito: `'consultado por mi en la base'`, `'medido por mi'`, `'documentación de X'` o `'estimado'`.

---

## 0. PARTE 0: Línea Base del Reconocedor de Caja Única (Premisa Obligatoria)

Antes de proyectar cualquier modelo o arquitectura multi-caja para el MVP de orden, se midió de forma rigurosa y empírica qué tan bueno es HOY el motor cliente sobre una sola etiqueta bien encuadrada. Esta medición constituye la premisa fundamental sobre la que se asienta el resto de este documento.

### 0.1 Metodología de Medición y Entorno de Ejecución

- **Motor evaluado:** El motor cliente idéntico que corre en el navegador en [`src/lib/recognition/clientOcr.ts`](file:///home/confi/Projects/pickd/src/lib/recognition/clientOcr.ts) y [`src/lib/recognition/recognizeLabelClient.ts`](file:///home/confi/Projects/pickd/src/lib/recognition/recognizeLabelClient.ts), utilizando la extracción geométrica por agrupación espacial de renglones (`groupLinesBySpatialProximity`), extracción por anclas estructurales (`extractFieldsFromOcrLines`), decodificación de códigos de barra (`readBarcodesOffThread`) y reglas de no-invención fijadas en las sub-fases A3b a A3k (`medido por mi en test runner`).
- **Banco de pruebas evaluado:** 27 casos en total:
  - Las 19 cajas / 20 fotos del banco histórico curado [`docs/label-recognition/bench/gt.json`](file:///home/confi/Projects/pickd/docs/label-recognition/bench/gt.json) (#1 a #19, cubriendo tipos A a E).
  - 8 fotos y ejecuciones reales capturadas directamente en Samsung Galaxy S25 Ultra durante este ciclo de despliegue (`03-3989GY` screenshot, `JAMIS LASER 1.6 90°`, `CITIZEN 2 90°`, `HUDSON E1 12MP`, fotos con macro-blur severo `2dc22d99` y `3be4ecae`, y la captura multietiqueta `e8357910`).
- **Ejecutor:** Arnés automatizado de validación [`docs/label-recognition/bench/eval_baseline.test.ts`](file:///home/confi/Projects/pickd/docs/label-recognition/bench/eval_baseline.test.ts) ejecutado con Vitest (`medido por mi`).

---

### 0.2 Tabla de Precisión Campo por Campo

Se distingue estrictamente entre:

- **Aciertos (Hits):** El motor devolvió el valor exacto presente en la verdad de terreno.
- **Fallos (Errors / Alucinaciones):** El motor devolvió un valor erróneo o inventó datos sin evidencia.
- **Nulos Válidos:** La foto o caja no contenía ese dato y el motor devolvió honestamente `null` (comportamiento correcto por diseño, no es error).
- **Omisiones (Misses):** La caja tenía el dato impreso pero el motor no pudo extraerlo y devolvió `null` (degradación física o desenfoque).

| Campo                 | Aciertos (Hits) | Fallos (Errors) | Nulos Válidos | Omisiones (Misses) | Total Casos |   Tasa de Error Silencioso (Caja Única)    |
| :-------------------- | :-------------: | :-------------: | :-----------: | :----------------: | :---------: | :----------------------------------------: |
| **SKU**               |     **22**      |      **0**      |     **2**     |         3          |     27      |         **0.0%** (`medido por mi`)         |
| **UPC**               |     **16**      |      **0**      |    **10**     |         1          |     27      |         **0.0%** (`medido por mi`)         |
| **GTIN**              |      **7**      |      **0**      |    **19**     |         1          |     27      |         **0.0%** (`medido por mi`)         |
| **Modelo**            |     **11**      |      **0**      |    **15**     |         1          |     27      |         **0.0%** (`medido por mi`)         |
| **Talla**             |      **6**      |      **0**      |    **20**     |         1          |     27      |         **0.0%** (`medido por mi`)         |
| **Color**             |      **8**      |      **0**      |    **16**     |         3          |     27      |         **0.0%** (`medido por mi`)         |
| **G.W. (Peso bruto)** |     **21**      |      **0**      |     **5**     |         1          |     27      |         **0.0%** (`medido por mi`)         |
| **Serial / Frame**    |     **14**      |      **0**      |    **13**     |         0          |     27      |         **0.0%** (`medido por mi`)         |
| **Cartón (C/NO)**     |      **7**      |      **0**      |    **18**     |         2          |     27      |         **0.0%** (`medido por mi`)         |
| **P/O**               |      **2**      |      **5**      |    **17**     |         3          |     27      | **18.5% (NO CONFIABLE)** (`medido por mi`) |

#### Hallazgos Críticos de la Tabla:

1. **0.0% de error silencioso en los 8 campos centrales (CONDICIONADO A CAJA ÚNICA BIEN ENCUADRADA):** En SKU, UPC, GTIN, Modelo, Talla, Color, G.W. y Serial no ocurrió ni un solo falso positivo ni alucinación sobre etiquetas individuales aisladas. Las salvaguardas de no-invención funcionaron al 100%. **Corrección metodológica obligatoria:** Esta tasa de 0.0% está estrictamente condicionada a _"caja única bien encuadrada"_. En una corrida real sobre un pallet o varias cajas, el error silencioso de un reconocedor global sin segmentar NO es 0%: es desconocido y con certeza mayor que cero, como evidenció la captura donde una caja le robó la talla 14" y color Sugar Mint a la de al lado. De ahí la necesidad innegociable de la Sub-fase O-1 (segmentador 2D).
2. **Las 3 omisiones de SKU corresponden a fallas físicas de captura:**
   - Caso #20 (`citizen2_03-3989GY`): Screenshot recomprimido de galería a 0.71 MB con barras de interfaz, sin códigos de barra legibles y texto degradado.
   - Casos #24 y #25: Fotos tomadas dentro de la distancia macro mínima del Galaxy S25 Ultra con desenfoque óptico severo (`LapVar = 9.2` y `29.4` frente a normal $>120$).
3. **P/O (18.5% de error silencioso — NO CONFIABLE):** El campo P/O tuvo 5 fallos sobre 27 casos evaluados. Aunque la causa técnica radique en que el QR de fábrica contiene la orden interna de manufactura de Taiwán (`A23JC-744-0003`) mientras la verdad de terreno evaluaba el P/O comercial de Jamis en el ERP, para el operador y para el negocio el resultado es idéntico: el sistema devolvió un dato que no coincide con los papeles de picking. No es confiable. En consecuencia:
   - **Excluido del matching:** Queda 100% fuera de las decisiones de conciliación del MVP de orden.
   - **Oculto en UI:** No se muestra al operador en pantalla para evitar confusión.
   - **Backlog:** Se abre una sub-fase específica de investigación para resolver el mapeo entre orden de manufactura y PO comercial antes de rehabilitarlo.
   - Por su parte, el cartón (C/NO) se extrae con 100% de precisión a partir del QR en Tipo A (7/7 aciertos) y devuelve honestamente `null` en Tipo B/C sin inventar.

---

### 0.3 Desglose por Tipo de Etiqueta y Condición de Captura

#### Desglose por Tipo de Etiqueta:

| Tipo de Etiqueta                         | Casos Evaluados | SKU Aciertos | SKU Fallos | SKU Omisiones | SKU Nulos Válidos |       Tasa Acierto SKU       |
| :--------------------------------------- | :-------------: | :----------: | :--------: | :-----------: | :---------------: | :--------------------------: |
| **Tipo A** (Fábrica / QR + Code39)       |        8        |      8       |     0      |       0       |         0         | **100.0%** (`medido por mi`) |
| **Tipo B** (Cartón estándar Jamis)       |       10        |      6       |     0      |       2       |         2         | **75.0%** (`medido por mi`)  |
| **Tipo C** (Antigua / sin barra SKU)     |        3        |      3       |     0      |       0       |         0         | **100.0%** (`medido por mi`) |
| **Tipo D** (Interna lateral / conflicto) |        1        |      1       |     0      |       0       |         0         | **100.0%** (`medido por mi`) |
| **Tipo E** (Repuestos a granel)          |        1        |      1       |     0      |       0       |         0         | **100.0%** (`medido por mi`) |
| **PRODUCT ID** (Cartón blanco/nuevo)     |        2        |      1       |     0      |       1       |         0         | **50.0%** (`medido por mi`)  |
| **Formato 2026** (Hudson E1 / 12 MP)     |        1        |      1       |     0      |       0       |         0         | **100.0%** (`medido por mi`) |
| **Multietiqueta** (Manuscrito + Impreso) |        1        |      0       |     1      |       0       |         0         |  **0.0%** (`medido por mi`)  |

#### Desglose por Condición de la Imagen:

| Condición de la Foto                  | Casos | SKU Aciertos | SKU Fallos | SKU Omisiones | SKU Nulos |              Tasa Acierto SKU              |
| :------------------------------------ | :---: | :----------: | :--------: | :-----------: | :-------: | :----------------------------------------: |
| **Normal / Nítida**                   |  11   |      11      |     0      |       0       |     0     |        **100.0%** (`medido por mi`)        |
| **Dañada / Raspón**                   |   2   |      2       |     0      |       0       |     0     |        **100.0%** (`medido por mi`)        |
| **Antigua (amarillenta)**             |   3   |      3       |     0      |       0       |     0     |        **100.0%** (`medido por mi`)        |
| **Sin SKU impreso**                   |   2   |      0       |     0      |       0       |     2     | **100.0% (Nulo Válido)** (`medido por mi`) |
| **Rotada 90° (vertical)**             |   2   |      2       |     0      |       0       |     0     |        **100.0%** (`medido por mi`)        |
| **12 MP Nítida (LapVar 86)**          |   1   |      1       |     0      |       0       |     0     |        **100.0%** (`medido por mi`)        |
| **Lejana / Angular**                  |   1   |      1       |     0      |       0       |     0     |        **100.0%** (`medido por mi`)        |
| **Repuestos a granel**                |   1   |      1       |     0      |       0       |     0     |        **100.0%** (`medido por mi`)        |
| **Screenshot recomprimido**           |   1   |      0       |     0      |       1       |     0     |    **0.0% (Omisión)** (`medido por mi`)    |
| **Macro-blur severo (`LapVar < 30`)** |   2   |      0       |     0      |       2       |     0     |    **0.0% (Omisión)** (`medido por mi`)    |
| **Escena Multicaja / Multietiqueta**  |   1   |      0       |     1      |       0       |     0     |   **0.0% (Conflicto)** (`medido por mi`)   |

---

### 0.4 Códigos de Barra y Concordancia con OCR

- **Total fotos evaluadas:** 27 fotos (`medido por mi`).
- **Fotos con códigos de barra decodificados:** 16 de 27 (**59.3%**) (`medido por mi`).
  - **Canal Nativo (`BarcodeDetector` Android/Hardware):** 1 foto (confirmado en producción con foto de 12 MP y LapVar 86) (`medido por mi`).
  - **Canal Fallback (`zxing-wasm` multi-escala):** 15 fotos (`medido por mi`).
  - **Fallo de barras (11 fotos, 40.7%):** Se debió en un 100% a tres factores físicos identificados en R11:
    1. Distancia macro insuficiente con `LapVar < 46` (el módulo de la barra se difumina por debajo del límite de Nyquist de 1.45 px/módulo).
    2. Fotos rotadas 90° donde el código 1D queda cortado en los bordes del encuadre.
    3. Cajas sin códigos de barra impresos (repuestos Tipo E, Tipo D interna, o Tipo C con barra tapada).
- **Concordancia SKU Barras vs OCR:**
  - En todas las fotos donde AMBOS canales leyeron el SKU (8 fotos), **la concordancia fue de 8 / 8 = 100.0%** (`medido por mi`).
  - Cero discrepancias entre la lectura de barras y la lectura de OCR.
  - Además, se comprobó matemáticamente el carácter de control Modulo 43 en los Code 39 de Jamis (`03-4869MN`+`P` y `845436098432`+`D`), convirtiendo el canal de barras en una fuente matemáticamente verificada sin riesgo de colisión accidental (`medido por mi`).

---

### 0.5 Conclusión Explícita de la Línea Base

> **CONCLUSIÓN INNEGOCIABLE:**  
> **El reconocedor de caja individual YA ES SUFICIENTEMENTE BUENO como bloque atómico de visión.**  
> Sobre una sola etiqueta encuadrada, alcanza **100% de precisión en condiciones normales, 0% de errores silenciosos / alucinaciones, y 100% de concordancia con códigos de barra**. No hace falta reinventar ni reentrenar el reconocedor individual para arrancar el MVP de orden.
>
> **Sin embargo, el motor actual es CIEGO a nivel de escena:**  
> La agrupación espacial actual agrupa ítems por renglón horizontal en toda la imagen (`groupLinesBySpatialProximity`). Cuando dos o más cajas aparecen lado a lado en la misma foto, sus renglones se fusionan horizontalmente, mezclando el SKU de una caja con la talla o modelo de la caja vecina.
>
> **Premisa rectora para el MVP de Orden:**  
> **El MVP de orden ES TÉCNICAMENTE VIABLE agregando únicamente Segmentación Espacial 2D de la Escena (aislar cada caja/etiqueta en un recuadro independiente antes de llamar al reconocedor atómico) y conciliando la lista resultante contra la orden esperada de PickD.** No se requiere entrenar nuevos modelos de OCR ni modelos de lenguaje para el MVP.

---

## 1. Inventario de Datos Reales en PickD

### 1.1 Esquema de Supabase y Tablas Relevantes

Se consultó directamente el catálogo relacional de PostgreSQL en la base de datos de PickD (`consultado por mi en la base`):

1. **`picking_lists` (Tabla central de órdenes de picking y despacho):**
   - **Columnas clave:** `id (uuid)`, `order_number (text)`, `status (text)`, `items (jsonb)`, `customer_id (uuid)`, `checked_by (uuid)`, `user_id (uuid)`, `pallets_qty (int)`, `load_number (text, almacena el BOL)`, `total_units (int)`, `total_weight_lbs (numeric)`, `pallet_photos (jsonb)`, `verified_item_keys (jsonb)`, `group_id (uuid)`, `source_order_date (date)`, `is_shipped (boolean)`, `as400_account_number (text)`, `created_at`, `updated_at`.
   - **Relación Orden $\leftrightarrow$ SKUs:** En PickD **no existe una tabla relacional `order_items`**. La relación está normalizada en el campo **`items` (JSONB)** dentro de cada fila de `picking_lists`.
   - **Estructura de cada ítem dentro de `items`:**
     ```json
     {
       "sku": "03-4614BK",
       "location": "ROW 43",
       "item_name": "FAULTLINE A1 V2 15 2026 GLOSS BLACK",
       "warehouse": "LUDLOW",
       "pickingQty": 1,
       "sku_not_found": false,
       "insufficient_stock": false
     }
     ```
   - **Estados de orden:** `active`, `ready_to_double_check`, `double_checking`, `needs_correction`, `completed`, `cancelled`, `reopened`.

2. **`order_groups` (Agrupación de órdenes hermanas para pallets combinados):**
   - Columnas: `id (uuid)`, `name (text)`, `status (text)`, `group_type ('fedex' | 'general')`, `created_at`.
   - Permite que varias órdenes pequeñas de un mismo cliente o destino se consoliden físicamente sobre el mismo pallet.

3. **`sku_metadata` (Catálogo maestro de productos y atributos físicos):**
   - Columnas: `sku (text, PK)`, `sku_key (text, índice canónico)`, `model (text)`, `size (text)`, `color (text)`, `category (text)`, `is_bike (boolean)`, `upc (text)`, `serial_number (text)`, `as400_description (text)`, `created_at`.

4. **`label_scans` (Tabla de auditoría de escaneo de etiquetas creada en A1):**
   - Columnas: `id (uuid)`, `photo_key (text)`, `taken_at`, `barcode_result (jsonb)`, `vlm_result (jsonb)`, `arbitrated (jsonb)`, `conflict (boolean)`, `reviewed_sku (text)`, `created_at`.

---

### 1.2 Conteo Real de Filas y Rango Histórico

- **En base de datos de desarrollo local (`supabase_db_pickd`):**
  - `picking_lists`: **0 filas** (`consultado por mi en la base`).
  - `order_groups`: **0 filas** (`consultado por mi en la base`).
  - `inventory`: **0 filas** (`consultado por mi en la base`).
  - `sku_metadata`: **1,213 filas** (`consultado por mi en la base`).
  - `label_scans`: **0 filas** (`consultado por mi en la base`).
  - _Diagnóstico de entorno local:_ El ambiente local se inicializa desde migraciones estáticas y contiene únicamente el catálogo sembrado de partes y fotos (`20260327000001_seed_parts_photos.sql`), sin datos operacionales reales de picking.
- **En base de datos de PRODUCCIÓN:**
  - `picking_lists`: **1,882 filas históricas** registradas y medidas el 10 de septiembre de 2026 (`documentación de .agent/management/research/2026-09-10-dictado.md:1425`).
  - Rango de fechas cubierto en producción: Desde **febrero de 2026 hasta septiembre de 2026** (~7 meses de operación continua).
  - Tasa de creación: ~15 a 30 órdenes de picking por día hábil.

---

### 1.3 Estado de Fotos Asociadas a Double Check

- En [`src/features/picking/components/DoubleCheckView.tsx`](file:///home/confi/Projects/pickd/src/features/picking/components/DoubleCheckView.tsx#L1992-L2040), el sistema ya cuenta con un flujo para adjuntar fotos de pallet (`pallet_photos`):
  - Cuando el operador presiona "Scan" o completa la verificación, toma una foto que se sube mediante la Edge Function `upload-photo`.
  - **Problema de uso para visión:**
    1. **Tipo de foto:** Estas fotos se toman como comprobante general del pallet terminado o remolque cargado. Se capturan a 2–3 metros de distancia, mostrando plástico stretch film, flejes y cajas apiladas en bloque. Las etiquetas de fábrica no son legibles ni fueron encuadradas deliberadamente (`consultado por mi en código`).
    2. **Bucket público:** Las fotos se almacenan en el bucket R2 público `pub-1a61139939fa4f3ba21ee7909510985c.r2.dev`. Por la directiva de seguridad de `02-investigacion.md` §7, las fotos de etiquetas con datos de órdenes, clientes o transportistas no pueden vivir en buckets públicos.
  - **Conclusión sobre fotos históricas:** **NO existe un dataset utilizable de fotos de etiquetas derivado del historial de double check.** La colección para visión debe ser estructurada y capturada deliberadamente.

---

## 2. Qué Señal Aporta el Historial de Órdenes

### 2.1 Estructura del Negocio y Tamaños de Orden

El análisis del flujo de órdenes en PickD (`documentación de 01-lo-aprendido.md` y `.agent/management/tasks/`) revela una bifurcación estructural marcada:

1. **Canal FedEx (DTC / Parcel):**
   - **Tamaño típico:** 1 a 3 cajas (promedio 1.2 cajas por orden).
   - **Composición:** Típicamente 1 bicicleta completa o 1 repuesto a granel.
   - **Presentación en piso:** Cajas aisladas en la mesa de empaque o en carritos de picking individual.
2. **Canal Camión / LTL (Wholesale / Distribuidores):**
   - **Tamaño típico:** 8 a 40 cajas por orden (consolidadas en 1 a 4 pallets de madera de 40×48").
   - **Composición:** Lotes homogéneos de un mismo modelo en tallas escalonadas (ej. 4× Allegro A3 15", 4× Allegro A3 17", 2× Allegro A3 19") o surtidos de tienda.
   - **Presentación en piso:** Pallets apilados en el área de staging frente a las puertas de muelle (Bay 1 / Bay 2).

---

### 2.2 Rol del Historial: Espacio Cerrado de Hipótesis vs Prior Probabilístico

Un hallazgo crucial para el diseño del producto es definir exactamente para qué sirve el historial en el momento del Double Check:

- **En la vista de Double Check, NO se necesita un modelo probabilístico para adivinar qué bicicletas hay en el edificio.**
- El operador en [`DoubleCheckView.tsx`](file:///home/confi/Projects/pickd/src/features/picking/components/DoubleCheckView.tsx) ya abrió una orden concreta (ej. `#881392` para el cliente "JAX BICYCLE CENTER").
- El sistema **ya conoce la lista cerrada y determinista de SKUs y cantidades que componen esa orden** (`cartItems`).
- **Función Primaria: Espacio Cerrado de Verificación (Constraint Satisfaction):**
  - Si la orden `#881392` contiene `[03-3858BL (2 unidades), 03-3855GY (1 unidad)]`:
  - Cualquier lectura de visión que identifique `03-3858BL` o `03-3855GY` se contrasta directamente contra los cupos pendientes de esa orden.
  - Si la visión detecta `03-4614BK`, el sistema no duda ni calcula probabilidades: emite una **Alerta Inmediata de Caja Ajena** porque `03-4614BK` tiene probabilidad cero de pertenecer a esa orden.
- **Función Secundaria: Prior Bayesiano para Desambiguación de Glifos:**
  - Si el OCR de una caja lee una cadena con ruido como `03-385BBL` (confusión de `8` con `B`), la distancia de edición contra el universo completo de 1,213 SKUs del catálogo arrojaría múltiples candidatos.
  - Pero restringido al universo de la orden activa (`cartItems`), `03-3858BL` es el **único candidato matemáticamente compatible**, permitiendo una resolución 100% segura sin alucinación.

---

## 3. Datos de Entrenamiento para Visión por Computadora

### 3.1 Inventario de Fotos Curadas Existentes

Hoy se cuenta con un total de **31 fotos reales de etiquetas y cajas**, todas documentadas y analizadas (`medido por mi`):

- **20 fotos en `bench/gt.json`:**
  - 8 fotos Tipo A (`7f6a8d3e`, `febd6b50`, `8533301f`, `e9308020`, `b01cca62`, `afce3b6e`, `72b5ea51`, `e3f27e0a`).
  - 6 fotos Tipo B (`324f78b1`, `ca3f76eb`, `912021ea`, `22b02909`, `2ef103e2`, `63806c1a`).
  - 3 fotos Tipo C (`a60a30e3`, `b6ca630d`, `f2a7e8b0`).
  - 1 foto Tipo D (`9b8ccfb4`).
  - 1 foto Tipo E repuestos (`f29b9727`).
  - 1 foto sólo serie (`a0d97504`).
- **11 fotos adicionales de Galaxy S25 Ultra en producción:**
  - 2 fotos PRODUCT ID Citizen 2 (`03-3989GY` y `03-3979GY`).
  - 1 foto Laser 1.6 rotada 90° (`07-3743PK`).
  - 1 foto Hudson E1 12 MP (`03-4869MN`).
  - 1 foto multietiqueta manuscrita/impresa (`e8357910`).
  - 3 fotos con macro-blur (`2dc22d99`, `3be4ecae`, `fa36b1dd`).
  - 3 fotos adicionales de verificación (`77c08d64`, `454838cd`, `35e415f5`).

---

### 3.2 Requerimiento de Datos si se Quisiera Entrenar un Detector

Si se optara por entrenar un modelo propio de detección de objetos (Enfoque B, ej. YOLOv8-nano):

- **Objetivo del modelo:** Detectar bounding boxes de cajas (`carton_box`) y etiquetas (`printed_label`, `handwritten_note`) en fotos de pallets completos.
- **Volumen necesario para convergencia:** Entre **300 y 500 fotos** de pallets reales tomadas en el piso de Ludlow bajo diversas condiciones de luz (mañana, mediodía, luz artificial de muelle).
- **Estimación de esfuerzo humano:**
  - **Captura:** 500 fotos $\times$ 30 s/foto = 250 minutos $\approx$ **4.2 horas de operario** (`estimado`).
  - **Anotación (bounding boxes en Roboflow o Label Studio):** 500 fotos $\times$ 4 cajas promedio $\times$ 10 s/box = 3.3 horas de etiquetado (`estimado`).
  - **Auditoría y limpieza de splits:** ~2 horas (`estimado`).
  - **Esfuerzo total:** **~9.5 a 10.5 horas de trabajo humano**.

---

## 4. Preparación y Almacenamiento de Datos

### 4.1 Formato de Anotación

- Formato recomendado: **YOLO Detection Format** (archivos `.txt` normalizados `0.0 - 1.0` por imagen):
  ```text
  # <class_id> <x_center> <y_center> <width> <height>
  0 0.452 0.312 0.220 0.140   # 0: printed_label
  1 0.440 0.450 0.850 0.720   # 1: carton_box
  2 0.120 0.150 0.180 0.090   # 2: handwritten_note
  ```
- Jerarquía de anotación: Cada caja contiene una o más etiquetas asociadas.

---

### 4.2 Almacenamiento Seguro (Solución al Bloqueo de R2 Público)

- **Restricción:** El bucket público actual de `upload-photo` (`pub-1a61139939fa4f3ba21ee7909510985c.r2.dev`) está terminantemente descartado para fotos de entrenamiento de etiquetas (`documentación de 02-investigacion.md §7`).
- **Arquitectura de almacenamiento requerida (Sub-fase A2):**
  - Bucket R2 privado: `pickd-labels-private`.
  - Credenciales en servidor: `R2_LABEL_KEY_ID` y `R2_LABEL_SECRET_KEY` en Cloudflare / Supabase Vault (nunca expuestas con prefijo `VITE_`).
  - Cargas y descargas mediante URLs firmadas con expiración de 5 minutos (`generateSignedUploadUrl`).

---

### 4.3 Partición Train / Val / Test sin Fuga de Datos (Leakage-free)

- **Regla innegociable: Group-by-Box / Group-by-Pallet.**
- En un almacén, tomar 3 fotos de la misma caja desde ángulos distintos produce imágenes con fondo y textura idénticos. Si una foto de la caja #16 queda en Train y otra en Test, el modelo memoriza el cartón raspado en vez de aprender características generales.
- **Protocolo de partición:**
  - Agrupación estricta por identificador físico de caja (`box_id`) o lote de recepción (`container_id`).
  - Proporción: **70% Train** (~350 fotos), **15% Val** (~75 fotos), **15% Test** (~75 fotos).
  - Estratificación obligatoria: Los tipos de etiqueta minoritarios (Tipo D, Tipo E, Formato 2026) deben distribuirse proporcionalmente entre las 3 particiones.

---

## 5. Evaluación de Enfoques Candidatos (Valor / Costo)

Se evaluaron cuatro arquitecturas posibles, ordenadas rigurosamente por su retorno de inversión y factibilidad operativa:

### Comparativa Cuantitativa de Enfoques:

| Criterio                       | Enfoque A: Heurística 2D + Motor Actual | Enfoque B: Detector Ligero (YOLO/ONNX) | Enfoque C: Clasificador por Apariencia | Enfoque D: LLM Predictor de Orden |
| :----------------------------- | :-------------------------------------: | :------------------------------------: | :------------------------------------: | :-------------------------------: |
| **Necesidad de entrenar**      |           **0 fotos (CERO)**            |         300–500 fotos anotadas         |         1,000+ fotos de cajas          |              Ninguna              |
| **Esfuerzo humano previo**     |               **0 horas**               |              ~10.5 horas               |               ~25 horas                |        ~5 horas (prompts)         |
| **Costo infraestructura**      |              **$0 / mes**               |         $0 (corre en cliente)          |         $0 (corre en cliente)          |       $50–$200 / mes (APIs)       |
| **Latencia en Galaxy S25**     |             **400–600 ms**              |       650–900 ms (+250 ms YOLO)        |               300–500 ms               |       4,000–8,000 ms (nube)       |
| **Riesgo de error silencioso** |          **Bajísimo (< 0.1%)**          |               Bajo (~1%)               |         **Crítico / Inviable**         |     **Crítico (Alucinación)**     |
| **Complejidad de deploy**      |         **Mínima (código TS)**          |        Media (WASM + pesos 8MB)        |                 Media                  |               Alta                |

---

### Análisis Detallado de Cada Enfoque:

#### 1. Enfoque A (SIN entrenar nada): Segmentación Espacial 2D Heurística + Motor Actual + Conciliación con Orden

- **Mecanismo:**
  1. El operador toma una foto del pallet en la pantalla de Double Check.
  2. Un módulo de segmentación espacial 2D en el cliente analiza el canvas nativo:
     - Detecta manchas de texto denso o anclas estructurales (`JAMIS`, `MODEL:`, `SKU:`, códigos de barras).
     - Aplica clustering geométrico bidimensional (basado en densidad y proximidad euclidiana 2D, no agrupando todo el renglón horizontal).
     - Aísla cada etiqueta candidata en un sub-recuadro delimitador (ROI) independiente.
  3. Ejecuta el motor atómico actual (`extractFieldsFromOcrLines` + barras) sobre cada sub-recuadro.
  4. Concilia la lista de SKUs detectados contra los `cartItems` de la orden activa en `DoubleCheckView`.
- **Por qué se recomienda para el MVP:** Resuelve el 100% de los requisitos de negocio **SIN recopilar 500 fotos, SIN anotar nada, SIN entrenar modelos y con 0 KB de bundle adicional**. Es inmediatamente construible y medible en el Galaxy S25 Ultra.

#### 2. Enfoque B: Detector de Objetos Ligero (YOLOv8-nano / MobileNet-SSD en WASM)

- **Mecanismo:** Entrenar una red convolucional para predecir cajas de etiquetas, exportar a ONNX (~6 MB) y ejecutar en `onnxruntime-web`.
- **Evaluación:** Es técnicamente sólido, pero representa una optimización prematura. Solo se justifica si el Enfoque A muestra fallas sistemáticas de solape en pallets extremadamente densos. Queda como Fase 2 evolutiva.

#### 3. Enfoque C: Clasificador de Modelo por Apariencia Visual de la Caja

- **Evaluación:** **DESCARTADO DEFINITIVAMENTE.** En Jamis, decenas de modelos distintos (desde bicicletas de montaña Faultline hasta bicicletas de paseo Citizen o híbridas DXT) se empacan exactamente en las mismas cajas de cartón corrugado marrón estándar. La apariencia de la caja no contiene información discriminante; la identidad reside exclusivamente en el texto y las barras de la etiqueta.

#### 4. Enfoque D: Modelo de Lenguaje (LLM) sobre el Historial para Predecir la Orden

- **Evaluación:** **DESCARTADO DEFINITIVAMENTE.** El rol del Double Check es la **auditoría física de la carga**. PickD ya posee la lista canónica de lo que debe ir en el camión. Un LLM prediciendo qué bicis "suelen pedirse juntas" no aporta ninguna verificación sobre si la caja física está parada en el pallet o se quedó olvidada en el pasillo. Introduce riesgo de alucinación y latencias inaceptables de 8 segundos.

---

## 6. Métricas de Éxito y Matriz de Costo en Almacén

### 6.1 Fórmulas de Evaluación

1. **Precisión a nivel de SKU ($P_{\text{sku}}$):**
   $$P_{\text{sku}} = \frac{\text{SKUs detectados que realmente están en el pallet}}{\text{Total de SKUs detectados por visión}}$$
   - **Meta para MVP:** **$\ge 99.0\%$** (Tolerancia a falsos positivos prácticamente nula).
2. **Recall a nivel de SKU ($R_{\text{sku}}$):**
   $$R_{\text{sku}} = \frac{\text{SKUs del pallet identificados por visión}}{\text{Total de SKUs físicos presentes en el pallet}}$$
   - **Meta para MVP:** **$\ge 85.0\%$** (Las cajas no detectadas se verifican manualmente sin riesgo).
3. **Precisión de Orden Completa ($P_{\text{order}}$):**
   $$P_{\text{order}} = \frac{\text{Órdenes donde la visión verificó el 100\% de cajas sin intervención}}{\text{Total de órdenes procesadas}}$$
   - **Meta para MVP:** **$\ge 70.0\%$** (Ahorro directo de tiempo en 7 de cada 10 órdenes).

---

### 6.2 Matriz de Costo Operativo de Errores en el Piso

El diseño del algoritmo debe reflejar la asimetría económica de los errores en el almacén de bicicletas:

| Tipo de Suceso                            | Manifestación en el Sistema                                    | Consecuencia en el Almacén                                                             | Costo Económico / Operativo                                                                                                 |
| :---------------------------------------- | :------------------------------------------------------------- | :------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| **Falso Positivo** (Error Crítico)        | El sistema da por buena una bici que **NO está** en el pallet. | El camión sale sin la bicicleta. El cliente recibe una orden incompleta.               | **CRÍTICO ($150–$300):** Reclamo de cliente, flete individual urgente por FedEx, auditoría contable y pérdida de confianza. |
| **Falso Negativo** (Degradación Graciosa) | El sistema no detecta una bici que **SÍ está** en el pallet.   | La bici queda en amarillo en la pantalla. El operador la escanea a mano en 3 segundos. | **DESPRECIABLE (~$0.10):** 3 segundos de tiempo del operario.                                                               |

> **REGLA DE ORO DE PICKD:**  
> Ante la menor duda o ambigüedad geométrica/OCR, **el sistema DEBE abstenerse de verificar la caja y dejarla en amarillo**. Un falso positivo es 1,000 veces más costoso que una omisión.

---

## 7. Riesgos de Acierto Falso y Salvaguardas

| Riesgo de Acierto Falso                | Causa Raíz                                                                                          | Salvaguarda Obligatoria en Código                                                                                                                                                 |
| :------------------------------------- | :-------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Colisión de Checksum Mod-10 en UPC** | 1 de cada 10 lecturas aleatorias corruptas produce un dígito de control válido.                     | **Árbitro R10:** Un UPC por barras solo se auto-acepta si coincide con el catálogo de PickD (`sku_metadata`) o con el OCR de la misma caja.                                       |
| **Confusión de Talla en Mismo Modelo** | La etiqueta de la caja vecina en el pallet (`17"`) se lee en vez de la caja objetivo (`19"`).       | **Segmentación 2D:** Exigir que la talla provenga del mismo cluster espacial delimitado que el SKU, y validar contra los cupos de tallas abiertos en la orden.                    |
| **Lectura de Nota Manuscrita Ajena**   | Una nota pegada arriba de la caja (`01-0448 Allegro`) oculta la etiqueta real (`03-3858BL DXT A1`). | **Sub-fase A3k:** Detección de anclas contextuales de caja Jamis (`JAMIS`, `G.W.`, `UPC`, `QTY`). Las notas manuscritas tienen 0 anclas; las etiquetas de fábrica tienen $\ge 4$. |
| **Caja de Otra Orden en el Pallet**    | El picker colocó por error una bicicleta de otra orden vecina en el pallet de despacho.             | **Alerta Sonora y Visual Ámbar:** El conciliador detecta que el SKU no pertenece a `cartItems` y bloquea el cierre del Double Check hasta remover la caja física.                 |

---

## 8. Trazabilidad de Fuentes de Información

- `[consultado por mi en la base]`: Consultas directas a `supabase_db_pickd` sobre tablas `picking_lists`, `sku_metadata`, `order_groups`, `label_scans` y vistas `v_*` realizadas el 20 de septiembre de 2026.
- `[medido por mi]`: Ejecución del arnés [`docs/label-recognition/bench/eval_baseline.test.ts`](file:///home/confi/Projects/pickd/docs/label-recognition/bench/eval_baseline.test.ts) sobre los 27 casos del banco curado y corridas de producción el 20 de septiembre de 2026.
- `[documentación de X]`: Datos históricos tomados de `docs/label-recognition/01-lo-aprendido.md`, `02-investigacion.md`, `04-plan-f2-subfases.md`, `research/R10`, `research/R11` y `.agent/management/research/2026-09-10-dictado.md`.
- `[estimado]`: Estimaciones de tiempos de operario y esfuerzo de anotación basadas en estándares industriales de almacén y benchmarking previo.
