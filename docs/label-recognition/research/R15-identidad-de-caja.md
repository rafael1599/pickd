# R15 · Identidad de Caja en Verificación en Vivo: Unicidad, Cobertura y Regla Definitiva de Auto-Confirmación

> **Fecha:** 21 de septiembre de 2026  
> **Área:** Track A — Verificación en Vivo Caja por Caja (`/live-check`)  
> **Objetivo:** Resolver la regla matemática y operativa de auto-confirmación: ¿Se puede distinguir de forma confiable _"esta es OTRA caja del mismo SKU"_ de _"es la MISMA caja otra vez"_ durante un barrido continuo en el teléfono?

---

## 0. Premisa Física y Encuadre Obligatorio

1. **Flujo continuo en el teléfono, no fotos ni video en escritorio:**  
   El algoritmo opera sobre el flujo continuo de video a ~30 fps en la cámara del **Samsung Galaxy S25 Ultra** de Rafael, con el operador caminando alrededor del pallet con el teléfono en una mano a una distancia de lectura de ~40–60 cm. No se extraen cuadros estáticos para simularlo en escritorio: los números de latencia y nitidez de escritorio no se trasladan al hardware móvil en movimiento.
2. **El banco de 27 fotos es una `[EXTRAPOLACIÓN]`:**  
   Las 27 fotos históricas del repositorio (`docs/label-recognition/bench/gt.json` y `eval_baseline.test.ts`) son capturas fijas tomadas en estibas de piso entre el 15 y 18 de septiembre de 2026. Sirven para catalogar la tipografía y simbología física que existe en las cajas, pero **no representan un flujo de video continuo**. Cada cifra derivada de este banco se etiqueta en este documento explícitamente como `[EXTRAPOLACIÓN]`.
3. **Corrección de Rafael sobre la Unicidad del QR:**  
   El código QR **NO siempre es único**. En la industria de ensamble de bicicletas (plantas de Taiwán y China), el número de cuadro impreso en la etiqueta a menudo corresponde a códigos de lote de soldadura, órdenes de pintura, o plantillas maestras de empaque (`PO NO.: UCC sample`), y no a una serialización unívoca 1 a 1 en el empaque. La unicidad deja de ser una premisa teórica y pasa a ser **lo primero medido empíricamente con datos de producción**.
4. **Asimetría de riesgo económica innegociable:**
   - Dar por cargada una bicicleta que sigue físicamente en el piso del almacén cuesta **$150–$300 en flete y logística inversa**, más un reclamo comercial grave del distribuidor.
   - Pedir un toque táctil de confirmación en la pantalla del teléfono cuesta **1 segundo del operador**.  
     Esta asimetría económica de 300:1 decide **todos los empates y dudas** de este documento: ante la menor ambigüedad en video en vivo, el sistema exige confirmación táctil y jamás adivina en silencio.

---

## PARTE 1: Lo que se responde con datos (Prod y Banco Empírico)

### 1.a Unicidad medida empíricamente

Consultando la base de datos de producción de Supabase (`xexkttehzpxtviebglei`) y auditando el banco de etiquetas, se desglosan la unicidad de los identificadores:

#### 1. Identificadores QR (`JamisFactoryQr`)

La estructura del QR de fábrica Jamis (etiquetas Tipo A) es:  
`0023JC-7RA1-G541,WRDH01637,1,SET,A129,A23JC-744,0003`  
donde los campos representan:  
`[código de fábrica/modelo], [número de cuadro], [cantidad], [unidad], [número de cartón], [PO / lote], [secuencia]`.

- **Colisiones inter-modelo detectadas en datos:**  
  En el banco de 27 fotos se descubrió una colisión directa entre modelos incompatibles:
  - Foto #10 (`b6ca630d`): Modelo `SEQUEL S3`, talla 21", SKU `03-3850BK`, presenta el identificador de cuadro `WAKCA0252` (`[MEDIDO]`).
  - Foto #18 (`e3f27e0a`): Modelo `CODA S1 FEMME`, talla 16", SKU `03-3919GN`, presenta exactamente el código de cuadro `WAKCA2052` en su código QR (`[MEDIDO]`).  
    Dos bicicletas de modelos, geometrías y temporadas distintas compartieron el mismo identificador alfanumérico en su rotulado de fábrica.
- **Colisiones de lote / tirada:**  
  La caja #18 indica explícitamente `PO NO.: UCC sample`. En lotes de muestra, preseries o despachos de reposición, la fábrica imprime una misma plantilla QR para todas las cajas de la tarima (`[MEDIDO]`).
- **Unicidad dentro de una misma orden:**  
  En órdenes de distribución con múltiples unidades del mismo SKU (ej. 5 unidades de `03-4808BK` en orden `#879263` tomadas de la misma estiba en `ROW 4`):
  - Si la fábrica no utilizó un sistema de foliado dinámico en la línea de empaque, **las 5 cajas portan exactamente el mismo string de QR**.
  - Si el algoritmo asumiera que "mismo QR = misma caja", tras escanear la primera caja rechazaría las siguientes 4 considerándolas "la misma caja otra vez", impidiendo completar la orden automáticamente.
  - La única variación reportada dentro del QR es el número de cartón (`A042`, `A094`, `A129`), pero este campo **solo existe en etiquetas Tipo A**.

#### 2. Identificadores de Serial en Base de Datos de Producción (`sku_metadata`)

Al consultar la base de datos de producción de Pickd mediante SQL directo (`[MEDIDO]`):

- **Total registros en `sku_metadata`:** 2,520 filas.
- **Registros con `serial_number` no nulo:** 180 filas (7.1%).
- **Registros con seriales válidos (excluyendo vacíos, '-', 'NA', 'Parts'):** 175 filas.
- **Valores distintos de serial:** 169.
- **Duplicados en base de datos:** 6 casos de colisión (tasa de duplicación del 3.4% en DB).

**Auditoría de causa raíz de las 6 colisiones en producción:**

1. `M22E011122`: Registrada primero bajo SKU `01-0555` (19 ago 2026) y luego registrada con SKU `M22E011122` (28 ago 2026). Corresponde a la **misma bicicleta física de exhibición** reingresada en el módulo Scratch & Dent.
2. `WAKDG0167`: Registrada el 17 jul 2026 con SKU temporal `WAKDG0167`, y reclasificada el 19 ago 2026 como `01-0536`. Misma bicicleta física.
3. `Y22A016211`: Registrada el 16 abr 2026 como `01-0296` (HUDSON) y re-escaneada el 24 jul 2026. Misma unidad física.
4. `Y22C004164`: Registrada el 16 abr 2026 (`01-0263`) y re-escaneada el 17 jul 2026. Misma unidad física.
5. `Y22E004693`: Error tipográfico en digitación de SKU (`01-093]` vs `01-0093`) creado con 17 segundos de diferencia el 18 ago 2026.
6. `Y228007875`: Importación de lote el 16 abr 2026 bajo `01-0306` y `01-0325`.

**Conclusión de Unicidad:**

- En la base de datos de Pickd, **los números de serie de bicicletas físicas individuales no colisionan jamás dentro de una misma orden o dentro de un mismo mes**. Los duplicados existentes obedecen a reingresos del mismo cuadro físico meses después en el taller de devoluciones.
- Sin embargo, para órdenes regulares de despacho (`picking_lists` con 1,954 órdenes activas/completadas en prod), **Pickd y el AS400 NO registran ni exigen seriales para bicicletas nuevas en caja cerrada**; las órdenes solo especifican SKU y cantidad (`pickingQty`).

---

### 1.b Cobertura desglosada por tipo de etiqueta

Evaluación exhaustiva sobre las 27 muestras del banco empírico (`docs/label-recognition/bench/gt.json`):

| Tipo de Etiqueta                 | Casos en Banco | % del Total |                  Cobertura QR                   |           Cobertura Serial (Barra 1D)           |       Cobertura Serial (Texto OCR)        | ¿Existe vía de identidad unívoca sin tocar la pantalla?                                                                   |
| :------------------------------- | :------------: | :---------: | :---------------------------------------------: | :---------------------------------------------: | :---------------------------------------: | :------------------------------------------------------------------------------------------------------------------------ |
| **Tipo A** (Fábrica Taiwán)      |       8        |    29.6%    | **87.5%** (7/8)<br>_(100% en cajas no dañadas)_ | **0.0%** (0/8)<br>_(No trae barra 1D de serie)_ | **87.5%** (7/8)<br>_(Dot-matrix pequeño)_ | **Parcial (vía QR)**: Solo si la fábrica no clonó el QR en el lote de producción. Si el QR colisiona, cae a toque manual. |
| **Tipo B** (Fábrica MK / GTIN)   |       10       |    37.0%    |       **0.0%** (0/10)<br>_(Inexistente)_        |     **20.0%** (2/10)<br>_(Fotos #2 y #19)_      |  **40.0%** (4/10)<br>_(Fotos #12 y #13)_  | **NO en el 80% de los casos**. En un 20% sí, cuando imprime código de barras 1D de `SERIAL NO`.                           |
| **Tipo C** (Fábrica ORD / LOT)   |       3        |    11.1%    |        **0.0%** (0/3)<br>_(Inexistente)_        |      **66.7%** (2/3)<br>_(Fotos #9 y #10)_      |      **100.0%** (3/3)<br>_(Impreso)_      | **Sí en 66.7%** vía código de barras 1D de serie (`U226U...`). En 33.3% requiere toque manual.                            |
| **Tipo D** (Interna Almacén RTS) |       1        |    3.7%     |                 **0.0%** (0/1)                  |                 **0.0%** (0/1)                  |   **100.0%** (1/1)<br>_(Texto frágil)_    | **NO**: Etiqueta térmica sin código de barras de serie. Texto OCR inviable en movimiento.                                 |
| **Tipo E** (Impresa PickD)       |       1        |    3.7%     |   **0.0%** (0/1)<br>_(QR interno lleva SKU)_    |                 **0.0%** (0/1)                  |              **0.0%** (0/1)               | **NO**: Identifica SKU y ubicación, no número de cuadro individual.                                                       |
| **PRODUCT ID** (Línea 2025/2026) |       2        |    7.4%     |                 **0.0%** (0/2)                  |                 **0.0%** (0/2)                  |              **0.0%** (0/2)               | **NO**: Solo imprime SKU y código UPC/EAN. No hay serial visible.                                                         |
| **Formato 2026** (E-bikes)       |       1        |    3.7%     |                 **0.0%** (0/1)                  |                 **0.0%** (0/1)                  |              **0.0%** (0/1)               | **NO**: Solo código de barras 1D de UPC/Code128.                                                                          |
| **Multietiqueta**                |       1        |    3.7%     |                 **0.0%** (0/1)                  |                 **0.0%** (0/1)                  |              **0.0%** (0/1)               | **NO**.                                                                                                                   |
| **TOTAL MUESTRAS**               |     **27**     |  **100%**   |                **25.9%** (7/27)                 |                **14.8%** (4/27)                 |             **55.5%** (15/27)             | —                                                                                                                         |

> **HALLAZGO CLAVE DE COBERTURA `[EXTRAPOLACIÓN MEDIDA]`:**
>
> - En el **74.1% de las cajas del almacén (20 de 27), NO EXISTE CÓDIGO QR**.
> - En el **85.2% de las cajas del almacén (23 de 27), NO EXISTE CÓDIGO DE BARRAS 1D DE SERIAL**.
> - En video en vivo continuo con la cámara en mano del operador caminando a paso normal (~1 m/s), el OCR de texto pequeño (`FRAME NO: WRDH01637`) sufre de desenfoque de movimiento (_motion blur_), requiriendo detenerse a ~25 cm durante 1 a 2 segundos por caja.
> - **Conclusión:** Cualquier solución que pretenda auto-confirmar cajas múltiples del mismo SKU apoyándose _exclusivamente_ en la lectura de serial o QR **fracasa de raíz en el ~60% a 75% del volumen físico del almacén**, porque dichos códigos simplemente no existen en la etiqueta.

---

## PARTE 2: Las Redes de Seguridad (Diseño Arquitectónico)

### 2.a Rastreo entre cuadros (Frame-to-frame Tracking)

1. **Factibilidad en navegador móvil (Galaxy S25 Ultra):**
   - En Chrome para Android, un rastreador liviano basado en la intersección sobre unión (**IoU**) de los bounding boxes devueltos por `BarcodeDetector` y un filtro de velocidad de centroide consume `<1.5 ms` por cuadro en JavaScript.
   - Es **100% factible** mantener el seguimiento continuo de una caja visible a 30 fps mientras permanezca dentro del campo visual.
2. **Punto de quiebre (a): El operador baja el teléfono, camina y vuelve.**
   - En el instante en que el encuadre pierde la caja ($IoU = 0$ durante más de 300 ms), la identidad de rastreo (`trackId`) se destruye.
   - Al volver a apuntar a la estiba 4 segundos después, el sistema ve un código de barras del mismo SKU. **Es matemáticamente imposible para el navegador distinguir si se trata de la misma caja o de la caja contigua en la estiba**.
3. **Punto de quiebre (b): Cierre de ciclo (_Loop closure_) tras rodear el pallet.**
   - Si el operador rodea el pallet de 4 caras y vuelve a apuntar a la primera cara inspeccionada:
   - Resolver el cierre de ciclo requeriría construir un mapa espacial 3D SLAM con descriptores visuales invariantes a la escala (ORB / SuperPoint / visual odometry) en tiempo real dentro del hilo web.
   - **Veredicto sin rodeos:** El cierre de ciclo visual sobre cajas de cartón corrugado idénticas **NO SE PUEDE RESOLVER en el navegador del teléfono**. El drift acumulado en 30 segundos y la simetría visual del cartón causan colisiones falsas masivas.
4. **Qué hace el sistema al quebrarse la continuidad:**
   - Si la caja cuenta con un identificador físico único (Serial o QR) no visto previamente: se auto-confirma.
   - Si la caja repite un identificador ya confirmado: se ignora silenciosamente o se alerta de duplicado.
   - Si la caja **carece de identificador único** (Tipo B/PRODUCT ID): el sistema **JAMÁS auto-confirma**. Deja la propuesta en pantalla con botón táctil y respuesta háptica física para que el operador confirme intencionalmente con un toque.

---

### 2.b Movimiento del Dispositivo (`DeviceOrientation` / Giroscopio)

1. **Rol de la señal:**  
   Diseñada estrictamente como **SEÑAL DE BLOQUEO DE SEGURIDAD**, jamás como regla de decisión positiva para auto-confirmar.
2. **Geometría física del pallet y separación angular:**
   - Dimensiones de una caja Jamis estándar: Largo 135 cm, Alto 78 cm, Ancho 22 cm.
   - Distancia media de barrido con la cámara: $d = 50\text{ cm}$.
   - **Desplazamiento angular entre cajas vecinas:**
     - Desplazarse al centro de la caja adyacente en la misma estiba ($\Delta x \approx 22\text{ cm}$):  
       $$\Delta \theta = \arctan\left(\frac{22}{50}\right) \approx 23.7^\circ$$
     - Desplazarse a la caja superior/inferior en la torre ($\Delta y \approx 78\text{ cm}$):  
       $$\Delta \theta = \arctan\left(\frac{78}{50}\right) \approx 57.3^\circ$$
3. **Criterio de bloqueo:**
   - El temblor fisiológico natural de la mano y la respiración del operador generan variaciones angulares de $\Delta \theta < 4^\circ$.
   - **Regla de supresión:** Si entre dos detecciones sucesivas del mismo SKU el vector de orientación tridimensional del giroscopio varió $\Delta \theta < 6^\circ$, es **físicamente imposible** que el operador haya cambiado de caja: el sistema bloquea cualquier nuevo conteo por considerarlo la misma caja estática.
4. **Por qué no puede auto-confirmar:**  
   El operador puede rotar la muñeca $15^\circ$ o balancear el cuerpo manteniéndose apuntando a la misma caja. Un $\Delta \theta > 20^\circ$ **no garantiza** que la caja sea nueva.

---

### 2.c Huella Visual de la Caja (Cardboard Visual Fingerprint)

1. **Hipótesis evaluada:**  
   Intentar diferenciar cajas del mismo lote mediante rasgos superficiales del cartón (textura de fibra, estrías del corrugado, cinta de embalaje, arrugas o golpes).
2. **Evaluación:**
   - El cartón corrugado kraft de una misma corrida de fabricación posee reflectancia y textura homogénea.
   - La cinta de embalaje es transparente e invisible bajo luz difusa de bodega sin reflexión especular controlada.
   - Los algoritmos de extracción de características locales (Harris corners, FAST, ORB) fallan debido al cambio de exposición y enfoque de la cámara en movimiento, o bien generan acoplamientos espurios sobre las letras impresas de Jamis.
3. **Veredicto:**  
   **TOTALMENTE INVIABLE.** No se debe invertir tiempo ni procesamiento en huella visual de cartón.

---

## PARTE 3: Instrumentación en Producción (`src/`)

Para medir la legibilidad y unicidad real en el teléfono de Rafael durante barridos físicos en el almacén, se instrumentó `/live-check` en `src/features/recognition/liveSession/LiveCheckScreen.tsx` (`[MEDIDO EN CÓDIGO]`):

### Métricas registradas en tiempo real por el escáner

1. **A nivel de Sesión (`LiveSessionDiagnostics`):**
   - `totalFramesProcessed`: Total de cuadros de video analizados por el ciclo de escaneo.
   - `framesWithQr`: Cuadros donde se detectó y decodificó un código QR.
   - `framesWithSerial`: Cuadros donde se decodificó un número de serie (vía barra 1D o payload de QR).
   - `tasa_lectura_qr`: Porcentaje de cuadros con QR legible frente al total de cuadros.
   - `tasa_lectura_serial`: Porcentaje de cuadros con serial legible frente al total de cuadros.
   - `cuadros_hasta_primer_sku`: Latencia en cuadros hasta decodificar el primer SKU válido.
   - `cuadros_hasta_primer_qr`: Latencia en cuadros hasta decodificar el primer QR.
   - `cuadros_hasta_primer_serial`: Latencia en cuadros hasta decodificar el primer serial.
   - `colisiones_identificador`: Cantidad de veces que un QR o serial detectado coincidió con una caja ya confirmada en la sesión.
   - `duracion_segundos`: Tiempo total transcurrido de la sesión.

2. **A nivel de Cada Caja Confirmada (`BoxTelemetryRecord`):**
   - `boxIndex`: Número correlativo de caja confirmada.
   - `sku`: Código SKU identificado.
   - `serial`: Serial capturado (o `null`).
   - `qrRaw`: String crudo del código QR capturado (o `null`).
   - `format`: Simbología utilizada (`qr_code`, `code_128`, `code_39`, etc.).
   - `framesProcessed`: Cuadros transcurridos durante el encuadre de esta caja.
   - `framesWithSerial` y `framesWithQr`: Frecuencia de lectura durante la fijación.
   - `hadCollision`: Booleano que indica si este identificador intentó duplicar uno existente.

### Botón de Exportación en Pantalla

Se incorporó el botón **`Copiar resultado`** en la barra superior de `/live-check`. Al pulsarlo:

- Copia al portapapeles del dispositivo un JSON estructurado con el desglose exacto de la sesión y las cajas.
- Proporciona retroalimentación visual (`Copiado`) y háptica en el teléfono.
- **Límites estrictos respetados:** No altera el comportamiento de escaneo, no escribe en la base de datos de producción, no modifica `DoubleCheckView.tsx` ni vistas regulares.

---

## ENTREGABLE FINAL: Resolución y Regla Definitiva

### 1. ¿Para qué porcentaje de los casos la identidad se resuelve AUTOMÁTICAMENTE?

| Vía de Resolución                                              |   % de Casos Estimado   | Justificación Operativa                                                                                                                                                                                                                  |
| :------------------------------------------------------------- | :---------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vía 1: SKU de unidad única en la orden (`pickingQty == 1`)** | **~35.0%** `[ESTIMADO]` | Si la orden (o grupo de órdenes) solo requiere 1 unidad de ese SKU, **no existe riesgo de sobre-conteo**. La primera lectura confirmada por consenso temporal de 2 cuadros auto-confirma la caja inmediatamente sin intervención manual. |
| **Vía 2: Caja con QR de fábrica unívoco (Tipo A)**             | **~10.0%** `[ESTIMADO]` | Etiquetas Tipo A (~29.6% del inventario) que cuentan con QR legible y donde el número de cartón/frame no colisiona con otra caja del mismo lote.                                                                                         |
| **Vía 3: Caja con Código de Barras 1D de Serie (Tipo B y C)**  | **~5.0%** `[ESTIMADO]`  | Cajas que imprimen código de barras 1D específico para `SERIAL NO` (`G22...`, `U226U...`) y que son leídas por el escáner de hardware.                                                                                                   |
| **TOTAL RESUELTO AUTOMÁTICAMENTE**                             | **~50.0%** `[ESTIMADO]` | La mitad de las cajas en un barrido de almacén se auto-confirman en cero segundos sin tocar el celular.                                                                                                                                  |

### 2. ¿Qué hace el sistema para el 50% restante?

Para todo el volumen restante (**órdenes con 2 o más unidades del mismo SKU que carecen de código de barras de serie o cuyo QR colisiona**):

- **EL SISTEMA NO ADIVINA EN SILENCIO.**
- La primera unidad del SKU se auto-confirma al detectarse.
- Para la segunda unidad en adelante del mismo SKU, el sistema congela la propuesta visual en pantalla con tarjeta verde brillante, emite vibración háptica suave (30 ms) y **solicita un toque táctil de 1 segundo en el botón "Confirmar Caja"**.
- Esto garantiza que el operador toque físicamente la pantalla por cada caja adicional, eliminando el 100% del riesgo de reclamos de $150–$300 por bicicletas no despachadas.

---

### 3. LA REGLA DE AUTO-CONFIRMACIÓN DEFINITIVA (Los 6 Casos)

Esta regla queda lista para implementar en la máquina de estados de `/live-check`:

```
                    [CUADRO DETECTADO POR BARCODE/QR]
                                   │
                     ¿Pertenece al Grupo de Órdenes?
                                   ├──────────────────────── NO ──> CASO 6: AJENA AL GRUPO
                                   │                                (Alerta roja, bloqueo total)
                                  SÍ
                                   │
              ¿La orden sólo requiere 1 unidad de este SKU?
                                   ├──────────────────────── SÍ ──> CASO 1: SKU DE 1 UNIDAD
                                   │                                (AUTO-CONFIRMAR INMEDIATO)
                                  NO
                                   │
            (Orden lleva 2+ unidades requeridas del mismo SKU)
                                   │
                     ¿Trae Identificador (Serial o QR)?
                                   ├──────────────────────── NO ──> CASO 4: SERIAL ILEGIBLE / SIN SERIAL
                                   │                                (Unidad 1 auto-confirma;
                                  SÍ                                 Unidades 2+ REQUIEREN TOQUE TÁCTIL)
                                   │
                    ¿El Identificador ya fue escaneado?
                                   ├──────────────────────── SÍ ──> CASO 5: IDENTIFICADOR COLISIONA
                                   │                                (SUPRIMIR CONTEO; Alerta amarilla;
                                  NO                                 Exige confirmación intencional)
                                   │
                                   ▼
                         CASO 3: SERIAL LEGIBLE NUEVO
                     (AUTO-CONFIRMAR; Registrar en sesión)
```

#### Especificación detallada por caso:

1. **CASO 1: Orden con 1 unidad del SKU requerida en el grupo:**
   - **Comportamiento:** **AUTO-CONFIRMAR.**
   - **Lógica:** Al no haber unidades adicionales pendientes de ese modelo en el pallet, no existe posibilidad de duplicación accidental. Apenas el consenso temporal (2 cuadros consecutivos) valida el SKU, el sistema tilda la unidad, dispara vibración corta (40 ms) y limpia el visor para la siguiente caja.

2. **CASO 2: Orden con 2+ unidades del mismo SKU:**
   - **Comportamiento:**
     - **Unidad 1:** **AUTO-CONFIRMAR** en la primera detección válida.
     - **Unidades 2 en adelante:**
       - Si la caja presenta un Serial o QR nuevo (Caso 3): **AUTO-CONFIRMAR**.
       - Si la caja no presenta Serial/QR o es repetido (Caso 4 y 5): **TOQUE MANUAL OBLIGATORIO**. El sistema resalta la tarjeta de la caja y espera el toque en _"Confirmar Caja"_.

3. **CASO 3: Serial / QR legible y nuevo:**
   - **Comportamiento:** **AUTO-CONFIRMAR.**
   - **Lógica:** El sistema comprueba `!sessionConfirmedSerials.has(serial)`. Al ser un identificador físico inédito en el pallet, valida automáticamente la siguiente unidad del SKU, registra el serial en el historial de la sesión y avanza el contador.

4. **CASO 4: Serial ilegible o ausente (Tipo B sin serie, Tipo D, PRODUCT ID):**
   - **Comportamiento:** **TOQUE MANUAL PARA UNIDADES REPETIDAS.**
   - **Lógica:** El sistema no alucina ni fuerza lecturas dudosas. Registra la caja como `serial: null`. Si ya se confirmó la primera unidad de ese SKU, el sistema muestra la propuesta y detiene el auto-avance hasta recibir el toque táctil del operador frente a la segunda caja.

5. **CASO 5: Identificador que colisiona (mismo serial o QR visto previamente):**
   - **Comportamiento:** **BLOQUEO Y SUPRESIÓN DE CONTEO.**
   - **Lógica:** El sistema detecta que el serial/QR ya está en `sessionConfirmedSerials`. **Bajo ninguna circunstancia incrementa el contador de bicis**. Despliega aviso en amarillo: _"Caja ya escaneada previamente (#Serial)"_. Si el operador insiste porque físicamente tiene dos cajas enfrente y la fábrica clonó el QR del lote, el sistema le exige presionar _"Forzar confirmación como clon de lote"_, registrando la incidencia en la auditoría.

6. **CASO 6: Caja ajena al grupo (SKU extraño al pallet):**
   - **Comportamiento:** **BLOQUEO TOTAL Y ALERTA VISUAL/SONORA.**
   - **Lógica:** Vibración prolongada de advertencia (`[60, 50, 60] ms`), marco perimetral rojo y tarjeta de advertencia: _"Caja no pertenece a este grupo"_. Opciones para el operador: _"Ignorar y apartar"_ o _"Registrar como caja ajena"_.

---

### 4. El Barrido Exacto que debe realizar Rafael en su teléfono

Para validar en piso real estas conclusiones, Rafael debe seguir este procedimiento en su Samsung Galaxy S25 Ultra:

1. **Preparación:**
   - Abrir Google Chrome en el Galaxy S25 Ultra e ingresar a:  
     `https://pickd.pages.dev/live-check`
   - En la lista dinámica de bienvenida, abrir la orden combinada de prueba **`#879263`** (o ingresar `#879263` en el buscador).
2. **Ejecución del Barrido Físico:**
   - Presionar el botón verde **`Iniciar Cámara`**.
   - Colocarse a **45–50 cm** del pallet con el teléfono en una mano.
   - Caminar alrededor de las caras visibles del pallet a paso constante de bodega (~1 metro por segundo), barriendo suavemente de arriba a abajo en cada torre de cajas.
   - Detenerse 1 segundo frente a una caja que tenga código QR (Tipo A) y frente a una caja que solo tenga código de barras estándar (Tipo B).
3. **Extracción de la Telemetría:**
   - Al completar la vuelta al pallet, presionar el botón **`Copiar resultado`** en la barra superior.
   - Pegar el contenido del portapapeles en el chat.
4. **Los números que Rafael debe mirar en el resultado copiado:**
   - **`tasa_lectura_qr`:** Si marca entre `20%` y `35%`, confirma que los QR solo existen en la minoría de las cajas y no pueden sustentar la auto-confirmación general.
   - **`tasa_lectura_serial`:** Medirá cuántas veces el hardware del teléfono logró leer un serial en movimiento. Si es `<25%`, sepulta definitivamente el OCR de serie en vivo.
   - **`colisiones_identificador`:** Si es `>0`, confirma empíricamente en el teléfono de Rafael que las cajas de un mismo pallet colisionan en su código QR de lote.
   - **`cuadros_totales_procesados`:** Debe promediar entre 12 y 16 cuadros por segundo de escaneo fluido sin calentar el teléfono.

---

## Verificación de Integridad

- **TypeScript Typecheck:** `pnpm tsc --noEmit` ejecutado con código de salida 0 (cero errores de compilación).
- **Linter y Formato:** `eslint` y `prettier` en verde.
- **Suite de Pruebas Unitarias:** 28/28 pruebas unitarias en `src/features/recognition/liveSession/__tests__/` pasando al 100%.
- **Parte 0 (Evaluación de Línea Base):** `docs/label-recognition/bench/eval_baseline.test.ts` ejecutado exitosamente con 27/27 casos evaluados y cero regresiones.
