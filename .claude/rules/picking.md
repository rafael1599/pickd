---
paths:
  - 'src/features/picking/**'
  - 'src/features/orders/**'
  - 'src/utils/pickLocation.ts'
  - 'src/utils/pickingOrder.ts'
---

# Picking, Double Check, Verification Board y Edit Order

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

**Cancelar: de dónde salieron las unidades no es a dónde vuelven (idea-174, 1 sep 2026).** Una orden
**sin completar** que se cancela devuelve cada línea a **su propia ubicación** — lo hace el trigger
`compensate_picking_list_changes` (`system: cancel-restore`) y está bien: nadie movió esas bicis. Una
orden **completada** que se cancela las manda al **`CANCELLED PALLET`** (`LUDLOW`, `picking_order`
420 — en el área de envío, tras ROW 43 y antes de ROW 44; `counts_as_storage = false`,
`is_shipping_area = true`, `pick_priority = 'first'`): al completarse ya salieron del estante
y están en un pallet del área de envío, así que devolverlas a ROW 8 sería afirmar stock que no está
ahí. **Hasta el 17 sep 2026 ese sitio era `RETURN TO STOCK`**, que desde entonces significa lo
contrario — ver más abajo. `cancel_completed_order` (`20260901123958`) **reproduce en
reversa los DEDUCT que la lista escribió de verdad** en `inventory_logs` — saltando los de
`system: auto-zero out-of-stock`, que significan "el estante estaba vacío"— y marca cada uno
`is_reversed`; por eso correrlo dos veces no duplica y el History los pinta como deshechos. **No lee
`items`**: 658 de 1746 órdenes completadas no dedujeron nada (todas sus líneas eran
`insufficient_stock` con `location: null`) y recorrer el array ahí inventaría stock. Antes leía la
bandera `picked`, que murió con el toggle de pick en mayo de 2026 — **la restauración nunca corrió**:
cero logs `system: order-deleted` en toda la base, y #881310 devolvía 0 de 19 unidades. Una orden ya
marcada como enviada no se bloquea ni se cancela sola: la RPC devuelve `requires_unship` sin escribir
nada y Ship pregunta **"¿nunca se llegó a enviar?"** — al confirmar (`p_unship`) desmarca el envío y
sigue el flujo normal. La nota va a `picking_list_notes` con el tag `[Cancelled]:`, nunca al campo
`notes` (que es la nota de AS400 que se imprime).

**Una combinada se cancela entera: descombinar y cancelar una por una (17 sep 2026).** La tarjeta
combinada de Ship es un pseudo-pedido — `combineGeneralGroupSiblings` suma pallets, unidades e items
de todos los miembros pero hereda el `id` del **ancla** (el más viejo por `created_at`)—, así que
`handleDeleteOrder` cancelaba solo esa: la tarjeta decía 8 unidades y volvían 3, y los hermanos se
quedaban `completed` afirmando stock que ya no estaba en el estante (881415/881373/881347 y
881416/881348, 8 bicis de JAX). `cancel_combined_order(group_id, user, unship)`
(`20260917153247`) lo hace en **una** transacción, no en un bucle del cliente —a mitad de un bucle
que falla quedan dos canceladas y una viva, que es el estado que vino a arreglar—: pregunta una vez
por el envío del grupo entero (si alguna salió y nadie lo desmiente no escribe **nada**), guarda
quién lo formaba en **`cancelled_order_groups`** (append-only; el grupo se borra al cancelar y la FK
es `ON DELETE SET NULL`, así que sin esa fila el undo no tiene a quién volver a juntar), descombina
y cancela miembro a miembro. **Y un descombinado hecho para cancelar no reclasifica el envío de
nadie**: `reevaluate_shipping_type_on_ungroup` se salta con
`set_config('pickd.ungroup_reason','cancel',true)` —el trigger existe para los que siguen vivos, y
al cancelar el grupo entero no queda nadie—; sin la guarda dejaba a las cuatro órdenes en `fedex`
por un efecto colateral. Ese mismo trigger, que es BEFORE y escribe sobre **otras** filas del grupo,
hacía reventar la limpieza de `cancel_completed_order` con **27000 · tuple to be updated was already
modified** en cuanto el `UPDATE ... SET group_id = NULL` tocaba más de una fila (o sea, en el
segundo miembro de todo grupo que ya tenía una cancelada): ahora esa limpieza va fila por fila.

**Y lo que está en el pallet de canceladas se recoge antes que cualquier estante** (Rafael, 1 sep
2026, cuando ese pallet aún se llamaba RETURN TO STOCK: "cualquier orden nueva quiero que prefiera
items que están en return to stock por encima de los otros"). Esas unidades están sueltas en el piso
y le deben un viaje a alguien: la siguiente orden que necesite el SKU **es** ese viaje, y mandar al
picker a una fila llena solo hace crecer el montón. Vive en `isFirstChoice` / `byPickPreference`
(`utils/pickLocation.ts`), así que lo heredan la ruta (`rebaseToActualStock`), Double Check, el
diagnóstico de stock y los hermanos de variante; `planPickAcrossLocations` lo saca **antes** del
atajo de una sola parada, o un estante que cubriera la línea entero dejaría el piso intacto (por eso
una línea puede partirse entre el pallet y la fila

- la fila). **El espejo ya no existe** (10 sep 2026): el watchdog dejó de asignar ubicación, así que
  `_is_return_to_stock` y su ranking PALLET > LINE > TOWER se borraron de `supabase_client.py`. La
  línea llega con `location: None` y esta es la única implementación. **Un push al watchdog es su deploy**
  (`auto_update.py`, 8 sep 2026: Bay 2 sondea `origin` cada 5 min y corre `update.sh` cuando es
  seguro), así que llega solo — pero el heartbeat dice qué build corre de verdad
  (`as400_watcher_heartbeat.version`), y **conviene mirarlo**: si se atasca, sigue mandando ubicación y
  PickD la replanifica igual, así que ningún despliegue depende del otro.

**Dentro de una fila se recoge de la última letra a la A (Rafael, 18 sep 2026).** Una sola regla,
`pickSquare` (`utils/pickingLogic.ts`: la letra más alta de la línea), la usan el recorrido
(`getOptimizedPickingPath`), `sortByLocation` y la letra que pinta Double Check. Hasta el 29 sep sólo
la letra pintada la seguía y las líneas de una misma ROW salían de A a Z.

**PickD decide de dónde sale el pick, al tomar la orden (10 sep 2026).** `planPickForList`
(`utils/planPick.ts`, llamado desde el `lockForCheck` de `PickingCartDrawer`) replanifica contra el
stock vivo en el momento en que alguien abre la orden para trabajarla — que es el «start picking» real
de PickD. Antes no lo hacía **nadie**: `rebaseToActualStock` vive dentro de `markAsReady`, y
`markAsReady` solo se alcanza desde `active`/`needs_correction`, mientras que las órdenes del AS400
nacen en `ready_to_double_check`. Nunca corría ni una vez. Lo único que vigilaba era
`useStaleLocationCheck`, que es un **guardia de deriva**, no un planificador: solo habla cuando el
estante congelado ya no cubre el pedido (21 notas `[AUTO]` desde junio). El caso que no puede ver es el
estante que sí cubre mientras hay unidades en RETURN TO STOCK — la bici de #881394.

Los dos contratos están separados a propósito con la opción **`claimReturnsFloor`**: el guardia calla
ante un arreglo que se sostiene; el planificador lo rehace si está pasando de largo por el piso. Y el
planificador hace dos cosas más que un rebase pelado: descuenta lo que **otras** órdenes abiertas ya
tienen apartado (si no, manda a dos personas a la misma bici) y planifica los hermanos de una
combinada **por turnos**, consumiendo cada uno lo que toma. Calla ante una orden `reopened`,
completada o waiting, y solo escribe si una dirección se movió de verdad — un write vuelve por
realtime a todos los carritos abiertos. **Una orden con líneas marcadas ya no se congela (3 oct
2026):** se callaba entera, y las tarjetas seguían mandando al estante vaciado mientras un aviso
«Moved since this order was built» decía ir a otro (Rafael: «dice que ahora está en la 42 pero me
sigue mandando a la 14, no tiene sentido»). Ahora una línea marcada no se toca —esa bici ya está en la
tarima— pero sigue apartando su unidad, y una sin marcar sólo se re-dirige si su estante **ya no la
cubre** (`planListsInTurn` con `isHeld` y `claimReturnsFloor: false`): a quien va a mitad no se le
mueve una dirección buena, ni al pallet de canceladas. El aviso y la nota `[AUTO] Stale pick
location` se retiraron: `useStaleLocationCheck` sólo despierta al planificador desde Double Check,
que escribe la dirección nueva en la línea —donde mira el picker—, y **en vivo** (5 oct 2026, «que sea en vivo»): escucha `inventory` por realtime y, si cambia una fila de un SKU de la orden, vuelve a mirar a los 800 ms, así que una bici movida con la orden abierta cambia su tarjeta sin recargar. Una línea **sin** dirección ya no se salta:
está **sin planificar** — y eso es lo que dejó al watchdog soltar la ubicación el mismo día
(`462b94b` allá). De su intake solo queda transcripción y resolución de SKU.

`building` mode fue eliminado (idea-032). `OrderBuilderMode.tsx`, `PickingSessionView.tsx`, y `returnToBuilding()` fueron eliminados. Edit Order mode (CorrectionModeView) reemplaza sus funciones. InventoryCards muestran +/- inline en picking mode.

**Correcciones con razón (idea-043):** Todas las acciones de corrección (remove, swap, adjust_qty, add) requieren una razón via `ReasonPicker`. Las notas se generan con formato rico: "Removed SKU: Out of stock" en vez de genérico. `CorrectionAction` tiene campo `reason?: string`. Si el item tiene `insufficient_stock`, la razón "Out of stock" se pre-selecciona.

**Edit Order en una combinada: una pestaña por orden (Rafael, 11 sep 2026).** `ALL · #881514 · #881513`,
cada una con sus líneas y un punto ámbar si tiene problemas; la pestaña filtra la lista y el resumen.
Replace, Adjust y Remove van **a la orden de la línea**, sin preguntar ("para no ponerle muchas trabas
al usuario, solo las justas"); Add es lo único que pregunta: viene preseleccionada la pestaña abierta
y desde ALL hay que elegir. La orden de una línea sale de **la línea** (`rowOfLine`,
`utils/editOrderTargets.ts`), nunca del SKU: se buscaba con `allItems.find(sku)` y en los 25 grupos
de seis meses con un SKU en dos órdenes la corrección caía en la primera. Por eso cada panel lleva su
`rowId`.

**Órdenes stuck en reopened:** Si una orden queda en `reopened` (browser cerrado, sesión perdida), OrderSidebar muestra "Continue Editing" (mismo usuario) o "Take Over & Edit" (otro usuario). `resumeReopenedOrder` carga sin llamar al RPC reopen de nuevo.

**Lo que dice «esta orden ya salió del estante» es el `completed_snapshot`, no el estado (17 sep
2026).** Reabrir guarda el snapshot; **`recomplete_picking_list` (el camino de delta) lo borra al
terminar y `process_picking_list` (el normal) ni lo mira**, así que una orden `completed` que
todavía lo conserva se descontó **dos veces**. `process_picking_list` se niega ante `reopened`, pero
solo mira el estado — y el estado lo cambia cualquiera: `markAsReady` arrastraba a las hermanas del
grupo a `double_checking` excluyendo `completed` y `cancelled` pero no `reopened`. Medido en prod: 10
órdenes con snapshot vivo, 7 con descuento de más, **35 unidades**; tres el mismo 17 sep (#881373,
#881488, #881612). La consulta `status='completed' and completed_snapshot is not null` es el único
detector limpio y sirve de prueba después de cualquier arreglo. **Desde `20260926215927` (bug-036) la
base lo impide**: `protect_reopened_snapshot` sólo deja salir de `reopened` con snapshot a `completed`
vaciándolo o a `cancelled`, y devuelve a `reopened` cualquier otro cambio de estado. Las otras trampas del libro de
inventario —`is_reversed` no significa «se devolvió», `updated_at` no marca toda escritura, el
«efecto neto» solo sirve filtrado— están en **`docs/inventory-ledger-traps.md`**.

**Combinar una completada con una abierta = el flujo Add-On, y `reopened` es su estado obligatorio
(bug-025, 9 sep 2026).** `complete_addon_group` **rechaza** cualquier fuente que no esté en `reopened`
("Source order % must be reopened") y exige el destino en un estado abierto: recompleta la fuente por
delta contra `completed_snapshot`, completa el destino y disuelve el grupo, todo en una transacción.
Por eso `canMerge` (DoubleCheckView) **tiene que incluir `reopened`** — sin él, Combine desaparecía
justo en el único estado que la RPC acepta y reabrir para combinar terminaba en un menú sin salida.
Camino completo: completada → Reopen (con razón) → Combine → Re-Complete. Al revés (estando en la
abierta) también sirve: `AddOnTargetPickerModal` reabre la completada por ti.

**Long-Waiting Orders (idea-053):** Órdenes que esperan inventario (días, semanas, meses) viven en `needs_correction` con `is_waiting_inventory = true`. Admin marca/desmarca via RPCs `mark_picking_list_waiting` / `unmark_picking_list_waiting`. Verification queue las oculta por defecto (toggle "Waiting for Inventory"). Cross-customer SKU conflicts se detectan al abrir DoubleCheckView (`useWaitingConflicts`) y se resuelven via `take_over_sku_from_waiting` RPC o editando la orden. La rama `auto_cancel_stale_orders` verification 24h fue **eliminada** (era conceptualmente equivocada, bug-017). El cómputo de reservas client-side (`usePickingActions.ts`) ya itera `needs_correction`, así que waiting orders son respetadas automáticamente.

**Progreso de verificación (`verified_item_keys`, 25 ago 2026):** el Set `checkedItems` vive en
`PickingCartDrawer` y se persiste con debounce en `picking_lists.verified_item_keys`. **Solo se escriben
los cambios hechos en este dispositivo** (`dirtyListIdRef`): una hidratación desde la DB entra en el
mismo Set, y espejarla de vuelta era el bug — al reabrir, el Set vacío previo a hidratar se agendaba
para escribir, el cleanup del efecto lo flusheaba en cuanto volvía la primera lectura, la segunda
lectura (tras `lockForCheck`) leía ese `[]` como verdad y una orden parkeada volvía sin ningún check.
Dos cosas siguen siendo a propósito y no son este bug: la **X** (`parkOrder`) conserva las llaves, y
**Ready to DC** (`releaseCheck` → `ready_to_double_check`) las **vacía** — es un flujo posterior al
recogido que no toca inventario ni la barra de avance.

**Y la bandera es del GRUPO, no de la orden (9 sep 2026):** `flushVerifiedItems` escribe el mismo Set
fusionado en **todos** los miembros (`.eq('group_id', …)`). Así que `verified_item_keys` vacío **no**
significa "sin verificar": significa "esta fila no estaba en el grupo durante el último flush". Es
exactamente lo que delató a #881394 (0 llaves con dos hermanas en 6, bug-023), pero no sirve como
señal per-order — para "¿alguien tocó esto?" la señal es `checked_by`. **Pero sólo en una orden
abierta** (bug-035, 26 sep 2026): en una completada es la firma de quien la verificó —`process_picking_list`
la estampa y nadie la borra; la leen Activity Report, Ship, Orders y la página pública—, y en una
`reopened` sigue siendo esa firma. Preguntar por candados sin mirar el estado dejaba en solo lectura a
la compañera abierta de una completada por otro; la regla vive en `utils/siblingLock.ts`.

**La barra de avance es una sola lectura (`utils/verificationProgress.ts`, 11 sep 2026).** La usan
las tarjetas del board —normal, combinada y la del grupo FedEx (`VerificationBar`)— y
`OrderProgressBar` en Ship y Orders. **`FedexGroupCard`
no tenía barra**, y los grupos FedEx son casi todo lo que se verifica en un día: mientras el picker
marcaba, el board decía «Checking» y nada más (Rafael: «la barra de avance no se está viendo a medida
que el picker selecciona los items en dcv»). Es **una barra por grupo**, porque Double Check verifica
el grupo como un carrito y escribe las mismas llaves en todos los miembros. Una llave cuenta por su
cola `-sku-location`, **una vez** (el número de pallet es del carrito, no de la tarjeta), y una llave
`…-null` cuenta para una línea de su SKU: la línea se marcó antes de tener dirección y Double Check
escribió después la que resolvió (bug-026) — #881529 se quedaba en 62 % terminada.

**Y las marcas se guardan también al abrir para recoger, no solo para verificar.** Una orden
`active` (manual, New Order) o `needs_correction` se carga en modo `picking`, y ahí se marcan las
líneas igual; `PickingCartDrawer` solo guardaba y recuperaba `verified_item_keys` en
`double_checking`, así que esas marcas vivían en el teléfono, se perdían al cerrar y el board las
leía como 0 (#TEST, 11 sep: 3/7 en el teléfono, nada en el board). Ahora lo decide
`keepsVerificationProgress` para las dos. Sigue valiendo 0 una orden `ready_to_double_check` (Ready to
DC le vacía las llaves), y un grupo `active` lee las de sus miembros abiertos, nunca las que guardó
uno completado (`mergeGroupOrders`).

**Pulsación larga en DoubleCheckView = "¿dónde está de verdad?"**: abre `sku-locations` (Modal Manager,
`SkuLocationsModal`) con **todas** las filas de inventario del SKU, la dirección de la orden primero y
marcada, y un botón Editar por fila que abre `item-detail` sobre esa fila concreta. Antes abría el
detalle de la fila con más stock: con `03-4066BK` en ROW 6 A (4) y ROW 41 F (78) la tarjeta decía ROW 6
y el detalle ROW 41, y el picker leía que la tarjeta mentía. Ver no lleva a un formulario; editar es un
segundo toque deliberado. **Si el SKU no existe, el mismo modal pregunta Bici o Parte** y elegir ya es
registrar: `buildNewSkuPrefill` (`src/features/inventory/utils/newSkuPrefill.ts`) abre `item-detail` con
nombre, modelo/talla/color partidos de la descripción AS400 (`parseBikeName`, sin el año — el catálogo
nombra "Modelo Talla Color"), tipo y los defaults de peso y caja; al operador le quedan ubicación y
cantidad. Un nombre de bici que no parte no va a `model` (sería la basura legacy de `bug-018`).

**LOW STOCK / UNREG se diagnostican y resuelven en Double Check, no en Edit Order (26 ago 2026):**
`diagnoseStockIssue` (`src/features/picking/utils/stockIssue.ts`, puro, con tests) convierte lo que
la vista ya carga (filas de inventario del SKU, reservas de otras órdenes abiertas, la familia de
hermanos de variante, el SKU parecido) en **un caso con nombre**: `auto_swap` (el hermano cubre la
línea → se intercambia solo, toast + **Undo**, misma regla que tenía el tier 1 de Edit Order),
`unregistered`, `no_stock`, `reserved` (dice qué órdenes lo tienen) y `partial` (dice cuánto hay y
dónde). `StockIssuePanel` lo pinta bajo la tarjeta con la frase exacta y **solo las acciones que
tienen sentido para ese caso y esa línea**: Take N, Use X, Register (misma modal que el long-press),
Replace (abre Edit Order ya en el buscador de esa línea, `initialPanel`) y Remove. Todo pasa por
`onCorrectItem` con razón (`ReasonPicker` inline, idea-043), así que las notas quedan igual que
desde Edit Order; el panel para eventos para que la tarjeta no marque el check. El tier 1 de
`CorrectionModeView` sigue existiendo por si alguien entra directo, pero ya no debería encontrar
nada. `fetchDistributions` guarda ahora `location`/`warehouse` por fila, que es lo que alimenta el
diagnóstico sin otra consulta.

**Verification Board (idea-055):** La Verification Queue es un overlay full-screen con zonas: Priority (auto-populated por status), FedEx/Regular lanes (`shipping_type`, que se cambia desde la tarjeta), In Progress Projects (read-only), Recently Completed, Waiting (colapsable). Auto-clasificación: **≥5 BIKES → Regular, else → FedEx**; las partes nunca fuerzan Regular (50 partes = FedEx). **El peso no decide** (Rafael, 11 sep 2026: «FedEx puede llevar cualquier peso»): hasta el 11 sep un artículo de >50 lb mandaba la orden a camión, contestando a un límite que FedEx no tiene — desde agosto puso 19 órdenes en camión por nada. Lo que queda es de volumen: 5 bicis son un pallet. Con la regla se fue el parámetro `skuWeights` de `autoClassifyShippingType`/`isFedexOrder`, porque un argumento que ya no decide nada es una mentira (y varios sitios ya le pasaban `{}`). Regla duplicada en DB (`classify_picking_list_fedex`) — mantener ambas en sync. La regla de bikes depende de `sku_metadata.is_bike`, que el item no trae por sí solo: el trigger `a_stamp_item_sku_metadata` (migración `20260820150000`) lo sella dentro de cada elemento de `picking_lists.items` en cada write, así que **todo consumidor lee la misma verdad sin buscarla**. Antes cada pantalla traía su propio lookup y pasarlo era opcional — DoubleCheckView no lo pasaba y pintaba de FedEx órdenes de 13 bicis. El parámetro `bikeSkus` de `autoClassifyShippingType`/`isFedexOrder` es ahora **obligatorio** (pasar un Set vacío para renunciar a él a propósito): cubre el ítem que aún no se ha escrito y el SKU cuyo `is_bike` cambió después del sellado. `shipping_type` columna en `picking_lists` (NULL = auto). **El board ya no se arrastra** (se retiró en julio de 2026): `useBoardDnD.ts` y `board/DroppableZone.tsx` no los importa nadie y se borran en el cierre de la unificación. Componentes en `src/features/picking/components/board/`.

**Un grupo que alguien tiene en las manos no recibe órdenes nuevas (bug-023, 9 sep 2026).** El
auto-agrupado FedEx (`auto_group_fedex_orders`, BEFORE INSERT) pega toda orden FedEx nueva al grupo
FedEx abierto más viejo — **sin mirar cliente**. Antes solo excluía `completed`/`cancelled`/`reopened`,
así que enganchaba órdenes a un grupo que alguien estaba verificando y el lote de completado se las
llevaba sin que nadie las viera (#881394: creada 18:11:48, completada 18:11:54, cero líneas
verificadas). Ahora consulta **`group_is_held(group_id)`** (`20260909233836`), que es la fuente única
de la regla: algún miembro con `checked_by`, en `double_checking`, o con progreso de verificación. Lo
que rechaza nace sin grupo y se combina a mano con Combine. **El espejo del watchdog ya no existe** (9 sep
2026): su auto-combine por cliente en 24 h se quitó entero en vez de guardarlo — decidir que dos
órdenes son un envío es una decisión de negocio y la toma una persona con Combine. Del código solo
sobrevive `STOCK_HOLDING_STATUSES` (antes `COMBINABLE_STATUSES`), que es el planificador de
ubicaciones. **El watchdog se despliega solo con el push** (`auto_update.py`); para saber qué build corre de verdad, `select version from as400_watcher_heartbeat` — el valor se sella al arrancar el proceso, así que si no se mueve es que no se ha reiniciado. Segunda capa en el
cliente: el lote de `PickingCartDrawer` completa **lo que el carrito tenía cargado** (`source_list_id`
por línea), no lo que comparta `group_id` en ese instante (`utils/groupSweep.ts`).

**Y el movimiento inverso (`20260910003817`):** cuando una orden nueva lleva al cliente a ≥5 bicis, el
mismo trigger reclasifica sus órdenes FedEx abiertas a REGULAR. Las dos mitades de ese `UPDATE` no
valen lo mismo: el `shipping_type` **se aplica siempre** (es cómo se envía; si se saltara, media orden
iría por FedEx y su hermana en camión), pero vaciar el `group_id` es limpieza y **espera** a que nadie
sostenga el grupo — antes le partía la tarjeta combinada al picker a mitad de verificación. Un grupo
tomado queda `regular` con su `group_id` intacto.
**Desde `20260926150613` la cuenta es de todas sus bicis, y corre siempre**: antes salía sin revisar
al cliente si la orden nueva ya era regular, y sólo sumaba sus órdenes FedEx — WILMETTE (#881735 2,
#881644 53, #881645 1, 25 sep) acabó en tres envíos con las dos chicas en un grupo FedEx. Ahora suma
todas las abiertas del cliente **en la misma dirección** (`ship_to_address_id`, la trae el 98 %). No
combina las regulares: eso sigue siendo Combine en Ship.

**Qué miembro representa una tarjeta combinada:** `mergeGroupOrders` ancla en `groupOrders[0]`, por
posición, y un grupo `general` fusiona a través de la frontera activo/completado — así que el ancla es
con frecuencia el miembro completado, y abrirlo era un callejón (DoubleCheckView carga, lee
`completed` y el drawer se cierra solo). `openableGroupMemberId` decide sobre las **filas crudas**: el
board estampa el status agregado del grupo sobre cada miembro, así que una fila completada llega a un
carril leyendo `ready_to_double_check` y su propio `status` no sirve para distinguirla (bug-024).

**Lo que Double Check resuelve con el stock vivo se escribe fila por fila (bug-026, 11 sep 2026).** La
vista persiste tres cosas de una línea —dirección si no tiene, LOW STOCK que el stock ya cubre, UNREG
registrado a media sesión— porque `process_picking_list` **salta en silencio** toda línea con
`insufficient_stock`: si la fila no se entera, la orden sale sin descontar. La escritura lee **cada
fila de la DB y resuelve sus propias líneas** (`utils/liveResolution.ts`), solo en
`PLANNABLE_STATUSES`, y completar espera a que termine. Escribía el carrito en `activeListId`, y un
carrito combinado son las líneas de todas las hermanas: la ancla se las quedaba y las descontaba
(#881393 el 9 sep —dos bicis salieron dos veces de ROW 10—, #881513 el 11 sep), y sin llaves de lo ya
escrito cada eco realtime volvía a escribir (120 PATCH en 62 s).

**Cada marca y cada edición de tarima quedan con su hora (`pallet_events`, 3 oct 2026, F0 de
idea-245).** `verified_item_keys` es un conjunto sin hora que se fusiona entre teléfonos y que Ready
to DC vacía, así que el orden en que el picker marcó —que es el orden en que las cajas subieron a la
tarima (Rafael: «se marca cuando se recoge y sube sobre la tarima… ese orden manda»)— no quedaba en
ningún sitio. Ahora `PickingCartDrawer` escribe un evento por marca y desmarca (`phase = 'pick'`
antes de Ready to DC, `'check'` después: lo de quien verifica no mueve ninguna caja; Select all y
Clear van con `payload.bulk`) y `usePalletDims` uno por cada campo de contenido que guarda en una
tarima (`items`, `bikes`, `split`, `parts`, comparado con la fila justo antes; la cinta no cuenta).
Append-only, escribe el propio usuario y lee admin; el envío, el grupo y el usuario los sella el
trigger desde `list_id`. **Nadie los lee todavía**: los leerá `palletTimeline` en F1
(`docs/prds/pallet-box-inference.md`, §6.3.8: cómo se leen). Insertar nunca lanza ni espera
(`api/palletEvents.ts`); sin señal los eventos esperan en `localStorage` y salen al volver. Marcar o
desmarcar se decide contra el conjunto vivo (`checkedItemsRef`), no contra el render: dos toques
rápidos guardaban dos marcas. **Return to picker borra `sent_to_dc_at`/`sent_to_dc_by`**: el picker
vuelve a pulsar Ready to DC, y el board, ya enviada, dice **«Picked by Nombre»** (3 oct 2026).

**La foto del frente se guarda sola en su tarima (3 oct 2026, F1 de idea-245).** Cuando la sombra
termina de leer una foto de pallet y ubicó ≥ 4 etiquetas, Double Check la trata como un frente
(`pallets/frontRead.ts`: nivel, orden y de pie / acostada; lado corto de la etiqueta 3,6", medido con
las fotos), decide de qué tarima es (`frontApply.ts`: la que más cajas tiene en común; empate o nada
en común → `PALLET ?` y elige el picker) y la **guarda sin preguntar** con la misma escritura que el
lápiz (`applyPalletSelection`): es lo más nuevo que se sabe de esa tarima (Rafael, 2 oct: «se
actualiza»). Qué queda en ella lo decide `palletTimeline`, el motor de la línea de tiempo: lo que
estaba y no se ve se queda (`?` con ✓ / ✗), lo que la foto trae de otra tarima sale de allí (`from
#3`). **No hay botón de confirmar ni flag**: es para todos (Rafael, 3 oct). Dos frenos: si alguien
editó esa tarima con el lápiz **después** de tomar la foto, la foto no la pisa y ofrece APPLY; y en
modo vista o con el filtro de una orden puesto no escribe nada. Evidencia en `pallet_fronts`
(append-only, sólo SKU y posiciones); lo que contesta el picker, en `pallet_events` como `answer`.
`runDcvShadow` devuelve ahora las cajas resueltas para esto; la sombra sigue sin enseñar nada por sí
misma. La tarjeta es `FrontProposalCard`, bajo la tarima.

**SKUs parecidos parpadean, y la foto los nombra (5 oct 2026).** #881828 pedía 2 × 03-4537GY (ROW 2)
y subieron 2 × 03-4547MN de ROW 3 —mismo ALLEGRO A2, un dígito y el color—: el parpadeo amarillo
sólo miraba dos primeros y dos últimos caracteres con el centro idéntico, y no avisó. Ahora
(`utils/lookalikeSkus.ts`, `hooks/useLookalikes.ts`) un SKU de la orden parpadea en los caracteres
que lo distinguen de cualquier SKU en stock **en su fila, la de número vecino o la siguiente del
recorrido** cuyos seis dígitos difieren en uno o en dos vecinos cambiados de lugar, con cualquier
color (03-3855GY / 03-3955GN también). Sale en ~3 de cada 4 líneas (941 líneas de 30 días): los números
de Jamis son correlativos y las familias viven juntas; Rafael eligió el parpadeo igual («el que
parpadee alerta al usuario») y **no** una línea fija con el parecido («va a confundir»). Y la foto:
esa misma tarde la sombra **leyó** las dos 03-4547MN y la tarjeta sólo dijo «Not in order 2». Toda
lectura (frente o no) que trae un SKU fuera de la orden parecido a una línea pone en esa línea un
chip rojo que parpadea, `WRONG PICK? 03-4547MN ×2` (Rafael: «algo que haga alegoría a que no pertenece a la orden… posiblemente se ha recogido mal»), y la tarjeta del frente nombra lo que no es de la orden.
