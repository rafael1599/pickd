# R14: Sesión de Verificación en Vivo Caja por Caja (Track A)

**Fecha:** 21 de Septiembre de 2026  
**Autor:** Antigravity (AI Agent, Track A)  
**Aprobado por:** Rafael (Cambio de rumbo mayor de arquitectura)  
**Estado:** Implementado, verificado con tests unitarios e integración local Docker, listo para prueba de piso.

---

## 1. Resumen Ejecutivo y Fundamentos del Cambio de Rumbo

En la sesión del 20 de septiembre de 2026 se acordó suspender el paradigma de **"una sola foto del pallet completo que identifica todo"** y pivotar hacia una **Sesión de Verificación en Vivo Caja por Caja**.

### 1.1 ¿Por qué este cambio resuelve de raíz los problemas anteriores?

1. **Problema Óptico Resuelto:** A distancia de lectura cómoda (20 a 35 cm), una etiqueta de cartón llena entre el 50% y 80% del encuadre de la cámara del Samsung Galaxy S25 Ultra. La densidad de píxeles resultante es $\ge 5.0\text{ px/mm}$, lo que garantiza $\ge 1.88\text{ px/módulo}$ en códigos 13-mil Code 39 (superando holgadamente el límite de Nyquist de $1.45\text{ px/módulo}$) y alturas de glifo $\ge 16\text{ px}$ para OCR.
2. **Segmentación Multi-Caja:** Se opera sobre una sola etiqueta a la vez en el centro del visor. En el banco empírico de 27 fotos, el caso de una sola etiqueta tiene **0.0% de error silencioso**. Se construye la solución sobre lo que ya está probado y libre de alucinaciones.
3. **Conteo Físico Real vs. Adivinanza Neuronal:** En R13 se demostró matemáticamente y con datos de piso que los pallets estibados en profundidad ocultan cajas en su interior. Un detector por visión computacional sólo puede contar caras visibles externas. El nuevo flujo cuenta tocando: **un toque del operador = una caja verificada**.
4. **Oclusión Superada Ergonómicamente:** El operador camina alrededor del pallet con el teléfono en la mano escaneando caja por caja. Las caras ocultas desde un ángulo frontal son accesibles conforme el operador rodea la carga.

Los componentes anteriores O-1 (`labelSegmenter.ts`) y O-2 (`recognizeMultiBoxClient.ts`) quedan formalmente **congelados** en su estado actual, sin riesgo de regresión.

---

## 2. Perfil Histórico de Despachos y Candidatos de Piso (Sub-fase L-0)

### 2.1 Perfil de la Distribución de Órdenes Reales

Un análisis exhaustivo sobre **1,928 órdenes históricas despachadas** en Pickd revela la siguiente distribución por cantidad de bicicletas:

| Rango de Bicicletas | Cantidad de Órdenes | Porcentaje Histórico | Acumulado |
| :------------------ | :-----------------: | :------------------: | :-------: |
| **1 a 2 bicis**     |        1,017        |        52.7%         |   52.7%   |
| **3 a 6 bicis**     |         297         |        15.4%         | **68.1%** |
| 7 a 15 bicis        |         312         |        16.2%         |   84.3%   |
| 16+ bicis           |         302         |        15.7%         |  100.0%   |

> **Conclusión Clave:** El perfil objetivo del MVP (órdenes de 1 a 6 bicicletas) cubre de forma nativa el **68.1% de todos los despachos históricos** de la bodega.

### 2.2 Reconciliación Mandatoria por `order_group`

- El **45.5% de los despachos históricos con fotos** corresponden a órdenes combinadas que comparten `group_id`.
- Intentar verificar un pallet contra una sola orden generaba falsas alarmas de "cajas ajenas" en casi la mitad de los casos.
- La sesión en vivo concilia de forma unificada contra **todo el grupo de órdenes**.

### 2.3 Órdenes de Prueba Seleccionadas en Piso para Validación Mañana

1. **Orden Simple `#881650`:**
   - 5 bicicletas (0 partes).
   - 1 pallet estibado.
   - Estado: `ready_to_double_check` (`is_shipped: false`).
   - SKUs comprobados en catálogo: `03-3989GY`, `06-4573GY`, etc.

2. **Orden Simple `#881649`:**
   - 4 bicicletas (0 partes).
   - 1 pallet estibado.
   - Estado: `ready_to_double_check` (`is_shipped: false`).

3. **Orden Combinada `#881555` + `#881635` (Mismo `group_id`):**
   - 2 bicis en `#881555` + 4 bicis en `#881635` = 6 bicis totales.
   - 1 solo pallet consolidado.
   - Valida la distribución automática de cajas entre órdenes del mismo grupo sin fricción.

4. **Orden Mixta `#881656` + `#881657` (Bicis + Partes):**
   - 1 bicicleta + 15 ítems de repuestos/partes (`is_bike: false`).
   - Valida la Población C y el gesto de confirmación de lote completo para partes.

---

## 3. Arquitectura del Sistema Implementado (Sub-fases L-1 a L-6)

El desarrollo se organizó en 6 submódulos desacoplados en `src/features/recognition/liveSession/`:

```
src/features/recognition/liveSession/
├── opticalGeometry.ts               # Sub-fase L-1: Cálculos ópticos, HFOV y zonas seguras
├── liveBarcodeScanner.ts            # Sub-fase L-1: Consenso multi-frame y extracción Mod-43
├── liveSessionState.ts              # Sub-fase L-2: Máquina de estado inmutable
├── groupReconciler.ts               # Sub-fase L-3: Arbitraje de Poblaciones A, B, C y deduplicación
├── partsBatchHandler.ts             # Sub-fase L-4: Gesto de confirmación por lote para partes
├── orderCompleter.ts                # Sub-fase L-5: Finalización y generación de verified_item_keys
├── LiveCheckScreen.tsx              # Sub-fase L-6: Componente UI para Samsung Galaxy S25 Ultra
└── __tests__/                       # Suite exhaustiva de tests unitarios e integración
    ├── opticalGeometry.test.ts      # 4 tests
    ├── liveBarcodeScanner.test.ts   # 8 tests
    ├── groupReconciler.test.ts      # 6 tests
    ├── liveSessionState.test.ts     # 5 tests
    ├── orderCompleter.test.ts       # 4 tests
    └── orderCompleter.docker.test.ts# 1 test (Integración real local container)
```

### 3.1 Sub-fase L-1: Geometría Óptica y Consenso Multi-Frame

- **Perfil de Cámara S25 Ultra:** HFOV de $68^\circ$, distancia mínima de enfoque de 150 mm para evitar desenfoque macro (`LapVar < 30`).
- **Resolución a 250 mm:** Densidad de $5.69\text{ px/mm}$. Con barras estrechas de $0.33\text{ mm}$, cada barra ocupa $\approx 1.88\text{ px}$, muy superior al límite de decodificación.
- **Consenso Temporal (`TemporalConsensusFilter`):** Requiere 2 lecturas consecutivas idénticas dentro de una ventana móvil de 600 ms antes de emitir una propuesta en el visor. Esto descarta transitorios, reflejos especulares de plástico stretch y falsos positivos de un solo cuadro.
- **Validación Mod-43:** Decodificación nativa de Code 39 con verificación de dígito checksum (alfabeto de 43 caracteres).

### 3.2 Sub-fase L-2: Máquina de Estado Inmutable (`liveSessionState.ts`)

- **Principio: "Un toque = una caja".** La cámara propone candidatos, pero jamás incrementa el conteo de forma silenciosa o automática.
- Cada confirmación crea un registro atómico `ConfirmedBox` con timestamp, SKU, serial (si aplica) y orden destino.
- **Operación de Deshacer (`undoLastConfirmation`):** Si el operador toca por error, un toque en "Deshacer última" revierte exactamente la última caja, descuenta la cantidad verificada y libera el serial registrado.

### 3.3 Sub-fase L-3: Conciliador Multi-Orden y Clasificación Tripartita

El reconciliador evalúa el candidato contra el ledger conjunto del grupo:

- **Población A (Bici Válida en Grupo):** El SKU coincide con una línea de bicicleta con faltante. Se asigna automáticamente a la primera orden con faltante.
- **Población B (Caja Ajena / Alien):** El SKU no pertenece a ninguna orden del grupo. Se despliega una alerta roja destacada: _"⚠️ ALERTA CAJA AJENA: SKU no pertenece al grupo"_.
- **Población C (Partes / Repuestos, `is_bike: false`):** Identifica cajas con múltiples unidades de repuestos.
- **Caso Especial (`COMPLETED_IN_GROUP`):** El SKU existe en el grupo pero su cantidad ya fue 100% cubierta. Se advierte al operador con opción de confirmar como unidad extra.
- **Control de Duplicados (Dedupe Warning):** Si el serial de la caja ya fue confirmado en la sesión, se muestra una advertencia amarilla (_"Esta caja parece ya contada"_), pero **no se bloquea** al operador, permitiéndole forzar la confirmación si la caja es legítima.

### 3.4 Sub-fase L-4: Manejo de Lotes de Partes (`partsBatchHandler.ts`)

Para repuestos (e.g. una caja con 10 chainstays o 15 pernos), el operador no debe realizar 10 pulsaciones individuales para un único empaque físico. La interfaz ofrece un botón de confirmación de lote completo (`Confirmar Lote Completo`), registrando las N unidades en un solo gesto.

### 3.5 Sub-fase L-5: Finalización y Compatibilidad (`orderCompleter.ts`)

- Al finalizar, genera `verified_item_keys` estándar de Pickd (`1-${sku}-${idx}`) para cada unidad confirmada.
- Actualiza en base de datos:
  ```json
  {
    "status": "completed",
    "checked_by": "<user_id>",
    "verified_item_keys": ["1-03-3989GY-0", "1-03-3989GY-1"],
    "is_waiting_inventory": false,
    "updated_at": "2026-09-21T04:56:00.000Z"
  }
  ```
- Al ser procesada por `verificationProgress(order)`, la orden alcanza de inmediato el **100% de verificación**.
- **Prueba en Contenedor Local Docker:** Se probó con una orden real en `supabase_db_pickd` (puerto 54322), validando la mutación y cálculo del 100% sin tocar la base de datos de producción.

### 3.6 Sub-fase L-6: Pantalla Táctil (`LiveCheckScreen.tsx`)

- **Ruta Registrada:** `/live-check` y `/live-check/:orderNumber`.
- **Diseño Ergonómico para Galaxy S25 Ultra:**
  - Retícula óptica central con guías de esquina y badge de px/mm.
  - Botón gigante táctil de confirmación con altura mínima de 56 px.
  - Feedback háptico (`navigator.vibrate(40)`) en cada confirmación para confirmación sensorial en el ruido de la bodega.
  - Selector rápido con botones para las órdenes de prueba L-0.
  - Pestañas inferiores para alternar entre Cámara, Checklist del Grupo e Historial con Deshacer.
  - Soporte de modo "Dry-Run" (simulación en pantalla) para pruebas sin alterar datos.

---

## 4. Resultados de Verificación y Cero Regresiones

1. **Suite de Tests de la Sesión en Vivo:**
   - **28 de 28 tests pasando exitosamente (100%).**
   - Incluye prueba de integración completa contra el contenedor local Docker de Supabase.
2. **TypeScript Compilation:**
   - `pnpm tsc --noEmit` completado con **0 errores**.
3. **Línea Base de Reconocimiento Individual (Parte 0):**
   - Ejecución de `docs/label-recognition/bench/eval_baseline.test.ts` sobre las 27 fotos de prueba: **100% de concordancia con la línea base (0 fallos silenciosos, cero regresiones)**.

---

## 5. Guía de Prueba Paso a Paso para Rafael en el Almacén

**Dispositivo:** Samsung Galaxy S25 Ultra (Google Chrome / PWA).  
**URL de Acceso:** `https://<host>/live-check`

### Prueba 1: Orden Simple `#881650` (5 Bicicletas, 1 Pallet)

1. Abrir `/live-check` en Chrome.
2. Pulsar el botón rápido `#881650` (o escribir `881650` y pulsar "Abrir").
3. Observar la carga del checklist: 5 bicicletas pendientes (0/5).
4. Pulsar **"Iniciar Cámara (S25 Ultra)"** y otorgar permiso de cámara.
5. Apuntar a la primera caja a unos 25–30 cm dentro de la retícula verde.
6. En <100 ms aparecerá la tarjeta verde inferior con el SKU y modelo.
7. Tocar **"CONFIRMAR CAJA (1 TOQUE)"**:
   - Sentir la vibración corta en el teléfono.
   - El contador superior avanza a **1/5 (20%)**.
8. Repetir para las 4 cajas restantes.
9. Al llegar a 5/5 (100%), pulsar **"Dry-Run"** (para verificar sin mutar) o **"Finalizar Verificación"**.

### Prueba 2: Orden Combinada `#881555` + `#881635` (6 Bicicletas en 1 Pallet)

1. Escribir `881555` y pulsar "Abrir".
2. La pantalla detectará automáticamente el grupo y cargará ambas órdenes:
   - Header mostrará: `Grupo (2 órdenes) • #881555 • #881635`.
   - Total requerido: 6 bicicletas.
3. Escanear una caja de `#881555`. Verificar que la tarjeta la asigne a `#881555`. Tocar para confirmar.
4. Escanear una caja de `#881635`. Verificar que la reconozca como válida del grupo y la asigne a `#881635` sin dar falsa alarma. Tocar para confirmar.
5. Cambiar a la pestaña **"Checklist"** para observar el progreso simultáneo de ambas órdenes.

### Prueba 3: Detección de Caja Ajena (Población B)

1. Durante la sesión de `#881555`, apuntar la cámara a cualquier caja de otro pallet o producto no perteneciente al grupo.
2. En pantalla debe aparecer de inmediato la alerta roja:
   - _"⚠️ ALERTA: CAJA AJENA — El SKU no pertenece a ninguna orden del grupo"_.
3. Pulsar **"Ignorar"** o **"Registrar como Ajena"** para verificar que el contador de cajas ajenas se actualiza sin corromper la orden.

### Prueba 4: Advertencia de Caja Ya Contada (Deduplicación)

1. Volver a apuntar a una caja con número de serie que ya fue confirmada.
2. La tarjeta de confirmación se mostrará con un aviso amarillo:
   - _"⚠️ Esta caja parece ya contada (#serial)"_.
3. El operador puede tocar para re-confirmar si fuese intencional, o pulsar "Descartar".

### Prueba 5: Deshacer Ergonómico

1. Tocar una confirmación por error.
2. Ir a la pestaña **"Historial"** y pulsar **"Deshacer última"**.
3. Comprobar que el contador disminuye en 1 y la caja es eliminada de la lista.
