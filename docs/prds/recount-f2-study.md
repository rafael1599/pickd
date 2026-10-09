> **Verificación del orquestador (9 oct 2026).** Abrí las citas clave y se sostienen:
> `ReasonPicker.tsx:13-22` (razones), `PickingCartDrawer.tsx:842-855` (Edit Order sólo reescribe
> `items`, no toca inventario) y `20260927011500_explicit_shipments.sql:579-600`. **Falta en el
> estudio una cosa que importa para la frase de Rafael** («ahí recién se le avisaría que se está
> cambiando a 0»): **hoy ya existe un cero, y es silencioso.** Si una orden se completa con una línea
> que sigue marcada `insufficient_stock` o `sku_not_found`, `process_picking_list` pone a 0 lo que
> quede en esa ubicación (`'system: auto-zero out-of-stock'`) y no avisa a nadie. Ese es el sitio
> natural del aviso, o del recount en lugar del cero (❓ 11 abajo).
>
> Riesgo real que el estudio señala en el punto 2: si el picker marca una línea de 5 teniendo 2 y
> contesta «0 left», F1 da `Matches` (0 + 5 de su orden = 5 del sistema) y cierra el recount en falso.

# Estudio: Recount F2 — Dónde y cómo se pide un recount (idea-263)

**Fecha:** 9 de octubre de 2026  
**Repositorio:** `/Users/rafaellopez/dev/pickd-workspace/pickd` (`main` @ HEAD)  
**Destinatario:** Rafael  
**Modo:** Solo lectura estricto (análisis de código, pantallas, flujos y migraciones; sin edición de archivos del repo, sin commits, sin tocar BD).

---

## 0. Resumen ejecutivo (conclusiones en 8 puntos)

1. **Edit Order por faltante:** En DCV no existe pick parcial; si una línea pide 5 bicis, se marcan las 5. Para recortar unidades el picker debe ir a Edit Order o `StockIssuePanel`. Hoy esa edición solo modifica `picking_lists` y **no toca inventario ni pone nada a 0**, dejando unidades fantasma en el estante; ahí es el momento exacto para que el sistema invoque `request_recount`.
2. **Pregunta de F1 en Double Check:** F1 resuelve peticiones previas cuando el pick es completo («How many are left here?»); el punto 1 genera peticiones nuevas ante un faltante. No chocan si el picker no marca el check ante un faltante (marcar afirma tener el 100%), sino que abre Edit Order.
3. **⋯ de la tarjeta de Stock:** Es el lugar idóneo para pedir recount ante discrepancias visuales de pasillo. Hoy `DistributionMenu` recibe `location = undefined` por un bug de props (debe pasar `item?.location || location`). Si ya hay una petición abierta, el menú debe mutar a `Cancel recount request`, reservado al autor o a un admin.
4. **⋯ de la ficha del ítem:** `ItemCardView` representa una ubicación principal y muestra las demás en «Also». El ⋯ superior debe pedir recount para la ubicación principal que se está editando; las filas secundarias de «Also» quedan sin botón en F2 para no saturar.
5. **History:** Las filas de historial no tienen menú ⋯ y no debe agregarse; auditan transacciones pasadas y pedir conteos actuales desde allí confunde auditoría con inventario vivo. Conclusión: **No en F2**.
6. **Mapa, Edit squares y Move:** El mapa es macro-planeación, y en Edit squares y Move el operador ya cuenta y ajusta unidades en el acto. Conclusión: **No en F2**.
7. **Quién ve el pedido y cuándo:** Si un SKU está en una orden abierta, `v_recount_requests_open` oculta la marca `Needs recount` (regla de no contar con carritos en tránsito). Para que el usuario no crea que falló, el toast debe avisar «Recount requested · Waiting for Order #N to ship» y el ⋯ debe consultar `allOpenBySkuLocation`.
8. **Modo pistola (F3):** F2 es exclusivamente la solicitud (`request_recount`). El disparo continuo +1 y aprendizaje de UPCs con la Zebra ET401 es conteo puro y queda 100% en **F3**.

---

## 1. Edit Order por faltante

### (a) Qué pasa hoy, paso a paso con `archivo:línea`

1. **En Double Check (`DoubleCheckView.tsx:3235-3240`):**
   Al tocar la tarjeta de un ítem, el evento `onClick` ejecuta `handleToggleCheck(item, pallet.id)`. Este delega en `onToggleCheck` (`DoubleCheckView.tsx:288`) y este en `toggleCheck` (`src/features/picking/components/PickingCartDrawer.tsx:664-694`).
2. **La verificación es todo o nada:**
   La clave que se agrega o quita del Set de verificación es `${palletId}-${item.sku}-${item.location}` (`PickingCartDrawer.tsx:665`). Si la orden pide 5 bicicletas, al tocar la tarjeta se marcan las 5 de golpe. **No existe selector parcial de cantidad ni contador en la tarjeta de pick.**
3. **Si el picker encuentra menos unidades (ej. 2 de 5):**
   El picker no puede marcar la tarjeta. Tiene dos alternativas para corregir la orden:
   - Si el sistema ya conocía un faltante (`insufficient_stock`), se despliega bajo la tarjeta el `StockIssuePanel` (`DoubleCheckView.tsx:3655`), con opciones directas: `Take 2` (`StockIssuePanel.tsx:130-139`), `Remove` (`170-176`), `Use [hermano]` (`150-160`) o `Replace` (`161-168`).
   - Si el sistema creía que había 5 unidades, el picker debe abrir **Edit Order** (`CorrectionModeView.tsx`) desde la orden.
4. **En Edit Order (`CorrectionModeView.tsx:626-642`, `985-1048`):**
   - El picker toca la línea y entra al panel `adjust_qty` (`lines 985-1019`) o `remove` (`lines 1021-1048`).
   - Teclea la cantidad real encontrada (ej. 2) en `QtyInput` (`line 987`).
   - Se le exige seleccionar una razón en `ReasonPicker.tsx:13-22`:
     - Para `adjust_qty`: `'Partial stock only'`, `'Customer changed qty'`, `'Damaged units'`, `'Count correction'`.
     - Para `remove`: `'Out of stock'`, `'Customer cancelled'`, `'Damaged/defective'`, `'Wrong item on order'`.
     - Para `swap`: `'Out of stock — replacing'`, `'Wrong size/color'`, `'Customer requested'`, `'Damaged — swapping'`.
   - Pulsa "Update Qty" (`CorrectionModeView.tsx:1015`) o "Yes, Remove" (`line 1044`). Esto llama a `onCorrectItem` -> `handleCorrectItem` (`PickingCartDrawer.tsx:778-921`).
5. **Qué escribe en base de datos en ese momento:**
   - En `PickingCartDrawer.tsx:845` actualiza la línea:
     `{ ...item, pickingQty: 2, insufficient_stock: false }`
   - En `PickingCartDrawer.tsx:898-901`:
     `UPDATE picking_lists SET items = newItems, total_units = newTotalUnits WHERE id = writeListId;`
   - En `PickingCartDrawer.tsx:903-907`:
     `INSERT INTO picking_list_notes (list_id, user_id, message) VALUES (writeListId, user.id, 'Adjusted 03-XXXX qty to 2: Partial stock only');`
6. **¿Qué escribe en inventario hoy? ABSOLUTAMENTE NADA.**
   - No toca la tabla `inventory`.
   - El trigger `compensate_picking_list_changes` (`supabase/migrations/20260731120000_fix_edit_remove_ghost_restore.sql:98-100`) solo evalúa filas donde `picked = true`. En PickD las marcas viven en `verified_item_keys` y no en `items[].picked` (la bandera `picked` se retiró en mayo de 2026, regla de `.claude/rules/picking.md:28-29`). Por ende, el trigger no hace nada al editar la orden.
   - Cuando la orden se completa más tarde vía `process_picking_list` (`supabase/migrations/20260927011500_explicit_shipments.sql:575-605`):
     - Como la edición puso `insufficient_stock: false` (`PickingCartDrawer.tsx:845`), el bloque `auto-zero out-of-stock` (`lines 580-590`) se salta.
     - `process_picking_list` descuenta las 2 unidades que quedaron en la orden (`line 498`).
     - **Las 3 unidades que no existían quedan vivas y activas en `inventory` en esa ubicación.**
     - Si el picker usó `remove` (0 encontradas), la línea se borró de `items` (`PickingCartDrawer.tsx:854`). `process_picking_list` ni se entera de que estuvo en la orden y no descuenta nada, dejando las 5 unidades intactas en `inventory`.

### (b) El momento exacto donde pedir un recount tiene sentido, y por qué ahí y no antes

En `handleCorrectItem` (`PickingCartDrawer.tsx:778`), justo cuando se confirma una corrección de tipo `adjust_qty` (con reducción de cantidad) o `remove` (o `swap`), y la razón seleccionada indica faltante de existencias en el piso (`Partial stock only`, `Out of stock`, `Damaged units`, `Count correction`, `Out of stock — replacing`).  
**Por qué ahí y no antes:** Porque es el segundo exacto en que un operador humano con los ojos en el estante físico certifica: _"aquí no están las unidades que el sistema dice"_. Antes de ese momento, el sistema no tiene ninguna evidencia de que falten.

### (c) Qué escribiría y qué pasa con la cantidad del sistema

- **Qué escribiría:**  
  Llamaría a `request_recount(p_sku, p_warehouse, p_location, p_reason)`.
  - `p_sku`: `item.sku`
  - `p_warehouse`: `item.warehouse || 'LUDLOW'`
  - `p_location`: `item.location` (la ubicación física de la línea corregida)
  - `p_reason`: Generado automáticamente, ej.:
    - Para `adjust_qty`: `Picker took 2 of 5 in #${orderNumber} (Partial stock only)`
    - Para `remove`: `Picker removed line in #${orderNumber} (Out of stock)`
- **Qué pasa con la cantidad del sistema en ese momento:**
  - Rafael señaló: _«si la razón fuese out of stock, entonces ahí recién se le avisaría que se está cambiando a 0 la cantidad de [sku] que se tienen en el warehouse»_.
  - Si el sistema cambiara la cantidad a 0 de golpe, correría el riesgo de anular stock legítimo si el picker buscó en el cuadro equivocado o no vio cajas enterradas.
  - La regla fundacional de PickD (`recount-suggestions.md` §2) dice: _«contar es un número que escribe quien mira... nunca se copia el número del sistema»_.
  - Por ello, la recomendación técnica es: **no poner 0 a ciegas**. Se abre la petición en `recount_requests` para que alguien vaya y cuente a ciegas en esa ubicación. Si Rafael prefiere poner 0 de inmediato ante "Out of stock", debe disparar un diálogo de advertencia explícito: _«This will set shelf stock to 0 and open a recount request»_.
- **Qué pasa con las otras razones:**
  - `Customer cancelled` / `Customer changed qty`: Fueron decisiones del cliente, no faltante en bodega. **No disparan recount.**
  - `Wrong item on order`: Error administrativo/AS400; el SKU original sigue en su estante. **No dispara recount.**
  - `Damaged units` / `Damaged/defective`: Las cajas están ahí físicamente pero no se pueden despachar. Requieren inspección/SD. **Disparan recount con motivo `Damaged units reported in #${orderNumber}`.**

### (d) Conclusión

En DCV el picker no puede tomar una fracción de la línea; está obligado a ir a Edit Order o usar `StockIssuePanel` para recortar unidades. Hoy esa acción sólo achica la orden y deja las unidades fantasma intactas en el estante, por lo que ese guardado es el momento exacto para invocar automáticamente `request_recount` sobre esa ubicación.

### (e) ❓ Para Rafael (con default)

1. ❓ **Si la razón es "Out of stock" (0 encontradas), ¿la app solo abre `request_recount` dejando la cantidad del sistema hasta que alguien cuente a ciegas, o pone la cantidad en 0 de inmediato en esa ubicación avisando al picker?**  
   — **Default: Solo abre `request_recount` y deja la cantidad.** Quien haga el recount ciego pondrá el número real del estante sin inventar ceros.
2. ❓ **¿Qué razones disparan recount automático?**  
   — **Default: Solo las de faltante físico:** `Out of stock`, `Partial stock only`, `Damaged units`, `Count correction`, `Out of stock — replacing`. Razones de cliente o transcripción no abren recount.

---

## 2. La pregunta de F1 en Double Check («How many are left here?»)

### (a) Qué pasa hoy, paso a paso con `archivo:línea`

1. **Flujo de F1 (`DoubleCheckView.tsx:281-301`, `doubleCheckRecount.ts:39-86`):**
   Al tocar una tarjeta no verificada en DCV, `handleToggleCheck` marca la tarjeta y luego llama a `maybePromptRecountOnCheck`.
2. Si existe un recount abierto para ese `(sku, location)` en `openRecountsBySkuLocation` y ninguna otra orden lo retiene (`unitsHeldChecker` retorna 0), se abre el modal ciego `RecountSheet.tsx:154` preguntando:
   «How many are left here?»
3. El picker ingresa cuántas quedan en el estante y pulsa Save (`RecountSheet.tsx:91-135`).
4. `submitRecount` (`20261009112156_recount_requests.sql:135-192`) calcula:
   `v_target := p_counted + v_mine;`  
   (donde `v_mine` son las unidades de la orden actual leídas de `pl.items`).  
   `v_delta := v_target - v_system;`  
   Aplica el ajuste en `inventory` y cierra la fila en `recount_requests` (`status = 'closed'`).
5. **¿Qué pasa si el picker encuentra menos unidades y aun así toca la tarjeta en DCV?**
   - La tarjeta se marca con el total pedido (ej. 5 unidades).
   - Salta `RecountSheet`: «How many are left here?».
   - Si el estante quedó vacío, el picker teclea `0`.
   - `submitRecount` calcula: `0 + v_mine (5) = 5`. Compara con el sistema (5). Dice `Matches · 5`. Cierra el recount creyendo erróneamente que todo cuadró.
   - Si luego el picker va a Edit Order y cambia la orden de 5 a 2, la orden despachará 2, pero `submitRecount` ya se ejecutó asumiendo que tomó 5. Queda una inconsistencia en el inventario.

### (b) El momento exacto y cómo se complementan

- **F1 es para RESOLVER / CERRAR** un recount preexistente cuando el pick es normal y completo.
- **El Punto 1 es para CREAR / PEDIR** un recount nuevo cuando el picker no encuentra lo que el sistema pedía.
- **No chocan si se respeta el flujo de piso:**  
  Un picker que no encuentra las unidades completas **no debe marcar la tarjeta en DCV**, porque marcarla significa "tengo el 100% en el carrito". Debe ir directo a Edit Order (o usar el `StockIssuePanel` si está visible). Si por error tocó la tarjeta y salta el modal de F1, el picker tiene el botón `Skip` (`RecountSheet.tsx:86-89`) para salir sin cerrar el recount con números falsos.

### (c) Qué escribiría

- F1 cierra peticiones con `submit_recount(p_sku, p_warehouse, p_location, p_counted, p_list_id)`.
- Punto 1 crea peticiones con `request_recount(p_sku, p_warehouse, p_location, p_reason)`.

### (d) Conclusión

F1 está diseñado para cerrar peticiones cuando el pick se realiza con éxito; no choca con el Punto 1 porque ante un faltante el picker nunca debe verificar la tarjeta (que asume 100% de la cantidad), sino abrir Edit Order, donde se generará la nueva petición.

### (e) ❓ Para Rafael (con default)

3. ❓ **Si salta «How many are left here?» y el picker no tiene las unidades completas para su orden, ¿agregamos un botón en `RecountSheet` que diga «Short stock / Edit order» que cierre el modal y abra directamente Edit Order?**  
   — **Default: No en F2; el botón `Skip` actual es suficiente.** El picker salta la pregunta y va a Edit Order como hace con cualquier orden incompleta.

---

## 3. ⋯ de la tarjeta de Stock (`DistributionMenu`)

### (a) Qué pasa hoy, paso a paso con `archivo:línea`

1. **Invocación del menú (`src/features/inventory/components/InventoryCard.tsx:407-414`):**
   ```tsx
   <DistributionMenu
     isEmpty={!distribution || distribution.length === 0}
     onAdjust={() => (onAdjust ?? onClick)()}
     sku={sku}
     quantity={quantity}
     location={location}
     triggerClassName="h-9 w-9 shrink-0"
   />
   ```
2. **El bug de props descubierto en F1:**
   En `src/features/inventory/InventoryScreen.tsx:1010-1043`, cuando se renderiza `<InventoryCard item={item} />` en la lista de Stock, **NO se pasa la prop `location`** (la lista agrupa por ROW en cabeceras).
   Por lo tanto, `location` en `InventoryCardProps` es `undefined`.
   En `InventoryCard.tsx:248-251` (botón `Needs recount` de F1) se corrigió usando `item?.location || location || ''`.
   Pero en la línea 412 se sigue pasando `location={location}` (que es `undefined`).
   **Hoy `DistributionMenu` recibe `location = undefined` en la vista principal de Stock.**
3. **Contenido actual de `DistributionMenu` (`src/features/inventory/components/DistributionJengaViz.tsx:232-350`):**
   Tiene 8 opciones divididas en secciones:
   - `Full distribution editor...` / `Set distribution` (`line 253`)
   - `Print 1 Label (Flash 1-Tap)` (`line 265`)
   - `Print options...` (`line 279`)
   - `Take Photo (Camera)` (`line 299`)
   - `Choose from Gallery` (`line 313`)
   - `Movement history` (`line 327`)
   - `Copy SKU` (`line 339`)
   - `Consolidate SKU...` (`line 155`)

### (b) El momento exacto donde pedir un recount tiene sentido, y por qué ahí y no antes

Al caminar por el almacén en la pantalla de Stock, mirar un estante físico y notar que la cifra en pantalla no coincide con la realidad. No hay orden en curso ni movimiento de cajas; es una auditoría visual directa.

### (c) Qué escribiría y cómo se vería la opción y la cancelación

1. **Corrección requerida en `InventoryCard.tsx:412`:**
   Pasar `location={item?.location || location}`.
2. **Dentro de `DistributionMenu`:**
   - Consulta `useOpenRecounts()`, utilizando `allOpenBySkuLocation.get(recountKey(sku, location))` (que incluye solicitudes retenidas por órdenes abiertas).
   - **Si NO hay petición abierta:**
     Opción en el menú: `Ask for recount` (icono `ClipboardList` o `HelpCircle`).
     Al pulsar: Llama a `request_recount(sku, warehouse, location, 'Asked from stock card by ' + userName)`.
     Feedback con toast + `feedbackService.success()`.
   - **Si YA hay una petición abierta:**
     Opción en el menú: `Cancel recount request` (en color rojo/ámbar).
   - **Quién puede cancelar:**
     - En el cliente: `useAuth()` (`src/context/AuthContext.tsx:376`) expone `isAdmin` y `user.id`.
     - En DB: `recount_requests.requested_by` almacena el UUID del solicitante; `public.is_admin()` existe en Postgres (`supabase/migrations/20260307221638_remote_schema.sql:504`).
     - Puede cancelar si: `isAdmin || user?.id === req.requested_by`.
     - Los demás usuarios ven `Recount already requested` en texto gris inactivo.
   - **RPC necesaria para cancelar:**
     Como `recount_requests` no tiene política UPDATE para authenticated (`20261009112156_recount_requests.sql:47-53`), se requiere una función `cancel_recount(p_id uuid)` con `SECURITY DEFINER` que valide `auth.uid() = requested_by OR public.is_admin()`, actualizando `status = 'closed'` o eliminando la fila.

### (d) Conclusión

El menú ⋯ de la tarjeta de Stock es el lugar ideal para peticiones manuales al detectar fallos visuales; requiere corregir la prop a `location={item?.location || location}`. Si ya hay una petición activa, el menú debe transformarse en `Cancel recount request`, accionable únicamente por el creador de la solicitud o un admin.

### (e) ❓ Para Rafael (con default)

4. ❓ **Al pulsar `Ask for recount` en el ⋯ de Stock, ¿se genera inmediatamente la petición con 1 toque (motivo automático con el nombre del usuario), o debe abrir un modal para escribir una nota opcional?**  
   — **Default: 1 toque inmediato sin modal.** El motivo se genera automáticamente (`Asked from stock card by <Nombre>`).
5. ❓ **¿Se crea la RPC `cancel_recount(p_id uuid)` que permita cancelar sólo al autor o a un admin?**  
   — **Default: Sí, RPC con validación estricta.**

---

## 4. ⋯ de la ficha del ítem (`ItemDetailView/ItemCardView.tsx`)

### (a) Qué pasa hoy, paso a paso con `archivo:línea`

1. **Componente:** `src/features/inventory/components/ItemDetailView/ItemCardView.tsx:94-1350`.
2. **Prop:** Recibe `item: InventoryItemWithMetadata` (`line 99`).
3. **Estructura:**
   - La ficha representa **una ubicación concreta**: `item.location` (con su almacén `item.warehouse` y stock `item.quantity`). Es la que se muestra en la cabecera del cartón (`CartonLabel`, `lines 901-920`).
   - Sin embargo, en el cuerpo de la ficha (`lines 1035-1040`), bajo el título «Also», se renderiza `elsewhere` (`lines 238-243`, `720-743`): un listado de todas las otras ubicaciones donde el mismo SKU tiene stock > 0.
4. **Menú ⋯ superior (`ItemCardView.tsx:840-896`):**
   Es el menú general de la ficha. Contiene:
   `Print label`, `Change photo`, `Shelf note`, `Boxes`, `Rename SKU`, `Mark as S/D`, `Mark as PH`, `Full history`, `Delete`.

### (b) El momento exacto donde pedir un recount tiene sentido, y por qué ahí y no antes

Cuando un supervisor u operador está auditando la ficha técnica de un SKU (revisando dimensiones, fotos, códigos de barra o notas de estante) y detecta que la cantidad registrada para la ubicación que está viendo no cuadra.

### (c) Qué escribiría y cómo se elige la ubicación

- **Para la ubicación principal:**
  En el menú ⋯ superior (`ItemCardView.tsx:850`), se añade `Ask for recount` (o `Cancel recount request`).
  La ubicación está unívocamente fijada: es `item.location` (o `cur.location`).
  Invoca `request_recount(item.sku, warehouse, item.location, 'Asked from item card by ' + userName)`.
- **¿Qué pasa con las otras ubicaciones de «Also»?**
  Las filas bajo «Also» (`lines 721-742`) son hoy bloques planos de texto `<div>` sin interacción.
  Para mantener la interfaz limpia y rápida en F2, no se deben incrustar menús secundarios en cada fila de «Also». Si se requiere pedir recount para otra ubicación secundaria, el operador la busca en la pantalla de Stock y usa el ⋯ de esa tarjeta.

### (d) Conclusión

`ItemCardView` representa una ubicación principal y muestra las demás bajo «Also». El menú ⋯ superior debe pedir recount para la ubicación principal que se está visualizando; las ubicaciones secundarias de «Also» quedan sin botón en F2 para mantener la interfaz limpia.

### (e) ❓ Para Rafael (con default)

6. ❓ **¿`Ask for recount` en el ⋯ de la ficha del ítem pide recount solo para la ubicación activa de esa ficha?**  
   — **Default: Sí, únicamente para `item.location`.**

---

## 5. History (`HistoryScreen.tsx`, `ItemHistorySheet.tsx`)

### (a) Qué pasa hoy, paso a paso con `archivo:línea`

1. **En `HistoryScreen.tsx:1158-1262`:**
   Renderiza el feed de `InventoryLog`. Cada fila enseña la acción (`MOVE`, `ADD`, `DEDUCT`, `EDIT`), usuario, fecha, ubicaciones y cantidad.
   La única acción existente es el botón `Undo Action` (`lines 1226-1254`), restringido al registro LIFO más reciente de ese SKU dentro de una ventana de 48 horas, más la edición de notas de log (`LogNoteRow`, `line 132`).
   **Ninguna fila de log tiene menú ⋯.**
2. **En `ItemHistorySheet.tsx:208-270`:**
   Muestra el drawer de historial de un SKU. Es una vista puramente informativa y de solo lectura. No tiene menús ni botones de acción.

### (b) ¿Vale la pena?

**NO.** History es un libro contable de eventos ocurridos en el pasado. Un movimiento o edición de hace semanas no refleja el estado físico actual de la estantería. Si un auditor ve un movimiento sospechoso en el log, lo que debe hacer es revisar el stock vivo en la pantalla de Stock. Poner botones de recount en filas históricas mezclaría pasado con presente y sobrecargaría el renderizado de una lista de auditoría pesada.

### (c) Conclusión

Ninguna línea de log tiene menú hoy y no vale la pena añadirlo. History es un registro de auditoría histórica y pedir un recuento presente desde una transacción pasada confunde al personal y agrega ruido visual.

### (d) ❓ Para Rafael (con default)

7. ❓ **¿Confirmamos que History queda 100% fuera de Recount F2?**  
   — **Default: Sí, totalmente fuera.**

---

## 6. Mapa, Edit squares y Move

### (a) Qué pasa hoy, paso a paso con `archivo:línea`

1. **Warehouse Map (`src/features/warehouse-map/`):**
   Es un motor visual de pasillos, bahías y densidad de almacenamiento (reglas de `.claude/rules/warehouse-map.md`). Está orientado a planear espacios, ubicar pallets completos y analizar flujo de tráfico, no a auditar unidades sueltas de un SKU.
2. **Edit squares (`StockBoxEdit.tsx`, `SquareEditModal.tsx`):**
   Es el editor táctil donde el personal acomoda cajas entre cuadros (A, B, C...) y niveles (BASE, TOP, LINE PALLET).
3. **Move (`MoveModal.tsx`, `useInventoryMutations.ts:moveItem`):**
   Es el flujo explícito para trasladar unidades de una ubicación origen a un destino.

### (b) Conclusión corta de por qué sí o por qué no

- **Mapa: NO.** El mapa es para arquitectura espacial y planeación de piso, no para corrección puntual de existencias.
- **Edit squares: NO.** Quien está en Edit squares ya está mirando las cajas físicas y ajustando las cantidades directamente con los botones numéricos en ese mismo instante; pedir un recount para que alguien vaya después a contar lo que el usuario ya está contando y guardando es redundante.
- **Move: NO.** Si el usuario va a mover cajas y nota que faltan en el origen, mueve solo las que hay o ajusta la cantidad con los botones `+ / −` de la tarjeta de Stock.

### (c) ❓ Para Rafael (con default)

8. ❓ **¿Confirmamos que Mapa, Edit squares y Move quedan fuera de F2?**  
   — **Default: Sí, los tres quedan fuera.**

---

## 7. Quién ve el pedido y cuándo (`v_recount_requests_open` y órdenes abiertas)

### (a) Qué pasa hoy, paso a paso con `archivo:línea`

1. **La vista de base de datos (`supabase/migrations/20261009112156_recount_requests.sql:80-92`):**
   `v_recount_requests_open` calcula la columna `held_by_orders`: cuenta cuántas órdenes abiertas (`active`, `ready_to_double_check`, `double_checking`, `needs_correction`) tienen unidades de ese SKU en esa ubicación con `pickingQty > 0`.
2. **El hook de React (`src/hooks/useOpenRecounts.ts:28-42`):**
   - `recounts = allOpen.filter((r) => !r.held_by_orders)`: Descarta cualquier petición cuyo `held_by_orders > 0`.
   - `openRecountsBySkuLocation`: Solo expone peticiones contables de inmediato.
   - `allOpenBySkuLocation`: Contiene el universo completo de peticiones abiertas (con o sin órdenes).
3. **En la tarjeta de Stock (`InventoryCard.tsx:240-258`):**
   La pastilla ámbar `Needs recount` solo se muestra si `hasRecount` es verdadero (que depende de `openRecountsBySkuLocation`).
4. **La regla de negocio (Rafael, 9 oct 2026):**
   _«con el SKU en una orden abierta debería no mostrar la alerta y filtrar para que solo se pida recount de los que se pueden contar en ese momento»_.
5. **El conflicto de experiencia de usuario al pedirlo:**
   Si un usuario está en Stock, abre el ⋯ de un SKU y pulsa `Ask for recount`, pero ese SKU está reservado en una orden abierta (ej. #881900):
   - La fila se inserta en `recount_requests` con `status = 'open'`.
   - Las consultas se invalidan.
   - Como `held_by_orders = 1`, `useOpenRecounts` la filtra de `recounts`.
   - En la tarjeta **NO aparece `Needs recount`**.
   - Si el menú solo consulta `openRecountsBySkuLocation`, seguirá mostrando `Ask for recount`.
   - **El usuario pensará que la app ignoró su clic o falló.**

### (b) Solución y qué debe ver

1. **Al pulsar `Ask for recount`:**
   El frontend consulta si la ubicación tiene unidades en órdenes abiertas (`held_by_orders > 0` o `units_held_by_open_orders`).
   Si tiene órdenes abiertas, el toast no debe decir simplemente "Recount requested", sino:
   `Recount requested · Waiting for Order #881900 to ship`
2. **En el menú ⋯:**
   El menú debe consultar `allOpenBySkuLocation` (todas las abiertas). Si hay una petición abierta retenida por órdenes, el menú muestra:
   `Cancel recount request (waiting for Order #881900)`
   Esto confirma visualmente que la petición fue aceptada y evita peticiones duplicadas.
3. **En la tarjeta de Stock:**
   Se mantiene oculta la pastilla ámbar de conteo inmediato `Needs recount`, cumpliendo estrictamente la instrucción de Rafael de no mandar a contar estantes cuando hay unidades en carritos de picking.

### (c) Conclusión

Si un SKU está en una orden abierta, la petición existe pero la app oculta la marca `Needs recount` para no mandar a contar un estante con cajas en carritos; por ello, la app debe informar de inmediato en el toast y en el menú ⋯ que la petición está en espera de que la orden abierta salga.

### (d) ❓ Para Rafael (con default)

9. ❓ **¿El toast al solicitar recount sobre un SKU retenido debe nombrar la orden específica que lo retiene?**  
   — **Default: Sí, ej. `Recount requested · Waiting for Order #881900 to ship`.**

---

## 8. El modo pistola (F3)

### (a) Confirmación de alcance

1. En `docs/prds/recount-suggestions.md:65-73` y `134-136` se definió la arquitectura de fases:
   - **F1 (Prod):** La cola `recount_requests`, el trigger, la función `submit_recount`, la pregunta ciega en Double Check, la marca `Needs recount` en Stock y el conteo ciego manual tecleando.
   - **F2 (Esta fase):** Dónde y cómo se **PIDE** un recount (Edit Order por faltante, ⋯ de Stock, ⋯ de Item Detail, cancelación de peticiones).
   - **F3 (Siguiente fase):** Modo pistola (Zebra ET401 con DataWedge: disparo = +1 caja con sonido/vibración, botón −1 para desarmar, y aprendizaje de UPCs desconocidos en piso preguntando _«Which SKU is this?»_).
2. **Independencia técnica:**
   Pedir un recount (`request_recount`) es una inserción en la base de datos disparada desde botones de UI o eventos de edición de órdenes. No tiene ninguna interacción con la lectura de códigos de barras, el buffer de teclado de la Zebra ni la resolución de UPCs.

### (b) Conclusión

El modo pistola con la Zebra ET401 es un método de conteo y no tiene ninguna relación con las puertas de entrada para pedir recounts. Queda 100% en F3.

### (c) ❓ Para Rafael (con default)

10. ❓ **¿Confirmamos que el modo pistola se mantiene en F3 y no entra en F2?**  
    — **Default: Sí, F3.**

---

## 9. Lista consolidada de ❓ para Rafael con defaults

| #      | Pregunta                                                                                                                                                                                                                                         | Default propuesto                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | Cuando un picker remueve o reduce una línea por "Out of stock": ¿la app solo abre `request_recount` dejando la cantidad del sistema hasta que alguien cuente a ciegas, o pone la cantidad en 0 de inmediato en esa ubicación avisando al picker? | **Solo abrir `request_recount` y dejar la cantidad.** Quien haga el recount ciego pondrá el número real del estante sin inventar ceros.                                                      |
| **2**  | ¿Qué razones de `ReasonPicker` disparan recount automático?                                                                                                                                                                                      | **Solo las de faltante físico:** `Out of stock`, `Partial stock only`, `Damaged units`, `Count correction`, `Out of stock — replacing`. Razones de cliente o transcripción no abren recount. |
| **3**  | Si salta «How many are left here?» y el picker no tiene las unidades completas para su orden, ¿agregamos un botón en `RecountSheet` que diga «Short stock / Edit order» que cierre el modal y abra directamente Edit Order?                      | **No en F2; el botón `Skip` actual es suficiente.** El picker salta la pregunta y va a Edit Order como hace con cualquier orden incompleta.                                                  |
| **4**  | Al pulsar `Ask for recount` en el ⋯ de Stock, ¿se genera inmediatamente la petición con 1 toque (motivo automático con el nombre del usuario), o debe abrir un modal para escribir una nota opcional?                                            | **1 toque inmediato sin modal.** El motivo se genera automáticamente (`Asked from stock card by <Nombre>`).                                                                                  |
| **5**  | ¿Se crea la RPC `cancel_recount(p_id uuid)` que permita cancelar sólo al autor o a un admin?                                                                                                                                                     | **Sí, RPC con validación estricta (`auth.uid() = requested_by OR public.is_admin()`).**                                                                                                      |
| **6**  | ¿`Ask for recount` en el ⋯ de la ficha del ítem pide recount solo para la ubicación activa de esa ficha?                                                                                                                                         | **Sí, únicamente para `item.location`.**                                                                                                                                                     |
| **7**  | ¿Confirmamos que History queda 100% fuera de Recount F2?                                                                                                                                                                                         | **Sí, totalmente fuera.**                                                                                                                                                                    |
| **8**  | ¿Confirmamos que Mapa, Edit squares y Move quedan fuera de F2?                                                                                                                                                                                   | **Sí, los tres quedan fuera.**                                                                                                                                                               |
| **9**  | ¿El toast al solicitar recount sobre un SKU retenido por órdenes abiertas debe nombrar la orden específica que lo retiene?                                                                                                                       | **Sí, ej. `Recount requested · Waiting for Order #881900 to ship`.**                                                                                                                         |
| **10** | ¿Confirmamos que el modo pistola se mantiene en F3 y no entra en F2?                                                                                                                                                                             | **Sí, F3.**                                                                                                                                                                                  |

---

## 10. Propuesta de alcance: Qué entra en F2 y qué no

### Entra en F2:

1. **Edit Order / StockIssuePanel automático:**
   - En `handleCorrectItem` (`PickingCartDrawer.tsx`), invocar `request_recount` cuando se reduzca cantidad o elimine línea con razones de faltante (`Partial stock only`, `Out of stock`, `Damaged units`, `Count correction`, `Out of stock — replacing`).
2. **⋯ de la tarjeta de Stock (`DistributionMenu`):**
   - Corregir el paso de `location` en `InventoryCard.tsx:412` (`location={item?.location || location}`).
   - Añadir opción `Ask for recount` con motivo automático.
   - Mutar a `Cancel recount request` cuando ya exista una petición abierta (evaluando `allOpenBySkuLocation`).
   - Restringir la cancelación al creador o administradores.
3. **RPC `cancel_recount` en base de datos:**
   - Función PostgreSQL con `SECURITY DEFINER` para permitir cerrar peticiones abiertas al autor o admin.
4. **⋯ de la ficha del ítem (`ItemCardView`):**
   - Añadir `Ask for recount` / `Cancel recount request` en el menú superior para la ubicación activa de la ficha (`item.location`).
5. **Feedback de órdenes abiertas (UX de retención):**
   - Toast diferenciado al pedir recount si el SKU está retenido: `Recount requested · Waiting for Order #N to ship`.
   - Menú ⋯ mostrando el estado de espera cuando aplique.

### Queda fuera de F2:

- **History:** No se añaden opciones de recount en logs históricos.
- **Mapa, Edit squares y Move:** No se añaden opciones de recount (el mapa es espacial y los otros dos editan cantidades directamente).
- **Modo pistola:** Pasa a F3 (escaneo con Zebra ET401, +1 por caja, sonido/vibración y aprendizaje de UPCs).

---

## 11. Lo que no verifiqué

1. **Escrituras reales en la base de datos de producción:** Este estudio se realizó bajo estricto modo de solo lectura. No se ejecutaron mutaciones ni se crearon peticiones de prueba en producción.
2. **Comportamiento del daemon `watchdog-pickd`:** El daemon corre en la MacBook externa de Bay 2 (`com.antigravity.watchdog-pickd`). Se revisaron los contratos y RPCs en el repositorio de PickD, pero no se inspeccionó la ejecución en vivo del daemon externo.
3. **Frecuencia de uso real entre Edit Order vs StockIssuePanel:** No se consultaron métricas de telemetría para medir con qué frecuencia los pickers usan el panel inline (`StockIssuePanel`) frente a la pantalla completa de Edit Order (`CorrectionModeView`); no obstante, ambos caminos convergen en la misma función `handleCorrectItem`.
