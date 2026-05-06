# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-04-28 (compactado — 24 items archivados)

---

## P1 — Alto (operación diaria)

### 58. DoubleCheckView — agrandar SKU/location/sublocation/distribution en tablet <!-- id: idea-106 -->
- **Contexto:** En tablet (orientación landscape, ~10–12") la card del item dentro de DoubleCheckView muestra SKU, location, sublocation y la distribution (pallet/qty) con tamaños pensados para móvil. El picker camina por el warehouse con la tablet en una mano y a >1m de distancia esos datos son apenas legibles — sobre todo en luz alta.
- **Datos a agrandar (en orden de criticidad para el picker):**
  1. **Location** (ej. `ROW 16`) — la usa primero para ubicar físicamente el item.
  2. **Sublocation chip** (`A,B`, `C`, etc.) — segunda señal espacial.
  3. **SKU** — confirmación visual del item recogido.
  4. **Distribution** (`8 UNITS`, pallet number, etc.) — cuánto poner en cada pallet.
- **Solución propuesta:**
  - Breakpoint nuevo `md:` o `lg:` específicamente para la card del item en DoubleCheckView. Subir SKU de `text-2xl/3xl` a `text-4xl/5xl` aprox.
  - Location y sublocation con peso visual similar — quizá agruparlas en un bloque "ROW 16 · A,B" más alto (el dato espacial completo en una sola lectura).
  - Distribution pallet-by-pallet con qty números más grandes y separación entre pallets más clara.
- **No tocar:** layout en móvil (sigue siendo el caso primario en handhelds). Solo agrandar en `md:` para arriba.
- **Validación esperada:** picker camina con tablet a 1m, identifica row + sublocation + sku correctos sin acercarla.
- **Origen:** sesión 2026-05-05.

### 53. SKU normalization at intake — close idea-092 path 1 <!-- id: idea-101 -->
- **Hallazgo verificado 2026-05-01:** la flag `sku_not_found` se setea EN watchdog al ingestar el PDF (vive como campo dentro del JSONB `picking_lists.items`). Pickd la lee, nunca la escribe — confirmado en migraciones (`process_picking_list`, `reopen_completed_orders` solo leen) y en src/ (todas las refs en DoubleCheckView/CorrectionModeView son lecturas). Conclusión: **no hay un fallback client-side viable** para auto-corregir el guion. El item JSON es inmutable post-intake.
- **Síntoma operativo:** `034664BR` desde el PDF queda como UNREG en DoubleCheckView aunque `03-4664BR` exista en `sku_metadata`. El picker tiene que hacer click en "Use 03-4666BR instead" (botón ya entregado en idea-092 path 2). 100% determinístico, no debería requerir intervención manual.
- **Solución única:** path (1) de idea-092 — watchdog (otro repo `watchdog-pickd`) llama `lookup_canonical_sku(p_raw)` (RPC ya disponible en migración `20260430160000`) antes de armar `picking_lists.items`. Si match único, sustituye el SKU + registra la sustitución en `combine_meta` o `notes` para auditar. Si match múltiple, deja el original (ambiguous → manual).
- **Riesgo:** falsos positivos teóricos si dos SKUs canónicos comparten forma normalizada (ej. `034-666-BR` y `03-4666BR`). `register_new_sku` no normaliza al guardar y no hay CHECK constraint en `sku_metadata.sku`. La RPC ya tiene `LIMIT 2` y solo un `=` exacto sobre normalizados — devuelve >1 row si hay ambigüedad real, watchdog no auto-corrige en ese caso.
- **Fuera de scope:** auto-corrección en pickd. La flag viene del intake — no podemos modificar el item JSON sin un correction.
- **Origen:** sesión 2026-05-01.

### 54. Verification Board — color identification stronger <!-- id: idea-102 -->
- **Contexto:** Tras PR #59 los lados FedEx/Regular se identifican por: stripe 3-4px arriba + tinte fondo `bg-X-500/[3%]`. En operación con luz fuerte de almacén el tinte 3% queda imperceptible — los pickers no distinguen las columnas a la primera mirada.
- **Solución (incremental):**
  - Pass 1: subir el tinte de fondo `bg-purple-500/[3%]` → `bg-purple-500/[8%]` (FDX) y emerald equivalente (Regular). Engrosar stripe `h-[3px] md:h-[4px]` → `h-[5px] md:h-[6px]`.
  - Si pass 1 no alcanza en testing real con luz alta: agregar gradient suave del stripe hacia abajo. Si tampoco: dot circular 8px en esquina top-left de cada lane.
- **Decisión pendiente al implementar:** probar pass 1 solo y validar antes de agregar gradient/dot. No exagerar en pantallas oscuras.
- **Out of scope:** volver a poner labels FEDEX/REGULAR (rationale anterior era minimalismo).
- **Origen:** sesión 2026-05-01.

### 55. New orders never auto-route to Ready to Double-Check <!-- id: idea-103 -->
- **Contexto:** Reportado en sesión 2026-05-01: una orden recién creada apareció directamente en la zona "Ready to Double-Check" del Verification Board en lugar de en su lane FedEx/Regular.
- **Hipótesis (sin diagnóstico aún):** alguna creación de orden setea `status='ready_to_double_check'` en vez de `active`. Posibles caminos:
  - Watchdog intake con default status incorrecto.
  - Reabrir una orden completada deja status en `ready_to_double_check` por accidente.
  - Auto-flag idle (idea-099 commit `37c2060`) que cambia status sin querer.
- **Plan al implementar:** primero diagnosticar — query a `picking_lists` filtrando `status='ready_to_double_check' AND created_at = updated_at` (proxy de "recién creada y nunca tocada") los últimos 7 días. Identificar patrón antes de proponer fix. Probable: guard en intake (CHECK constraint o trigger BEFORE INSERT que rechace `ready_to_double_check` para rows nuevos).
- **Datos pendientes para diagnóstico:** order_number observado + día/hora + si fue de watchdog o creación manual / reopen.
- **Origen:** sesión 2026-05-01.

### 56. Explicit "Ready to Double-Check" button after Select-All in DoubleCheckView <!-- id: idea-104 -->
- **Contexto:** Hoy en DoubleCheckView el flow es: el verificador chequea items uno por uno, y cuando todos están seleccionados puede presionar **Complete** (cierra a `completed`). No hay paso explícito para "esta orden está lista para que la verifique alguien más" — esa señal hoy se da implícitamente cuando un picker termina y "deja" la orden (status → `ready_to_double_check`).
- **Problema:** los pickers que terminan una orden a veces clickean Complete directamente, evitando segundo verificador. Otras veces no marcan nada y la orden queda perdida.
- **Solución propuesta:**
  1. Cuando `verifiedUnitsCount === totalUnitsCount` (Select All completo) por primera vez en DoubleCheckView, aparece nuevo botón **"Ready to Double-Check"** al lado de **Complete**.
  2. Click → marca la orden con `status='ready_to_double_check'`, `checked_by=null` (libera lock para que cualquier verificador la tome). Aparece en sección "Ready to Double-Check" del Verification Board.
  3. **Complete** sigue existiendo y hace lo de hoy (cerrar directo).
  4. Tooltip claro: *"Hand off to a teammate for double-check"* vs *"Close the order now (skip second verification)"*.
- **Decisión pendiente al implementar:** verificar el flow real de Complete hoy — si pasa por `double_checking` y luego `completed` o salta directo. Eso afecta semántica del nuevo botón.
- **Edge:** si la orden ya está `ready_to_double_check` no se muestra botón (idempotente). Si está `double_checking` (alguien la tomó), botón "Ready" la libera de vuelta.
- **Origen:** sesión 2026-05-01.

### 57. Realtime stock reservation visibility (cross-order live awareness) <!-- id: idea-105 -->
- **Contexto:** En operación con varias órdenes activas simultáneas, dos pickers pueden estar viendo el mismo SKU. Hoy DoubleCheckView muestra "14 disponibles en ROW 32" sin descontar lo que otro picker ya recogió en otra orden. ItemDetail muestra qty total sin distinguir reservado/recogido. El sistema se siente estático.
- **Modelo conceptual confirmado en sesión 2026-05-01:**
  - **Reservado** = item dentro de `picking_lists.items` mientras la orden está activa (no completada/cancelada). Implícito por la existencia del row.
  - **Recogido** = picker clickeó el item en DoubleCheckView. Persiste como flag `picked: true` (o `picked_at`) dentro del item JSONB.
- **Decisiones tomadas:**
  - **(β) Recogido descuenta `inventory.quantity` inmediatamente** — emite DEDUCT log al click. `available = quantity - reserved_no_recogido_de_otras_ordenes`. Plan detallado de compensación antes de implementar (cómo deshacer DEDUCT al cancelar/quitar item recogido).
  - **Item removido en EditOrder libera la reserva** (si solo reserved → quita del JSON; si recogido → emite ADD compensatorio para devolver al stock).
  - **Watchdog agnóstico** — sigue creando órdenes con cantidad pedida sin consultar reservas. El cálculo de available vive client-side en pickd al renderizar.
  - **UX ItemDetail (formato narrativa):**
    ```
    Total: 8
    └─ 2 reserved for #879484 (Pedal Pushers)
    └─ 6 free
    ```
    El order# es clickeable y abre la orden destinataria.
  - **Move semantics (Opción B):** un MOVE de inventario se permite aunque haya reservas — la reserva se traslada a la nueva location. El item de la orden ahora apunta a la nueva location automáticamente.
  - **Concurrency:** optimistic local + UPDATE condicional server-side que valide `available_for_me >= requested`. Si rechaza, rollback optimistic + toast "Item just got picked by someone else, refresh".
  - **Reservas en Waiting for Inventory:** se mantienen activas mientras la orden viva (incluso meses). Botón "Release reservation" para admin en el detalle de la orden waiting permite liberar stock virtual manualmente sin cancelar la orden.
- **Implementación técnica:**
  - **DB:** extender `picking_lists.items` JSONB con `picked: bool` + `picked_at: timestamp`. Sin tabla nueva.
  - **Realtime:** suscribir DoubleCheckView a `picking_lists` (cambios en items field). Cada cambio dispara recompute del available local.
  - **Cálculo:** `usePickingActions.ts` ya hace algo similar (calcula reserved across active lists al markAsReady). Reusar y extender.
  - **Compensación on cancel/remove:** RPC nueva `release_picked_item(p_list_id, p_sku, p_qty)` que emite ADD log y restaura inventory.quantity. Ejecutada por el flow de cancel + remove en EditOrder.
- **Riesgos:**
  - Latencia Realtime ~500ms-2s; race condition en doble-pick simultáneo. Mitigado por UPDATE condicional.
  - Estado inconsistente si picker abandona post-pick (cierra browser). idea-099 tiene precedente de TTL para órdenes idle, extender ese mecanismo a recogidos.
- **Out of scope v1:** mostrar avatar/nombre del picker que reservó (privacy + complejidad). Solo número y order#.
- **Origen:** sesión 2026-05-01. Tamaño estimado: 1-2 sprints.

### ~~48. Auto-mover órdenes idle a Waiting (en vez de borrarlas)~~ <!-- id: idea-099 --> ✅ 2026-04-30
- **Contexto:** El 2026-04-30 desapareció la orden `879469` que se dejó pendiente la noche anterior por falta de un item. Causa raíz: `usePickingSync.ts` borraba con DELETE las órdenes `active|needs_correction|reopened` cuyo `updated_at` fuera mayor a 5h cuando el user reabre la app.
- **Resuelto en commits:**
  - `1645bff` — quitar el DELETE: ahora solo libera la sesión local, la orden sobrevive.
  - `37c2060` — auto-flag idle `needs_correction` como `is_waiting_inventory` via `mark_picking_list_waiting`. Aterriza en la Waiting zone del Verification Board (UI ya existente desde idea-053/idea-055). RPC admin-only: si el caller no es admin, warn y queda en `needs_correction`.
  - Migración `20260430140000_picking_lists_delete_audit.sql` — trigger `BEFORE DELETE` que captura row + auth.uid() en tabla `picking_lists_deleted_audit`. Cualquier delete futuro deja rastro forensic.
- **Threshold actual:** 5h (heredado del código previo). Si en uso real resulta corto/largo, ajustar a "del día NY anterior" (TODO menor).

### ~~47. Reactivación de SKU al cambiar qty~~ <!-- id: idea-098 --> ✅ 2026-04-30 (no requiere código)
- **Investigación 2026-04-30:** `adjust_inventory_quantity` en prod ya hace el flip bidireccional automático (`is_active = (v_new_qty > 0)` — comentario explícito *"Bidirectional: activate when stock arrives, deactivate when depleted"*). Cliente la usa en `useInventoryMutations.ts:38`. Resultado: subir qty desde 0 reactiva el row sin cambio adicional.
- **`register_new_sku`** sigue creando placeholders con qty=0/is_active=true, no se ve afectado.
- **No se requiere botón "Reactivate"** — descartado.

### 46. Auto-resolver SKU format mismatches en intake / pick-time <!-- id: idea-092 -->
- **Estado parcial 2026-04-30:** ✅ entregado el path (2) — RPC `lookup_canonical_sku(p_raw)` en `supabase/migrations/20260430160000_lookup_canonical_sku.sql` + hook `useSkuSuggestion` + botón "Use {canonical} instead" en `CorrectionModeView` cuando el item está `sku_not_found`. Pendiente: path (1) Watchdog intake-time normalization (otro repo: `watchdog-pickd`) — `lookup_canonical_sku` ya está disponible; falta llamarla desde el parser antes de crear el `picking_lists.items`.
- **Contexto:** Las órdenes llegan con SKUs que no coinciden con `sku_metadata` solo por formato (guion/espacios faltantes). Ej: catalog tiene `09-4802BK` pero el PDF/sistema upstream pone `094802BK`. El picker hoy resuelve manualmente con un `Replaced X → Y` correction y razón "Sku def" / "Wrong name". En las últimas 2 semanas: `094802BK→09-4802BK` (2 órdenes, 2 customers el mismo día) y `033769BLD→03-3769BLD` (1 orden). Detección: la versión normalizada (lowercase + strip `[-\s]`) de ambos SKUs es idéntica → no es variant real, es ruido de formato.
- **Problema:** trabajo manual recurrente del picker para algo que la DB puede resolver sola. Cada caso suma ~30s + un correction note que infla el dashboard cross-team.
- **Solución propuesta — dos puntos de entrada que ya tocan la DB:**
  1. **Watchdog (intake):** al parsear el PDF, antes de crear `picking_lists.items`, normalizar cada SKU y hacer lookup contra `sku_metadata`. Si el SKU literal no existe pero el normalizado coincide con un único SKU canónico, sustituir y registrar la sustitución en `picking_lists.notes` o `combine_meta` (`{ sku_normalized: { from, to, reason: 'format' } }`). Si el normalizado coincide con múltiples canónicos, dejar el original y que el picker resuelva (ambiguous).
  2. **DoubleCheckView (pick-time, fallback):** al renderizar un item cuyo SKU no matchee `sku_metadata`, hacer la misma búsqueda normalizada. Si hay match único, ofrecer auto-resolución con un botón "Use 03-4070BK instead" (sin generar `Replaced` correction — porque no es un fix real). Si hay >1 match, mostrar selector. Reusa la normalización de la stock search RPC (idea-074) — `regexp_replace(sku, '[-\s]', '', 'g')`.
- **Out of scope:** variants reales (color/size distinto). Esos siguen requiriendo decisión manual del picker — son señal cross-team legítima para sales.
- **Impacto medible:** el reporte cross-team de 2 weeks (2026-04-13→2026-04-27) bajó de 5 mismatches a 3 al excluir los format-only. Esperado: ~40% menos correction notes "Sku def" / "Wrong name".
- **Riesgo:** falso positivo si un SKU `094802BK` existe POR SI MISMO en el catálogo (no debería pasar — todos los SKUs en `sku_metadata` tienen el formato canónico — pero la lookup `WHERE LOWER(REPLACE(sku, '-', '')) = $1` debe protegerse con `LIMIT 2` y rechazar match si retorna >1).
- **Origen:** sesión 2026-04-27.

### ~~45. FedEx Returns en el Activity Report~~ <!-- id: idea-091 --> ✅ 2026-05-06
- **Resuelto en commit `9051a9d`:** sección "FedEx Returns — N" dentro de la card de Inventory Accuracy. Muestra tracking number, status, item count, total units por return — sin nombres, sin timestamps, según pedido del operador. Hidden cuando no hay returns en el día.
- **Cambios:**
  - `useActivityReport`: nuevo `FedExReturnSummary` type + query paralela a `fedex_returns` (joined con `fedex_return_items`) en la ventana NY-day.
  - `ActivityReportView`: `FedExReturnsBlock` con tabla 4-col + total summary line. Color AMBER para diferenciar de Moved/Consolidated.
- **Out of scope (descartado del spec original):** Viernes acumulado semanal, agrupación walk-in returns, top-5. El user prefirió listado simple full-day, no top.

### 44. Add On reopen reason — Phase 2 (full feature) <!-- id: idea-067 -->
- **Contexto:** En el modal "Why are you reopening this order?" se agregó la opción "Add On" para mergear una orden completada con una nueva orden del mismo customer. Fase 1 (DB pre-requisitos) ya en prod: fix `auto_group_fedex_orders` excluye `reopened`, `process_picking_list` rechaza `reopened`. Fase 2 queda pendiente — este ticket.
- **Objetivo Fase 2:** implementar el feature end-to-end. Al elegir "Add On":
  1. Reopen la orden completada (snapshot guardado via `reopen_picking_list`).
  2. Crear/agregar a grupo con la orden nueva (`createGroup`/`addToGroup`, tipo `general`).
  3. Entrar a DoubleCheckView combinado mostrando items de ambas (la reopened marcada con badge "Previously picked" sutil, editable).
  4. Al completar, aplicar delta-inventory a la reopened (via `recomplete_picking_list`) Y completar la nueva — **atomic** via nueva RPC `complete_addon_group(p_source_id, p_target_id, ...)`.
- **Pallet photos:** mostrar fotos viejas (read-only, de la completada) + permitir tomar nuevas para la add-on. Validación bloqueante: ≥1 foto nueva antes de "Complete".
- **Botón "Cancel Add-On":** en header de DoubleCheckView, ejecuta `cancel_reopen` + remueve `group_id` de ambas.
- **Guards multi-user:** rechazar Add-On si el target tiene `checked_by ≠ null` (otro usuario editando). Mensaje claro.
- **Edge cases a resolver:**
  - Auto-cancel 2h sobre reopened con `group_id` → debe limpiar grupo también (modificar `auto_cancel_stale_reopened`).
  - Completion atomicity: RPC en transacción BEGIN/EXCEPTION/ROLLBACK.
  - Insufficient stock en SKU nuevo del add-on → validar en la RPC antes de aplicar deltas.
  - Shipping type: heredar del target, bloquear auto-reclassify en re-complete.
  - Watchdog auto-combine del mismo customer durante add-on → ya mitigado en Fase 1 (trigger excluye reopened).
- **Test matrix resumido:** F1-F5 happy path; M1 multi-user reject; P1-P3 photos; A1 auto-cancel; R1-R5 regression.
- **Deferrable a Fase 3:** hardening de `takeOverOrder`, scoping realtime por group_id, RPC `lock_group_for_check` atomic.
- **Análisis completo:** sesión 2026-04-22 (claude/addon-db-prereqs). Cerrada PR #14 (merge visual incompleto).

### 43. Orders view — UX/UI rework <!-- id: idea-065 -->
- **Problema:** La vista `/orders` tiene varios pain points:
  1. El **encabezado de PickD desaparece** en esta ruta. Debería estar siempre presente.
  2. **LivePrintPreview** tintea toda la card según el carrier — colores saturados rompen la estética.
  3. La asignación visual del carrier al label no es clara — sin logo identificable.
  4. Densidad y jerarquía visual no son lo suficientemente minimalistas comparado con el resto del sistema.
- **Solución propuesta:**
  - Mantener el header global de PickD visible en `/orders` (revisar `AppShell` / layout wrapper).
  - **Invertir el uso del color del carrier:** color vivo va al **fondo del preview card** con overlay glass oscuro (`bg-card/80 backdrop-blur-xl`).
  - **Logo del carrier** debajo del label impreso (FedEx / UPS / USPS / Regular), tamaño discreto, grayscale si el fondo ya expresa el carrier.
  - Pasar a estilo más minimalista: menos chrome, más whitespace.
- **Requiere:** Inventariar componentes ocultando el header; definir paleta por carrier; resolver assets de logos; evaluar impacto en PDF de labels (`jsPDF`).

### 22. Alerta de orden duplicada por cliente + reabrir <!-- id: idea-039 --> (deprioritized)
- **Problema:** Cuando llega una orden nueva para un cliente cuya orden anterior ya fue completada, el picker no se entera y la procesa por separado.
- **Solución:** Detectar si existe otra orden completada del mismo `customer_name`. Mostrar alerta con opción de reabrir y mergear.
- **Estado:** Deprioritizado 2026-04-13. No es urgente — se maneja manualmente por ahora.

### 31. Inventory Accuracy Fase 2 — Validación de cantidad <!-- id: idea-048 -->
- **Contexto:** Fase 1 implementada: MOVEs y ADDs cuentan como verificación implícita de cobertura (SKU fue tocado físicamente en 60d). Cobertura subió de ~0.5% a ~20%.
- **Problema Fase 2:** La cobertura no garantiza que la cantidad actual sea correcta. Un SKU movido hace 30 días puede tener una cantidad incorrecta si hubo errores no trackeados después.
- **Solución:** Reconstruir la cadena: qty al momento del MOVE/ADD + ADDs posteriores - DEDUCTs posteriores = qty esperada. Comparar con qty actual en DB. Si coincide → "quantity verified". Si no → flag para reconteo.
- **Consideraciones:** Solo el destino del MOVE es confiable. ADDs son verdad absoluta para la cantidad agregada. DEDUCTs de picking son trackeados pero pueden tener correcciones. Evaluar si hacer esto como query on-demand o como background job.
- **Requiere:** Análisis profundo + posible RPC en DB para eficiencia.

### 30. Cache de datos de orden al cambiar entre órdenes <!-- id: idea-047 -->
- **Problema:** Al cambiar entre órdenes en OrdersScreen, el frontend recalcula todo (items, distribución, labels, conteos) cada vez. Causa lag perceptible y mala UX, especialmente en mobile.
- **Solución:** Calcular la información de cada orden una sola vez y mantenerla estática en cache. Suscribirse a cambios vía Realtime (o invalidación de query) para que solo se recalcule cuando hay un cambio real en la orden o configuración del sistema.
- **Consideraciones antes de implementar:** Investigar edge cases — ¿qué pasa si otro usuario modifica la orden mientras está cacheada? ¿Se necesita una columna `updated_at` más granular o un hash de versión? ¿Impacto en optimistic updates existentes? Evaluar si TanStack Query `staleTime` + `structuralSharing` ya cubre parte del problema o si se necesita un cache layer adicional.
- **Requiere:** Análisis profundo antes de implementar.

---

## P2 — Medio (conveniencia)

- [ ] **Orders PDF preview full-width mobile** — `w-full` en mobile. <!-- id: idea-034 -->
- [ ] **Order List View** — Picking list first with print option. <!-- id: idea-006 -->
- [ ] **Migrar cron jobs a pg_cron** — Elimina dependencia de GitHub Actions. <!-- id: idea-030 -->
- [ ] **FedEx Returns — limpieza post-Opción A** — Tras shipping de la Opción A (intake crea inventory + items at label-scan time), `useAddReturnItem` y `ReturnToStockSheet` quedan parcialmente obsoletos: hoy crean un row nuevo de inventory + items, pero el row ya existe desde el intake. Tareas: (1) cambiar `ReturnToStockSheet` para que **renombre** el SKU del row placeholder en vez de crear uno nuevo; (2) eliminar el `register_new_sku` redundante del `useAddReturnItem`; (3) revisar el flow `useResolveReturn` para asegurar que mueve el row correcto y no deja huérfanos; (4) sweep de "registros dobles" históricos en prod (returns que tienen items legacy + items del backfill — dedupe). Prereq: validar Opción A en prod 1-2 semanas. <!-- id: idea-099 -->
- [ ] **FedEx Returns — dedupe histórico de fotos + rows duplicados** — Workflow manual: (1) correr `scripts/fedex_returns_dup_detection.sql` en prod (read-only); revisa 5 secciones (multi-items por return, item_name con tracking, rows en locations FDX-like sin link, fotos label+item duplicadas, mismo SKU en >1 returns). (2) export a sheet, marcar columna `keep_choice` por fila. (3) volver con la sheet → genero script de cleanup que (a) hace `UPDATE fedex_return_items SET return_id` para reapuntar al canónico, (b) `UPDATE inventory SET is_active=false, quantity=0` en los rows duplicados (no DELETE — preserva auditoría), (c) decide foto: si keep=item, mover `label_photo_url` a `notes` del return; si keep=label, reasigna al placeholder via `sku_metadata.image_url`; si both, sube ambas a gallery. (4) verificación visual: recorrer cada return en /fedex-returns y confirmar foto + location. Prereq: idea-099 + 1-2 semanas de operación con Opción A. <!-- id: idea-100 -->
- [x] ~~**FedEx Returns — "Add Item" → "Return to Stock"**~~ ✅ 2026-04-27 — Botón y modal renombrados a `Return to Stock` (`FedExReturnDetailScreen.tsx:211`, `ReturnToStockSheet.tsx`). Archivo `AddItemSheet.tsx` removido — sin referencias en el código. PR #43 (bundle FedEx Returns rework). <!-- id: idea-066 -->
- [ ] **Bike/Part/Unknown selector en "New Item"** — Al registrar un SKU nuevo, el form debe forzar la selección manual de tipo (Bike / Part / Unknown). Hoy `is_bike` queda en `false` por default y el picker no tiene manera de clasificarlo. Sirve de respaldo cuando la heurística de prefijo "03-" falle. Tocar `UnifiedForm` / `register_new_sku` RPC para persistir el flag. <!-- id: idea-068 -->
- [x] ~~**DoubleCheckView — counter "X / N Units Verified" más visible**~~ ✅ 2026-04-28 — `text-lg font-black` + color dinámico (rojo/ámbar/emerald) según progreso. PR #49. <!-- id: idea-093 -->
- [x] ~~**Activity Report — desglose del KPI Inventory Accuracy**~~ ✅ 2026-04-28 — 5 bullets per-source (cycle counted, movements, additions, on-site checked, quantity edited) en web + PDF. RPC `compute_daily_report_data` v2 mirror. PostgREST cap fix `.limit(50_000)`. PR #51. **Reemplazado por idea-097.** <!-- id: idea-094 -->
- [x] ~~**Activity Report — Out of Stock formato más simple**~~ ✅ 2026-04-28 — `Name (SKU)` con name primero, completions sub-list eliminada solo en este bloque. Dead code `onClickOrder`/`useModal`/`handleClickOrder` removido. PR #50. <!-- id: idea-095 -->
- [x] ~~**Activity Report — Projects opcionales con dropdown por categoría + flash on add**~~ ✅ 2026-04-28 — Panel "Projects to include" en el editor con 3 dropdowns colapsables (`<details>`) + checkbox por task. Selección persistida en `DailyReportManual.included_project_ids`. Flash verde via `useHighlight()` keyed sobre IDs filtrados. Filter en Screen, View queda presentational. PR #52. <!-- id: idea-096 -->
- [x] ~~**Activity Report — KPI Inventory Accuracy: rework live (tablas + nota + polish PDF)**~~ ✅ 2026-04-28 — Reemplaza los 5 bullets agregados de idea-094 por una vista live-only del día con dos secciones (no las 3 originalmente planeadas — VERIFIED ON SITE y ADDED se eliminaron por feedback "ya está cubierto en On the Floor"): **MOVED** (4 col: Item, SKU, `From → To` con `(n)` solo si multi-loc o move parcial + línea "also LOC (qty)" si multi-loc, Total now) y **CONSOLIDATION** (1 línea: `Item (SKU), consolidated on LOCATION` — detectado vía `inventory_logs.EDIT` con `quantity_change = 0` que representa edits de sublocation/distribution sin tocar stock). Reglas: omitir SKUs sin `item_name`; cronológico sin timestamp; dedupe per-SKU; cross-section dedupe (MOVED gana sobre CONSOLIDATION); `cycle_counted` y EDIT fuera; sublocations ocultas en todo el reporte. El % accuracy headline sigue 90d. Mirror PDF con `<TodayEventsPdfBlock>`. Polish: nota "Why this matters" arriba del KPI; % redondeado a integer en PDF; sección 03 forzada a página nueva en PDF; cards Done/InProg/Next vacíos ocultos en PDF; defensive `events?` en ambos consumers para tolerar IDB cache stale; bump `CACHE_VERSION v1.2.0→v1.4.0`. Fix de item_name: bulk fetch ahora incluye filas qty=0 (los moves crean filas destino sin name; las filas con name suelen estar en qty=0). Commits: 9a24fbc, 6e5bbbb, 8e42201, 2f42510, 13c4b79, 69587f4, 49c946e, f7679fd, 4578d1d, e2e1ab1. Sin migración SQL. **Bloquea precisión de `(n)` en moves parciales — depende de idea-098.** <!-- id: idea-097 -->
- [x] ~~**BUG — MOVE inflando inventario**~~ ✅ 2026-04-29 — **NO REPRO.** Investigación contra prod confirmó que el inventario está intacto en todas las eras (source quedó en 0, dest recibió la qty, total conservado). Lo que disparó la sospecha eran dos shapes de audit log emitidos por dos ramas distintas en `inventory.service.ts > processItem`: CASE 2 (collision al destino) emite `qc=-N, new=0`; CASE 3 (sin collision, row updated in place) emitía `qc=newQty-prevQty` que es 0 para un full-move. El mix histórico variaba según cuántos destinos ya tenían rows zero-qty inactive. **Acciones tomadas:** (1) helper `moveDeltaUnits()` en `src/features/inventory/utils/inventoryLogShape.ts` que tolera ambos shapes; (2) refactor de consumers (`useActivityReport`, `HistoryScreen`, `ItemHistorySheet`, `useLastActivity` — que perdía Shape A por filter `.neq('quantity_change',0)`); (3) homogeneización: CASE 3 MOVE ahora emite `qc=-N, new=0` igual que CASE 2 — todos los MOVE futuros tienen un solo shape; (4) doc en `docs/inventory-log-shapes.md`. RENAME (action_type=EDIT) mantiene semántica row-state (qty no se mueve). NO se backfilleó audit histórico. <!-- id: idea-098 -->

---

## P1 — Refinados pendientes

### ~~40. Notas de proyecto siempre visibles (quitar line-clamp)~~ <!-- id: idea-062 --> ✅ 2026-04-27
- `line-clamp-2` removido del `TaskCard` en `src/features/projects/ProjectsScreen.tsx`. Verificado: no quedan refs a `line-clamp` en el archivo. PR #43 (bundle).

---

## Inventory Audit — pendientes de revisión

- [ ] **ROW 10 — 6 SKUs sin sublocation confirmada** — `03-3718GY` (1), `03-3719GY` (1), `03-3817GY` (1), `03-3846BR` (5), `03-4201GN` (3), `03-4208GY` (1). Verificar físicamente si siguen en ROW 10 o deben moverse/desactivarse. <!-- audit-2026-04-15 -->

---

## Bugs pendientes

_(ninguno abierto al 2026-04-28 — bug-013 archivado)_

---

## Descartado

| Item | Razón |
|------|-------|
| Sesión inactividad 5min | Cada picker usa su propio dispositivo |
| Barcode/QR (idea-001) | PDFs parseados automáticamente |
| Analytics Dashboard (idea-003) | Sin volumen suficiente |
| Smart Rebalancing auto (idea-004) | Sugerencias manuales ya existen |
| Persistent Preferences (idea-005) | Solo LUDLOW, theme en localStorage |
| Optimistic UI Fixes (task-006) | Mitigado por staleTime + refetchOnWindowFocus |
| Offline Sync (bug-001) | Sin reportes de fallos reales |
| History en perfil (idea-035) | Cubierto por filtros en HistoryScreen y OrdersScreen |
| Resumen diario soft per-user (ID original idea-041, conflicto con `/activity-report`) | Brainstorm orphan, sin commits. El team detail de `/activity-report` cubre el caso. |
| Auto-cancel → expiración (idea-031) | Nada expira; liberación manual. La rama verification 24h fue eliminada en idea-053. |
| Automatic Inventory Email (idea-007) | 2026-04-22 — `send-daily-report` nunca se usó en operación; eliminada del runtime para cerrar endpoint sin auth. Snapshot R2 sigue activo vía `daily-snapshot`. `0d85fc2`. |
