# PRD: Separar «Recoger» de «Armar» en Double Check

**Estado:** estudio, esperando «ok» · **Fecha:** 2026-10-08 · **Backlog:** idea-260  
**Continúa:** `pallet-box-inference.md` (idea-245), `pick-pallet-by-pallet.md` (idea-247)  
**Relacionado:** `src/features/picking/components/DoubleCheckView.tsx`, `src/features/picking/pallets/planPallets.ts`, `src/utils/pickingLogic.ts`, `src/utils/palletDims.ts`, `src/utils/palletLayout.ts`, `.claude/rules/ship.md`, `.claude/rules/picking.md`

---

## 1) Contexto y problema

### El dolor en palabras de Rafael (8 oct 2026, textual)

> «Creo que el problema es que hemos combinado dos conceptos en una sola vista. El primero es el orden de recogida y el segundo es el orden en el que debe ser armada la orden.»  
> «Todo se va a ir por orden de recogida de ahora en el futuro, no por orden de mejor acomodación… en vez de ayudar desordenó DCV y es un desastre para recoger.»  
> «La prioridad debería ser enviar la mayor cantidad de bicicletas en la menor cantidad de pallets y tener 12 como máximo sólo si son bicicletas grandes y 15 si son de niños.»  
> «El piso manda.» Y pidió que se avise antes de agregar una tarima a mano que sube el total.

### Lo que existe hoy en código

- **`DoubleCheckView.tsx` (4 177 líneas):** una sola pantalla que mezcla recorrido de pasillo con tarimas físicas. Los ítems se agrupan en bloques `Pallet 1/3`, `Pallet 2/3`, etc.
- **`verified_item_keys`:** almacena llaves con el formato `${palletId}-${sku}-${location}`. La verificación de haber tomado una bici está indisolublemente atada al ID de la tarima donde se planeó que viaje.
- **`planPallets.ts`:** motor único de tarimas. Hasta el 5 oct forzaba «tarimas parejas; la de 12, último recurso», lo que fragmentaba lotes continuos de un mismo pasillo para igualar alturas artificialmente.
- **Ruta física:** `getOptimizedPickingPath` ordena las líneas por `locations.picking_order` (de menor a mayor). Pero como la vista parte las líneas por tarima, el operario ve paradas de la ROW 9 en Pallet 1, luego paradas de ROW 32 en Pallet 2, forzándolo a retroceder o saltar entre secciones de la pantalla mientras empuja el carro.

### El caso real: Orden #881856 (35 bicis, TRK, LUDLOW)

Una orden de camión de 35 bicicletas compuesta por 29 de adulto y 6 de niño:

| Línea | SKU         | Qty | Tipo   | Ubicación | `picking_order` |
| :---- | :---------- | :-- | :----- | :-------- | :-------------- |
| 1     | `03-3980BL` | 5   | Adulto | ROW 34    | 100             |
| 2     | `03-3983GY` | 5   | Adulto | ROW 32    | 120             |
| 3     | `03-3987GY` | 6   | Adulto | ROW 9     | 298             |
| 4     | `03-3989GY` | 5   | Adulto | ROW 9     | 298             |
| 5     | `07-3689WH` | 3   | Niño   | ROW 42    | 402             |
| 6     | `07-3690BL` | 3   | Niño   | ROW 42    | 402             |
| 7     | `03-3981GY` | 8   | Adulto | ROW 43    | 410             |

**Recorrido real en piso (`locations.picking_order`):**  
ROW 34 (100) → ROW 32 (120) → ROW 9 (298) → ROW 42 (402) → ROW 43 (410).

**Lo que pasó en DCV hoy:**

1. DCV enseñaba la recogida partida por tarimas (`Pallet 1/3`, `2/3`, etc.).
2. El piso armó a mano dos tarimas de 9 bicis (`+ Add pallet`).
3. El motor apartó las dos de 9 y, al repartir el remanente (11 grandes + 6 niños = 17 bicis), necesitó 2 tarimas más: **4 tarimas en total en vez de 3**.
4. Al intentar rehacerlas o buscar las bicis, la vista obligaba al picker a saltar de ROW 34 a 9, volver a 32, etc.
5. En ROW 43 (8 unidades de `03-3981GY`), el picker no sabía cuántas sacar de la fila sin sumar mentalmente las que estaban partidas entre Pallet 2 y Pallet 3.

**Cómo quedó físicamente en el piso (la referencia real que armaron):**

- **T1 (12 bicis, 82"):** 5× `03-3980BL` + 4× `03-3983GY` + 3× `03-3989GY`.
- **T2 (12 bicis, 82"):** 1× `03-3983GY` + 6× `03-3987GY` + 2× `03-3989GY` + 3× `03-3981GY`.
- **T3 (11 bicis, ~68"):** 5× `03-3981GY` abajo en la base + 6 de niño encima (3× `07-3689WH` + 3× `07-3690BL`).
- **Total:** 35 bicis en **3 tarimas**.

**Lo que el picker necesitaba en el piso:**  
«La tercera dámela en orden de recogida»:

- Llegar a ROW 42: ver 3× `07-3689WH` y 3× `07-3690BL` con indicación clara: **«apartar, van encima»**.
- Llegar a ROW 43: ver 8× `03-3981GY` (total del SKU en la parada: 8), con 5 para la base de T3 y 3 que completan T2.

---

## 2) Objetivo

Separar radicalmente la operación física en dos modos dentro del mismo flujo:

1. **RECOGER (`PICK`):** optimizado para caminar por el almacén recogiendo cajas. Lista plana ordenada por secuencia de pasillos (`picking_order`), con el total exacto que se debe sacar de cada hueco.
2. **ARMAR (`BUILD`):** optimizado para la estación de consolidación o paletizado. Vista agrupada por tarima física, especificando qué cajas van en la base y cuáles van encima, frentes de tarima y validación de cubicaje.

### Métrica de éxito

- **0 saltos de pasillo** durante la recogida (secuencia 100% monótona de `picking_order`).
- **3 tarimas físicas** en órdenes equivalentes a #881856 sin intervención manual del usuario.
- **100% de advertencia previa** si una tarima manual incrementa el total de tarimas (`hand-pallet-warning`).
- **Reducción de líneas y complejidad** en `DoubleCheckView.tsx` (eliminación de acordeones anidados y duplicidad de contadores).

---

## 3) Conceptos

- **Parada (`Stop`):** punto del recorrido en el almacén identificado por pasillo y cuadro (`ROW 34`, `ROW 9 · A`). En la vista `PICK`, cada parada agrupa todas las cajas que se extraen de allí, sin importar a qué tarima vayan.
- **Total de Parada (`Stop Qty`):** número absoluto de cajas a tomar en ese momento para ese SKU. Si una parada tiene 8 bicis (3 para T2 y 5 para T3), la cifra principal que lee el picker es **8**.
- **Tarima (`Pallet`):** bulto físico consolidado para el camión o carrier. Se gestiona en la vista `BUILD`.
- **Base:** cajas de bicicleta grande colocadas de pie sobre el pallet de madera (máximo 12 unidades por tarima).
- **Encima (`On Top`):** cajas de bicicleta de niño (o hasta 2 cajas adultas acostadas) colocadas sobre las cajas de la base sin exceder 90" de altura total ni el tope de 15 bicis de niño.
- **Un Solo Plan:** el cómputo en memoria generado por `planPallets` que mapea cada caja física a una parada y a una tarima. No hay dos estados divergentes.

---

## 4) El gesto

### 4.1. El Switch `[ PICK | BUILD ]`

En la cabecera fija de Double Check, inmediatamente bajo el identificador de orden, vive un switch de dos segmentos:

```
[  PICK (Recoger)  |  BUILD (Armar)  ]
```

- **Un solo toque:** conmuta instantáneamente la vista sin recargar datos.
- **Persistencia:** recuerda la última vista usada en `localStorage`. Por defecto, una orden no completada abre en `PICK`.

### 4.2. Flujo en modo RECOGER (`PICK`)

1. **Entrada:** el picker ve la lista de paradas en estricto orden de pasillos (100 → 120 → 298 → 402 → 410).
2. **Llegada al estante:**
   - El picker lee la cifra grande de unidades (ej. `8`).
   - Si las cajas van a diferentes tarimas, lo ve en un badge secundario: `T2: 3 · T3: 5 (BASE)`.
   - Si son bicis de niño que van arriba de una tarima: chip ámbar visible `▲ ON TOP · T3 (SET ASIDE)`.
3. **Marcado (Check):**
   - Tocar la tarjeta marca la totalidad de las unidades de esa parada.
   - Las llaves correspondientes (`${palletId}-${sku}-${location}`) se marcan internamente en `verified_item_keys` y se registra el evento en `pallet_events` (`phase = 'pick'`).
4. **Finalización del recorrido:** al completar el último check de la lista, el botón inferior ofrece `Inspect Build ›` o pasar directamente a `BUILD`.

### 4.3. Flujo en modo ARMAR (`BUILD`)

1. **Organización por tarimas:** tarjetas separadas para `PALLET 1`, `PALLET 2`, `PALLET 3`.
2. **Estructura física interna:**
   - Sección **BASE:** lista de cajas que van de pie apoyadas en la tarima.
   - Sección **ON TOP:** cajas que van montadas encima (niños o acostadas).
   - Indicador de contexto de SKU: si el SKU está repartido, muestra `3 of 8 in order`.
3. **Edición manual:**
   - Tocar el lápiz abre `PalletBuilderModal` para editar qué cajas lleva esa tarima.
   - Si al guardar, la cantidad elegida incrementa el número total de tarimas físicas calculadas por el motor, salta el modal **`HandPalletWarningModal`** (§5.3).
4. **Fotos y Frentes:**
   - Botón de foto por tarima (`📷 PALLET 1`).
   - Lectura de frente de la sombra (`FrontProposalCard`) vinculada a la tarima correspondiente.

---

## 5) Modos y herramientas

### 5.1. Vista RECOGER (`PICK`)

| Elemento                                       | Visible en PICK         | Razón                                                           |
| :--------------------------------------------- | :---------------------- | :-------------------------------------------------------------- |
| Pasillo y orden (`ROW 34`, `100`)              | **SÍ (Primario)**       | Es la guía física de navegación en el almacén.                  |
| Cantidad total por SKU en la parada            | **SÍ (56 px)**          | Lo que el picker debe sacar de la fila en un solo viaje.        |
| Destino secundario de tarima (`T1: 4 · T2: 1`) | **SÍ (Sutil, 11 px)**   | Orienta en qué carro o posición física colocar la caja.         |
| Alerta `▲ ON TOP (SET ASIDE)`                  | **SÍ (Ámbar pulsante)** | Evita que el picker coloque bicis de niño en la base por error. |
| Agrupadores de tarima (`Pallet 1/3`)           | **NO**                  | Fragmentan el recorrido y confunden la recogida.                |
| Modificación de dimensiones de tarima          | **NO**                  | No pertenece a la fase de recolección de estante.               |

### 5.2. Vista ARMAR (`BUILD`)

| Elemento                                   | Visible en BUILD    | Razón                                                           |
| :----------------------------------------- | :------------------ | :-------------------------------------------------------------- |
| Bloques por tarima (`PALLET 1/3`)          | **SÍ (Primario)**   | Define la unidad de carga para el transporte.                   |
| Separación BASE vs ON TOP                  | **SÍ (Estructura)** | Garantiza estabilidad física: grandes abajo, niños arriba.      |
| Medidas estimadas (alto en pulgadas, peso) | **SÍ (Gris)**       | Calculado por `layoutPallet` con skyline y gravedad.            |
| SKU con desglose `N of Total`              | **SÍ (12 px mono)** | Responde a la pregunta: «¿cuántas de este SKU lleva la orden?». |
| Lápiz de edición y `+ Add pallet`          | **SÍ**              | Permite ajustar la estiba física cuando el piso lo requiere.    |
| Ruta de pasillos / picking_order           | **NO**              | En la estación de armado la bici ya está fuera del estante.     |

### 5.3. El aviso de tarima manual (`hand-pallet-warning`)

Vive en la vista **BUILD** (y en Ship) como guardia antes de confirmar una tarima armada a mano:

```
┌──────────────────────────────────────────────┐
│ PALLET 2                      4 VS 3 PALLETS │
├──────────────────────────────────────────────┤
│ This pallet has 9 bikes.                     │
│ Saved like this the order needs 4 pallets    │
│ instead of 3.                                │
│ Pallet 1 has 9 bikes.                        │
│                                              │
│ Fill them up to 12?                          │
├──────────────────────────────────────────────┤
│ [ Save anyway ]              [ Edit pallet ] │
└──────────────────────────────────────────────┘
```

- **Disparador:** cuando `handPalletCost(writes).raises === true` (la selección manual incrementa `withIt` respecto a `least`).
- **Acción por defecto:** `Edit pallet` (botón azul con foco), reabre el lápiz con las cajas ya marcadas para permitir seleccionar las 3 restantes hasta 12.
- **Escape:** `Save anyway` (borde sutil), respeta la regla soberana: «el piso manda».

---

## 6) Reglas del motor (`planPallets` y `palletDims`)

### 6.1. Prioridades inmutables

1. **Menor número de tarimas:** la prioridad absoluta es consolidar en la menor cantidad posible de tarimas físicas.
2. **Topes duros:**
   - **Grandes:** máximo **12 bicicletas** por tarima (`ADULTS_PER_PALLET_MAX = 12`).
   - **Niños:** máximo **15 bicicletas** por tarima (`KIDS_PER_PALLET_MAX = 15`, 3 capas de 5).
3. **Orden de recogida:** las tarimas se van llenando en la misma secuencia lineal en que se recorren los pasillos (`locations.picking_order`). No se adelantan bicis de pasillos lejanos para rellenar huecos si altera la ruta.
4. **Bicis de niño encima:**
   - Si la cantidad total de bicis de niño cabe sobre la última tarima grande (respetando $\le 90"$ de alto total con la madera y $\le 2$ cajas echadas), **van encima de esa tarima grande**.
   - No generan una tarima extra independiente a menos que superen el alto de 90" o el tope de 15 unidades.
5. **Bloqueo del piso:** cualquier tarima que el piso armó a mano (`pallet_dims[].items`) o tecleó (`bikes`) es inamovible (`manual = true`). El motor reparte las unidades restantes a su alrededor sin alterar lo ya fijado.

### 6.2. Reglas de `ship.md` superadas

- **SUPERADA:** _«Tarimas parejas; la de 12, último recurso (5 oct 2026)»_.  
  _Motivo:_ Enviar tarimas de 11+11 o forzar 9+9 por estética impedía montar las bicis de niño encima y provocaba que órdenes de 3 tarimas subieran a 4 (como ocurrió en #881856).  
  _Reemplazo:_ _«Menor número de tarimas; topes 12 grandes / 15 de niño; en orden de recogida (8 oct 2026)»_.
- **SUPERADA:** Redistribución de lotes para igualar alturas cuando rompe la secuencia de pasillos.

---

## 7) Datos, RPCs y compatibilidad

### 7.1. Modelo de datos

- **`picking_lists.verified_item_keys` (text[]):**  
  Se mantiene el formato `${palletId}-${sku}-${location}` para compatibilidad total con `PickingCartDrawer`, `OrderProgressBar`, `VerificationBar` y las RPCs de cierre (`process_picking_list`).  
  _Mapeo en PICK:_ cuando el usuario marca una parada que abastece a T1 y T2, el cliente resuelve en memoria qué porción corresponde a T1 y cuál a T2 según `planPallets`, y escribe ambas llaves.
- **`pallet_events` (append-only):**  
  Cada toque en PICK registra `phase = 'pick'` con el `pallet` inferido del plan, preservando la trazabilidad cronológica requerida por F1 de idea-245.
- **`shipments.pallet_dims` (jsonb):**  
  Almacena las decisiones del piso (`bikes`, `items`, `split`). Permanece idéntico.

### 7.2. Lo que se simplifica y borra de DCV hoy

1. **Eliminación del renderizado fragmentado:** se elimina el bucle principal de `pallets.map` que envolvía los ítems. En su lugar, el cuerpo de DCV se bifurca limpiamente:
   - Si `mode === 'pick'`: renderiza `<PickStopsList items={pathItems} />`.
   - Si `mode === 'build'`: renderiza `<BuildPalletsList pallets={pallets} />`.
2. **Eliminación de inputs inline de unidades en modo recogida:** los inputs de cambio de unidades de tarima ya no aparecen mientras se camina por los pasillos; viven exclusivamente en BUILD.
3. **Eliminación de la redundancia en contadores:** un solo indicador global en cabecera (`35 / 35 BIKES`) y contadores locales claros en cada tarjeta de tarima en BUILD.

---

## 8) Pantalla (Mockup a 430 px)

### 8.1. Cabecera compartida (430 px)

```
┌──────────────────────────────────────────────┐
│ ‹ #881856 · LUDLOW           35 BIKES · TRK  │
│ [  PICK (5 STOPS)  ]    [  BUILD (3 PLTS)  ] │
│ ──────────────────────────────────────────── │
│ PROGRESS: 27 / 35 BIKES CHECKED (77%)        │
└──────────────────────────────────────────────┘
```

### 8.2. Vista RECOGER (`PICK`)

```
┌──────────────────────────────────────────────┐
│ STOP 1 · ROW 34                       ord 100│
│ ┌──────────────────────────────────────────┐ │
│ │ [✓] 03-3980BL                       × 5  │ │
│ │     ALLEGRO A2 19" MET BLU               │ │
│ │     dest: T1 (5/12)                      │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ STOP 2 · ROW 32                       ord 120│
│ ┌──────────────────────────────────────────┐ │
│ │ [✓] 03-3983GY                       × 5  │ │
│ │     ALLEGRO A2 21" GL MET GRY            │ │
│ │     dest: T1: 4 · T2: 1                  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ STOP 3 · ROW 9                        ord 298│
│ ┌──────────────────────────────────────────┐ │
│ │ [✓] 03-3987GY                       × 6  │ │
│ │     CODA S2 17" GL MET GRY               │ │
│ │     dest: T2 (6/12)                      │ │
│ ├──────────────────────────────────────────┤ │
│ │ [✓] 03-3989GY                       × 5  │ │
│ │     CODA S2 21" GL MET GRY               │ │
│ │     dest: T1: 3 · T2: 2                  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ STOP 4 · ROW 42                       ord 402│
│ ┌──────────────────────────────────────────┐ │
│ │ ▲ ON TOP · T3 (SET ASIDE)                │ │
│ │ [✓] 07-3689WH                       × 3  │ │
│ │     LASER 20" GL PEARL WHT · KIDS        │ │
│ ├──────────────────────────────────────────┤ │
│ │ [✓] 07-3690BL                       × 3  │ │
│ │     LASER 20" GL MET BLU · KIDS          │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ STOP 5 · ROW 43                       ord 410│
│ ┌──────────────────────────────────────────┐ │
│ │ [ ] 03-3981GY                       × 8  │ │
│ │     ALLEGRO A2 15" GL MET GRY            │ │
│ │     dest: T2: 3 · T3: 5 (BASE)           │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 8.3. Vista ARMAR (`BUILD`)

```
┌──────────────────────────────────────────────┐
│ PALLET 1 / 3         12 BIKES · 82" · 380 LBS│
│ ┌──────────────────────────────────────────┐ │
│ │ BASE (12 ADULTS)                     [✎] │ │
│ │ • 03-3980BL × 5                          │ │
│ │ • 03-3983GY × 4                          │ │
│ │ • 03-3989GY × 3                          │ │
│ │                                  [📷 FOTO]│ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ PALLET 2 / 3         12 BIKES · 82" · 375 LBS│
│ ┌──────────────────────────────────────────┐ │
│ │ BASE (12 ADULTS)                     [✎] │ │
│ │ • 03-3983GY × 1                          │ │
│ │ • 03-3987GY × 6                          │ │
│ │ • 03-3989GY × 2                          │ │
│ │ • 03-3981GY × 3 (3 of 8 total)           │ │
│ │                                  [📷 FOTO]│ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ PALLET 3 / 3         11 BIKES · 68" · 310 LBS│
│ ┌──────────────────────────────────────────┐ │
│ │ BASE (5 ADULTS)                      [✎] │ │
│ │ • 03-3981GY × 5 (5 of 8 total)           │ │
│ ├──────────────────────────────────────────┤ │
│ │ ON TOP (6 KIDS)                          │ │
│ │ • 07-3689WH × 3                          │ │
│ │ • 07-3690BL × 3                          │ │
│ │                                  [📷 FOTO]│ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## 9) Fases de implementación

- **Fase 1 (Inmediata - Lo pedido):**
  1. Integración de las reglas del 8 oct en `planPallets.ts` (menor número de tarimas, topes 12/15, orden de recogida monótono, niños sobre última tarima).
  2. Implementación del modal `HandPalletWarningModal` al editar o agregar tarimas manuales.
  3. Bifurcación en `DoubleCheckView.tsx` entre vista `PICK` (lista por paradas) y vista `BUILD` (agrupada por tarima), controlada por el switch en cabecera.
- **Fase 2 (Validación y Frentes):**
  1. Vinculación directa de fotos de frente tomadas desde `BUILD` con la tarima correspondiente.
  2. Telemetría de tiempos de recogida vs armado en `pallet_events`.

---

## 10) Casos de verificación numerados

### Caso 1: Orden #881856 sin intervención manual (Cálculo puro del motor)

- **Entrada:** 35 bicicletas (29 grandes + 6 niños) en orden de pasillo:
  `ROW 34` (5) → `ROW 32` (5) → `ROW 9` (11) → `ROW 42` (6 niños) → `ROW 43` (8).
- **Resultado esperado:**
  - Total tarimas físicas: **3 tarimas**.
  - **T1 (12 grandes):** 5× `3980BL` + 5× `3983GY` + 2× `3987GY` (ROW 34, 32 y 9).
  - **T2 (12 grandes):** 4× `3987GY` + 5× `3989GY` + 3× `3981GY` (ROW 9 y 43).
  - **T3 (11 bicis):** 5× `3981GY` (base) + 6 de niño encima: 3× `3689WH` + 3× `3690BL` (ROW 42). Alto $\approx 68" \le 90"$.
  - En `PICK`: 5 paradas continuas sin saltos.
  - En `BUILD`: 3 tarjetas de tarima.

### Caso 2: Orden #881856 con T1 y T2 armadas a mano como en el piso

- **Entrada:**
  - Piso fija T1 a mano (`items`): 5× `3980BL` + 4× `3983GY` + 3× `3989GY` (12).
  - Piso fija T2 a mano (`items`): 1× `3983GY` + 6× `3987GY` + 2× `3989GY` + 3× `3981GY` (12).
- **Resultado esperado:**
  - El motor toma el remanente (5× `3981GY` + 6 niños) y lo asigna a **T3** (5 base + 6 encima).
  - Total tarimas físicas: **3 tarimas**.
  - _Intento de guardar T1 y T2 con 9 bicis cada una:_ salta `HandPalletWarningModal`:
    `This pallet has 9 bikes. Saved like this the order needs 4 pallets instead of 3. Fill them up to 12?`.

### Caso 3: Orden con 26 bicicletas grandes (0 niños)

- **Entrada:** 26 bicicletas grandes.
- **Cálculo:** $\lceil 26 / 12 \rceil = 3$ tarimas.
- **Resultado esperado:**
  - **T1:** 12 grandes (llena).
  - **T2:** 12 grandes (llena).
  - **T3:** 2 grandes.
  - Total tarimas físicas: **3 tarimas**.
  - _No se reparten 9 + 9 + 8._ Se llenan 12 en orden de recogida para minimizar movimientos y maximizar densidad.

### Caso 4: Orden con 16 bicicletas de niño (0 grandes)

- **Entrada:** 16 bicicletas de niño.
- **Regla:** Tope de 15 por tarima (`KIDS_PER_PALLET_MAX = 15`).
- **Resultado esperado:**
  - Como $16 > 15$, no caben en una sola tarima aunque la altura fuera inferior a 90".
  - Total tarimas físicas: **2 tarimas**.
  - Distribución: 15 y 1 (o corte limpio por modelo si aplica, ej. 8 y 8).

---

## 11) ❓ Preguntas con respuestas por defecto

1. **❓ Vista inicial al abrir una orden:**  
   _Pregunta:_ ¿Una orden abierta en estado `active` o `double_checking` debe abrir siempre por defecto en la vista `PICK` hasta que todas las líneas tengan su check?  
   _Default:_ **Sí.** Abre en `PICK`. Cuando el 100% de las paradas están verificadas (o al pulsar `Ready to DC`), conmuta automáticamente a `BUILD` para la revisión de estiba y fotos.

2. **❓ Toque de marcado en paradas con SKU dividido entre 2 tarimas:**  
   _Pregunta:_ En `ROW 43` con 8× `03-3981GY` (3 para T2 y 5 para T3), ¿el toque principal marca las 8 unidades juntas?  
   _Default:_ **Sí.** El picker en el estante toma las 8 cajas juntas. Un toque marca 8/8. Si falta stock, el panel de ajuste (`StockIssuePanel`) permite marcar la cantidad parcial encontrada.

3. **❓ Tratamiento de bicis de niño en el carro durante la recogida:**  
   _Pregunta:_ En #881856, las 6 bicis de niño se recogen en ROW 42 antes de las bicis base de T3 en ROW 43. ¿El aviso `▲ ON TOP (SET ASIDE)` es suficiente en pantalla?  
   _Default:_ **Sí.** El chip ámbar `▲ ON TOP · T3 (SET ASIDE)` advierte al operario que no coloque esas cajas en el fondo de la tarima sino a un lado del carro para colocarlas arriba una vez tomadas las 5 de ROW 43.

4. **❓ Límite estricto de 12 grandes sin bicis de niño:**  
   _Pregunta:_ ¿El tope de 12 grandes por tarima es inviolable para el algoritmo salvo que el piso fuerce manualmente más unidades?  
   _Default:_ **Sí.** El motor jamás planificará 13 o más bicicletas grandes en una tarima física.

5. **❓ Supresión del aviso si no aumenta el total de tarimas:**  
   _Pregunta:_ Si el piso arma a mano una tarima con menos bicis pero el total global de tarimas no cambia (ej. guardar 10 en vez de 12 y el total sigue siendo 3), ¿se omite el modal de advertencia?  
   _Default:_ **Sí.** El modal `HandPalletWarningModal` solo se dispara si la acción manual **aumenta** la cantidad de tarimas físicas del envío. Si no cuesta tarimas extra, no interrumpe.

---

## 12) Riesgos y mitigaciones

| Riesgo                                                          | Impacto                                                              | Mitigación                                                                                                                                  |
| :-------------------------------------------------------------- | :------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| **Desfase físico si el picker estiba distinto a como recogió.** | El contenido real de la tarima diferiría de lo sugerido por el plan. | La vista `BUILD` permite validar cada tarima con su lista de contenido y ajustarla con el lápiz antes de cerrar la orden.                   |
| **Confusión del picker al ver un SKU en dos tarimas.**          | Duda sobre cuántas cajas extraer del estante.                        | En `PICK`, la cifra principal es el **total de la parada** (ej. `8`). La partición por tarima es un dato secundario y visualmente discreto. |
| **Bicis de niño aplastadas si se colocan abajo.**               | Daño en el producto durante el transporte.                           | Identificación explícita con chip ámbar `▲ ON TOP` en `PICK` y separación obligatoria en el bloque `ON TOP` en `BUILD`.                     |
