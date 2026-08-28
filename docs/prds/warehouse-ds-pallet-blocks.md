> **Superseded 2026-08-28 (idea-170):** el plan DS-pallet (pestaña Plan) fue borrado con la fase F4; el mapa medido en
> `src/features/warehouse-map/` lo reemplaza. Ver `docs/prds/warehouse-map-measured.md`.

# PRD: Modelo DS-Pallet, Bloques de Rows y Área Pull First

**Estado:** Draft · **Fecha:** 2026-07-28 · **Autor:** Rafael + PickD
**Reemplaza parcialmente:** `docs/overstock-putaway-plan.md` (modelo torres/líneas del planner)

---

## 1) Contexto y Problema

El planner de overstock (`/warehouse-map`, tab _Plan_) hoy modela cada sublocación como **1 torre de 30 unidades** o **hasta 6 líneas de 5 unidades**, y decide qué SKU entra mediante un **ranking dinámico** por cantidad y velocidad de venta (`rankByWeightedScore`, sliders de peso en la UI).

Ese modelo dejó de coincidir con la operación física:

- **El contenedor real cambió.** El almacén ya no arma torres ni líneas en estas rows: arma **DS-Pallets** (_double stacked pallets_) de **máximo 25 y mínimo 20 unidades**. Una sublocación es un pallet y nada más.
- **El planner es demasiado exigente con la cola larga.** Al permitir líneas de 5 unidades, el algoritmo mete SKUs diminutos en un espacio caro y de difícil acceso. Hoy **101 de los 117 pares SKU+row colocados en ROW 28-33 tienen menos de 20 unidades** (427 de 947 unidades totales): el bloque está lleno de restos.
- **El criterio de entrada es opaco.** Un ranking automático decide qué se queda, pero la decisión de "qué se queda y qué se va" es de la operación, no de una fórmula. No hay lista explícita ni auditable.
- **El planner ignora la realidad física.** Calcula desde cero y puede asignar una celda a un SKU distinto del que ya está ahí, generando movimientos innecesarios sobre mercadería que nadie pidió mover.
- **Falta capacidad.** El bloque ROW 31/32/33 es el único que el planner conoce, y el almacén necesita administrar también ROW 28/29/30 con la misma lógica.

## 2) Objetivo

Reformular el planner alrededor de tres ideas:

1. **Un contenedor único y predecible:** la sublocación es un DS-Pallet mono-SKU de 20-25 unidades.
2. **Una lista curada de no-movers** como criterio explícito de quién ocupa estos bloques, anclada a la posición física actual.
3. **Dos bloques independientes** (ROW 31-33 y ROW 28-30) más un área de salida **Pull First** para lo que no alcanza a formar pallet.

**Métrica de éxito:** cero sublocaciones con menos de 20 unidades en ROW 28-33, y un plan que el manager pueda ejecutar sin reubicar SKUs que ya estaban bien puestos.

## 3) Público Objetivo y Usuarios

- **Gerente de Almacén** — Cura la lista de no-movers (paso 1), ejecuta el Recalculate de cada bloque, imprime el mapa y la lista de Pull First. Usuario principal.
- **Stacker Drivers / Operadores** — Consumen el mapa impreso. Necesitan que "pallet = 25 unidades" sea una promesa confiable para no contar en el piso.
- **Administradores del Sistema** — Auditan por qué un SKU quedó dentro o fuera del bloque.

## 4) Alcance

### ✅ In Scope

- **Modelo DS-Pallet** en el tab _Plan_: 1 sublocación = 1 pallet mono-SKU, min 20 / max 25 unidades. Elimina torres y líneas del planner.
- **Lista de no-movers** con curación híbrida (el sistema sugiere, el manager confirma), persistida en Supabase y compartida entre usuarios.
- **Segundo bloque ROW 28/29/30**, geométricamente espejo de ROW 31/32/33.
- **Anclaje a posición actual**: un no-mover que ya está dentro de los bloques conserva su celda.
- **Área Pull First** por bloque: panel read-only + sección imprimible con lo que no formó pallet.
- **Dos planes independientes**: Recalculate, guardado e impresión separados por bloque.
- Reescritura de `overstockPutaway.test.ts` al nuevo modelo.

### ❌ Out of Scope

- **Picking no se toca.** `containerDistribution.ts` y `distributionCalculator.ts` (30/5) siguen siendo el lenguaje de torres/líneas para el picker. Este PRD solo cambia el planner.
- **Pull First no es una location de DB.** No se crea en `locations`, no se mueve inventario hacia ella, no se trackea su ocupación.
- **Los movers no se gestionan aquí.** El planner los descarta; su desalojo se maneja en el piso.
- Drag & drop de celdas en el mapa, rutas de montacargas, cambios al tab _Live_ más allá de la etiqueta.
- Reconciliación entre la zona slow de Consolidation (ROW 20-31) y estos bloques — ver §9.

## 5) Conceptos de Dominio

| Concepto             | Definición                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DS-Pallet**        | _Double stacked pallet_. Unidad de almacenamiento de estos bloques: **1 sublocación, 1 SKU, 20-25 unidades**. Reemplaza torre (30u) y línea (5u) dentro del planner. |
| **Bloque**           | Conjunto de 3 rows contiguas administradas como una unidad. Dos bloques: **A = ROW 31/32/33**, **B = ROW 28/29/30**.                                                 |
| **No-mover**         | SKU que la operación decide **dejar** en estos bloques. Vive en una lista curada explícita. Solo los no-movers entran al planner.                                    |
| **Mover**            | SKU que la operación decide **sacar**. El planner lo ignora por completo; su celda actual se considera libre.                                                        |
| **Anclaje**          | Un no-mover que ya tiene stock físico dentro de su bloque conserva su sublocación exacta en el plan.                                                                 |
| **Pull First**       | Área conceptual de salida. Agrupa las unidades que no alcanzan a formar un DS-Pallet. Se resuelve manualmente, fuera del algoritmo.                                  |
| **Celda reservada**  | Sublocación `J` de cada row: nunca se asigna (comportamiento actual, se conserva).                                                                                   |
| **Celda landlocked** | Sublocación sin pasillo lateral: row del medio del bloque (32 en A, 29 en B), letras B-I.                                                                            |

## 6) Requerimientos Funcionales

### 6.1 Lista de no-movers (paso 1 del flujo)

| ID          | Requerimiento                                                                                                                                                                                                                                                                                                                                            | Criterio de verificación                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RF-001**  | El sistema debe ofrecer una pantalla/paso de **curación de no-movers** previa al cálculo del plan. Sin lista, el Recalculate no está disponible.                                                                                                                                                                                                         | Con la lista vacía, el botón _Recalculate_ aparece deshabilitado con el mensaje "Definí primero la lista de no-movers".                                      |
| **RF-002**  | El sistema debe **sugerir candidatos** a no-mover por **recencia de envío**: un SKU sin envíos completados en los últimos **30 días** es candidato a no-mover; con envíos en ese período es mover. Usa `get_sku_movement_stats` / `_batch` (alias-aware) y su campo `last_shipped`. **El conteo de órdenes no se usa como criterio de corte** (ver §10). | La pantalla lista candidatos ordenados por antigüedad del último envío, mostrando SKU, unidades, último envío, órdenes/12m (informativo) y ubicación actual. |
| **RF-002b** | La ventana de recencia debe ser un **control visible en la pantalla de curación**, no una constante oculta. Muestra el valor vigente en texto plano (ej. _"Sin envíos en los últimos **30 días**"_) y permite cambiarlo desde ahí (30 / 45 / 60 días o valor libre).                                                                                     | El manager ve el criterio activo sin abrir documentación ni código, y puede modificarlo desde la misma pantalla.                                             |
| **RF-002c** | Al cambiar la ventana, las sugerencias se **recalculan en vivo** y la UI muestra el impacto antes de confirmar nada: cuántos SKUs pasan de mover a no-mover y viceversa.                                                                                                                                                                                 | Pasar de 30 a 60 días actualiza el listado y muestra "X SKUs dejan de ser movers".                                                                           |
| **RF-002d** | El umbral mínimo de unidades para DS-Pallet debe ser **visible y editable** en la pantalla de clasificación, junto a la ventana de recencia. Su valor vigente explica por qué un SKU cae en Pull First.                                                                                                                                                  | Un SKU con 12u muestra el motivo "12u < 20u mínimo"; al bajar el mínimo a 10, ese SKU pasa a DS-Pallet.                                                      |
| **RF-003**  | Ningún SKU se agrega a la lista **sin confirmación explícita** del manager. Las sugerencias son propuestas, no altas automáticas.                                                                                                                                                                                                                        | Recargar la pantalla sin aceptar nada deja la lista igual que antes.                                                                                         |
| **RF-004**  | Cada entrada de la lista tiene un **bloque asignado** (A o B). Un SKU no puede estar en ambos.                                                                                                                                                                                                                                                           | Intentar asignar a B un SKU ya asignado a A muestra un error y no persiste.                                                                                  |
| **RF-005**  | La asignación de bloque se **precarga desde la ubicación física actual** del SKU. Si está fuera de ROW 28-33, el manager elige el bloque.                                                                                                                                                                                                                | Un SKU con stock en ROW 29 aparece con bloque B preseleccionado; uno en ROW 12 aparece sin bloque y bloquea el guardado hasta elegir.                        |
| **RF-006**  | La lista se **persiste en Supabase** y es visible para todos los usuarios autenticados.                                                                                                                                                                                                                                                                  | Curar la lista en un navegador y abrir la pantalla en otro muestra el mismo contenido.                                                                       |

### 6.2 Modelo DS-Pallet

| ID         | Requerimiento                                                                                                                                                                                                                                                                                                 | Criterio de verificación                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **RF-007** | Una sublocación asignada contiene **exactamente un SKU** en un DS-Pallet de 20 a 25 unidades. Se elimina el renderizado y la lógica multi-SKU por celda.                                                                                                                                                      | Ninguna celda del plan muestra dos SKUs. `MAX_LINES_PER_SUBLOCATION` y `LINE_CAPACITY` ya no existen en el código.                  |
| **RF-008** | La partición de la cantidad de un SKU es: `n = floor(qty / 25)` pallets llenos; el resto `r` genera un pallet adicional **solo si `r >= 20`**; si `r < 20`, el resto completo va a Pull First.                                                                                                                | `60u → [25][25] + 10 a Pull First` · `45u → [25][20]` · `38u → [25] + 13 a Pull First` · `18u → 18 a Pull First` · `50u → [25][25]` |
| **RF-009** | Un SKU con **menos de 20 unidades totales** nunca ocupa una celda: va íntegro a Pull First.                                                                                                                                                                                                                   | Un no-mover con 12u no aparece en el grid y sí en la lista de Pull First con motivo "bajo mínimo".                                  |
| **RF-010** | `DS_PALLET_MIN` (default **20**) es **editable por el usuario** desde la pantalla de clasificación y se persiste junto a la lista de no-movers. `DS_PALLET_MAX` (**25**) es fijo: es la capacidad física del pallet, no una preferencia. Ambos se definen una sola vez en el código como valores por defecto. | Cambiar el mínimo a 15 recalcula qué SKUs ganan pallet. Buscar `25` en el planner devuelve una única definición.                    |

### 6.3 Bloques y colocación

| ID          | Requerimiento                                                                                                                                                            | Criterio de verificación                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **RF-011**  | Existen dos bloques: **A = ROW 31/32/33** y **B = ROW 28/29/30**. Las tres rows de cada bloque son uniformes entre sí (las seis miden 52 ft).                            | El grid del bloque B renderiza 3 columnas con el mismo número de posiciones que el bloque A.                       |
| **RF-011b** | La cantidad de sublocaciones por row **no se hardcodea**: es configuración por row que el planner lee. Hoy el código fija `LETTERS = A..J`; debe pasar a derivarse.      | Cambiar la configuración de una row a 12 posiciones hace que el grid renderice 12 celdas sin tocar código.         |
| **RF-011c** | La **última posición de cada row queda reservada** (nunca se asigna), y esa regla aplica **solo dentro de los bloques A y B**. Fuera de ellos no hay posición reservada. | La última celda de cada columna se renderiza en estilo reservado; las rows fuera de los bloques no tienen ninguna. |
| **RF-011d** | La row del medio de cada bloque (32 en A, 29 en B) es **landlocked** salvo en sus dos extremos: no tiene pasillo lateral.                                                | Las celdas intermedias de la columna central se marcan como landlocked al calcular prioridad de colocación.        |
| **RF-012**  | Un no-mover con stock físico **dentro de su bloque conserva su sublocación exacta** (anclaje duro). El algoritmo no lo reubica.                                          | Un no-mover con 30u en ROW 32-C aparece en el plan en ROW 32-C.                                                    |
| **RF-013**  | Un no-mover **fuera de los bloques** recibe la mejor celda libre de su bloque asignado, según las reglas de prioridad existentes (proximidad, accesibilidad).            | Un no-mover en ROW 12 asignado al bloque B aparece colocado en alguna celda libre de ROW 28/29/30.                 |
| **RF-014**  | Los SKUs que **no** están en la lista de no-movers se ignoran por completo: no se colocan, no se muestran y **sus celdas actuales se consideran libres**.                | Una celda ocupada físicamente por un mover aparece disponible en el plan y puede recibir otro SKU.                 |
| **RF-015**  | Cada bloque tiene su **propio Recalculate, su propio guardado y su propia impresión**. Recalcular un bloque no altera el plan del otro.                                  | Recalcular A y refrescar deja el plan de B con su `updated_at` anterior.                                           |

### 6.4 Pull First

| ID         | Requerimiento                                                                                                                                                                                                   | Criterio de verificación                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **RF-016** | Cada bloque muestra su propia sección **Pull First** con las unidades que no formaron pallet: SKU, cantidad, ubicación actual y **motivo** ("bajo mínimo" / "resto de partición" / "sin espacio en el bloque"). | Un SKU con 38u produce una fila de Pull First con 13u y motivo "resto de partición". |
| **RF-017** | Pull First es **read-only**: no tiene checkboxes, estado ni asignación de destino. El movimiento se ejecuta con el flujo de movimiento existente.                                                               | La sección no expone ninguna acción de escritura.                                    |
| **RF-018** | Pull First se **incluye en la impresión** del bloque, debajo del mapa.                                                                                                                                          | _Print Landscape_ genera el mapa y la lista de Pull First en el mismo documento.     |
| **RF-019** | El contenido de Pull First (`plan.unplaced`) se **persiste** junto con el plan.                                                                                                                                 | Recargar la página sin recalcular muestra el mismo Pull First.                       |

## 7) Reglas de Resolución de Conflictos

Estas reglas se derivan de los requisitos anteriores y deben implementarse explícitamente:

| Situación                                                                               | Resolución                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No-mover anclado con **menos de 20 unidades** en su celda actual                        | **El mínimo gana sobre el anclaje.** La celda se libera y las unidades van a Pull First.                                                                        |
| No-mover anclado con **más de 25 unidades** en una sola celda                           | Conserva la celda con 25u; el excedente sigue la regla de partición (RF-008): pallets adicionales en celdas libres del mismo bloque, resto `< 20` a Pull First. |
| **Dos no-movers anclados a la misma celda** (herencia de las celdas multi-SKU actuales) | Conserva la celda el de **mayor cantidad**; el otro se trata como si viniera de fuera del bloque (RF-013).                                                      |
| No-mover cuyo bloque asignado **no tiene celdas libres**                                | Va a Pull First con motivo "sin espacio en el bloque". **No** desborda al otro bloque (la exclusividad de RF-004 es estricta).                                  |
| No-mover con stock repartido en **ambos bloques**                                       | Se respeta el anclaje en su bloque asignado; las unidades del otro bloque se tratan como stock externo a reubicar.                                              |

## 8) Requerimientos No Funcionales

- **RNF-001 (Determinismo)** — Dos ejecuciones del Recalculate sobre la misma lista y el mismo inventario producen un plan idéntico. Sin dependencia del orden de recálculo entre bloques.
- **RNF-002 (Trazabilidad)** — Cada celda del plan puede explicar por qué está ocupada por ese SKU: _anclada_ o _asignada_.
- **RNF-003 (Compatibilidad de impresión)** — Se conserva el print a 1 página A4 en landscape y portrait, incluyendo la sección Pull First.
- **RNF-004 (Migración de planes)** — El plan persistido incorpora `plan_version`. Si la versión guardada no coincide con la del código, la UI descarta el plan y solicita Recalculate. **Sin migración de datos.**
- **RNF-005 (Consistencia visual)** — Componentes y tokens Tailwind existentes de PickD. La celda de pallet reutiliza el color por familia de `skuColor.ts`.

## 9) Criterios de Aceptación

1. **Dado** que la lista de no-movers está vacía, **cuando** el usuario abre el tab _Plan_, **entonces** ve el paso de curación y el Recalculate deshabilitado.
2. **Dado** un no-mover con 60 unidades fuera de los bloques asignado al bloque A, **cuando** se recalcula A, **entonces** ocupa 2 celdas con 25u cada una y aparecen 10u en Pull First con motivo "resto de partición".
3. **Dado** un no-mover con 30 unidades ya ubicado en ROW 32-C, **cuando** se recalcula A, **entonces** sigue en ROW 32-C con 25u y 5u van a Pull First.
4. **Dado** un no-mover con 12 unidades ubicado en ROW 33-B, **cuando** se recalcula A, **entonces** ROW 33-B queda libre y las 12u aparecen en Pull First con motivo "bajo mínimo".
5. **Dado** un SKU que **no** está en la lista y ocupa físicamente ROW 29-D, **cuando** se recalcula B, **entonces** ROW 29-D figura como disponible y puede recibir otro no-mover.
6. **Dado** un SKU asignado al bloque A, **cuando** el manager intenta asignarlo también a B, **entonces** el sistema lo rechaza.
7. **Dado** un plan guardado con el modelo anterior (torres/líneas), **cuando** el usuario abre el tab _Plan_, **entonces** la UI no lo renderiza y pide Recalculate.
8. **Dado** un plan calculado, **cuando** el usuario presiona _Print Landscape_, **entonces** el PDF incluye el mapa del bloque y su lista de Pull First.

## 10) Datos de Referencia (verificación previa, DB local sincronizada al 2026-07-24)

Confirmaciones que sostienen el diseño:

- **ROW 28/29/30 existen y son geométricamente equivalentes a 31/32/33**: las 6 rows miden **52 ft** y tienen `max_capacity` 300-330. Esto valida el espejo de RF-011.
- **Capacidad nominal del modelo**: es función de la configuración por row (RF-011b), no un número fijo. Con `n` posiciones por row, cada bloque tiene `3n − 3` celdas útiles (se descuenta la reservada de cada row) × 25u. La capacidad real se conocerá cuando se complete el re-rotulado manual de sublocaciones.
- **El pool alcanza de sobra**: hay **874 SKUs con 20 o más unidades** (185k unidades) en el almacén. La regla del mínimo **no** vacía el mapa; el cuello de botella es la curación, no el volumen disponible.
- **El criterio mover / no-mover es la recencia, no el volumen.** Validado contra una clasificación manual previa de la operación: el conteo de órdenes a 12 meses **no separa** las dos clases (hay no-movers con 12 y 14 órdenes, y movers con 8 y 9). La fecha del último envío sí lo hace sin excepciones — todos los no-movers de esa clasificación tenían su último envío el 2026-06-19 o antes, y todos los movers el 2026-06-30 o después. Un corte en **30 días** reproduce la clasificación manual al 100%. Esto sostiene RF-002.
- **Clasificación actual de los bloques bajo ese criterio** (116 SKUs con stock): bloque A → 6 movers (65u) / 57 no-movers (194u); bloque B → 25 movers (396u) / 28 no-movers (292u). De los **85 no-movers, solo 7 alcanzan las 20 unidades** necesarias para un DS-Pallet. Es decir: conservar únicamente lo que ya está en los bloques llena **7 celdas entre los dos** — una fracción mínima de la capacidad, cualquiera sea el conteo final de posiciones. El grueso debe cubrirse con no-movers traídos de otras rows, vía RF-013.
- **ROW 33 opera hoy como cajón de sastre**: unas 30 de sus líneas son SKUs `01-xxxx` / `02-xxxx` con 1 unidad y **cero envíos registrados**. Clasifican como no-movers pero no son candidatos a DS-Pallet; la pantalla de curación debe hacerlos fáciles de descartar en bloque.
- **El estado actual de los bloques está muy fragmentado**: **101 de 117 pares SKU+row en ROW 28-33 tienen menos de 20 unidades**. Consecuencia práctica: en la primera corrida casi ningún anclaje sobrevive y el plan será prácticamente un rediseño desde cero. **Debe comunicarse al manager antes del primer Recalculate.**
- **Por qué solo aparecen A-F en los datos**: hasta ahora **dos torres compartían una misma sublocación**, así que las 6 letras rotuladas representan ~12 posiciones físicas. Con el modelo DS-Pallet cada pallet tiene su propia sublocación, de modo que el rotulado por row se duplica. **El re-rotulado es un plan aparte y se ejecuta manualmente** — fuera del alcance de este PRD. Por eso RF-011b exige que el planner lea la cantidad de posiciones en vez de asumirla.
- **Las rows no son todas iguales**: cada row del almacén tiene un largo distinto y por lo tanto distinta cantidad de sublocaciones. Esa variación aplica **fuera** de los bloques A y B; las seis rows de los bloques sí son uniformes entre sí (52 ft cada una, confirmado en `locations`).

## 11) Riesgos y Supuestos

### Supuestos

- Las tres rows de cada bloque son uniformes entre sí, de modo que una sola configuración por bloque alcanza.
- El re-rotulado de sublocaciones (de ~6 slots dobles a ~12 individuales) lo ejecuta la operación manualmente, y el planner solo consume el resultado.
- La operación puede desalojar los movers del piso sin apoyo del sistema.
- El manager cura la lista con la frecuencia suficiente para que el plan siga siendo relevante.

### Riesgos

| Riesgo                                                                                                                                                     | Mitigación                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **La lista de no-movers se vuelve stale**: SKUs sin stock siguen en la lista y reservan celdas                                                             | El planner ignora entradas sin stock activo y las marca como "sin stock" en la pantalla de curación para que el manager las depure.                                                                                                                                                                                                                                                                                       |
| **Pull First crece sin control** y nadie lo procesa                                                                                                        | Se muestra el total de unidades y SKUs en el encabezado de la sección; si supera un umbral visible, es señal de que la lista de no-movers está mal curada.                                                                                                                                                                                                                                                                |
| **El re-rotulado manual y el planner se desincronizan**: la operación divide los slots dobles a su ritmo, pero la configuración de RF-011b no se actualiza | La pantalla de clasificación muestra la configuración vigente por bloque y permite corregirla. Si el conteo configurado no coincide con lo rotulado en el piso, el plan asigna celdas que no existen.                                                                                                                                                                                                                     |
| **Los `sublocation` existentes quedan ambiguos** tras el re-rotulado: un `ROW 31 · C` apunta hoy a un slot doble                                           | No se migran los valores viejos. El primer Recalculate reasigna casi todo de todas formas (solo 7 de 85 no-movers conservarían celda), así que una migración inventaría una precisión que no existe — nadie sabe cuál de las dos torres de un slot era cuál.                                                                                                                                                              |
| **Solapamiento con Consolidation**: sigue recomendando slow movers hacia bay 3 (ROW 20-38), que contiene ambos bloques                                     | **Decidido: el solapamiento se acepta**, Consolidation no cambia. Consecuencia a vigilar: Consolidation puede sugerir mover stock a una celda que el planner ya asignó a otro SKU. El planner es la fuente de verdad para ROW 28-33; ante conflicto, gana el plan. Nota: el código hoy usa ROW 20-31 como `CONSOLIDATE_TARGETS` (`ConsolidationScreen.tsx`), no 20-38 — hay que verificar cuál refleja la operación real. |
| **Pérdida del plan guardado** al desplegar                                                                                                                 | Es intencional (RNF-004). Comunicar al manager que debe recalcular ambos bloques tras el deploy.                                                                                                                                                                                                                                                                                                                          |

## 12) Deuda Técnica Bloqueante

Debe resolverse dentro de este trabajo, no después:

1. **`plan.unplaced` se descarta al guardar.** `useWarehouseMapPersistedPlan.ts` escribe `plan.stats` — un campo que no existe en `PutawayPlan` — y no persiste `unplaced`. Sin esto **Pull First no tiene de dónde salir** (RF-019).
2. **`useAvailableWarehouseRows` no pagina.** Selecciona `location` sin rango, así que el cap de 1000 filas de PostgREST puede ocultar rows del selector. Relevante ahora que se suman ROW 28-30. `useOverstockCandidatePool` ya pagina correctamente y sirve de referencia.
3. **`FORCED_TOWER_SLOT_IDS` pierde sentido.** Con todas las celdas siendo pallets, forzar "torre" en `31-A` / `33-A` no significa nada. Debe eliminarse o reinterpretarse explícitamente como "celda de alta prioridad".
4. **Umbral huérfano en el tab Live.** `useRealInventoryMap.ts` clasifica torre con `>= 15`, un número que no existe en ningún otro lado. Alinear la etiqueta al nuevo vocabulario.
5. **Celdas vacías etiquetadas `reserved`** en el tab Live, cuando deberían ser `empty`.

## 13) Fuera de Alcance Explícito para Fases Siguientes

- Convertir Pull First en una location real con tracking de ocupación.
- Sugerir destinos concretos para los ítems de Pull First.
- Reconciliar la zona slow de Consolidation con los bloques.
- Extender el modelo de bloques a otras rows del almacén.
