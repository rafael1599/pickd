# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-04-28 (compactado — 24 items archivados)

---

## P1 — Alto (operación diaria)

### 46. Auto-resolver SKU format mismatches en intake / pick-time <!-- id: idea-092 -->
- **Contexto:** Las órdenes llegan con SKUs que no coinciden con `sku_metadata` solo por formato (guion/espacios faltantes). Ej: catalog tiene `09-4802BK` pero el PDF/sistema upstream pone `094802BK`. El picker hoy resuelve manualmente con un `Replaced X → Y` correction y razón "Sku def" / "Wrong name". En las últimas 2 semanas: `094802BK→09-4802BK` (2 órdenes, 2 customers el mismo día) y `033769BLD→03-3769BLD` (1 orden). Detección: la versión normalizada (lowercase + strip `[-\s]`) de ambos SKUs es idéntica → no es variant real, es ruido de formato.
- **Problema:** trabajo manual recurrente del picker para algo que la DB puede resolver sola. Cada caso suma ~30s + un correction note que infla el dashboard cross-team.
- **Solución propuesta — dos puntos de entrada que ya tocan la DB:**
  1. **Watchdog (intake):** al parsear el PDF, antes de crear `picking_lists.items`, normalizar cada SKU y hacer lookup contra `sku_metadata`. Si el SKU literal no existe pero el normalizado coincide con un único SKU canónico, sustituir y registrar la sustitución en `picking_lists.notes` o `combine_meta` (`{ sku_normalized: { from, to, reason: 'format' } }`). Si el normalizado coincide con múltiples canónicos, dejar el original y que el picker resuelva (ambiguous).
  2. **DoubleCheckView (pick-time, fallback):** al renderizar un item cuyo SKU no matchee `sku_metadata`, hacer la misma búsqueda normalizada. Si hay match único, ofrecer auto-resolución con un botón "Use 03-4070BK instead" (sin generar `Replaced` correction — porque no es un fix real). Si hay >1 match, mostrar selector. Reusa la normalización de la stock search RPC (idea-074) — `regexp_replace(sku, '[-\s]', '', 'g')`.
- **Out of scope:** variants reales (color/size distinto). Esos siguen requiriendo decisión manual del picker — son señal cross-team legítima para sales.
- **Impacto medible:** el reporte cross-team de 2 weeks (2026-04-13→2026-04-27) bajó de 5 mismatches a 3 al excluir los format-only. Esperado: ~40% menos correction notes "Sku def" / "Wrong name".
- **Riesgo:** falso positivo si un SKU `094802BK` existe POR SI MISMO en el catálogo (no debería pasar — todos los SKUs en `sku_metadata` tienen el formato canónico — pero la lookup `WHERE LOWER(REPLACE(sku, '-', '')) = $1` debe protegerse con `LIMIT 2` y rechazar match si retorna >1).
- **Origen:** sesión 2026-04-27.

### 45. FedEx Returns en el Activity Report <!-- id: idea-091 -->
- **Contexto:** El daily Activity Report hoy cuenta órdenes (Done Today, In Progress, Coming Up) y low-stock, pero no refleja **FedEx Returns** — items que regresan al warehouse por returns, que son trabajo operativo diario igual que picking.
- **Problema:** el equipo no tiene visibilidad del flujo de returns dentro del reporte. Un día con 0 órdenes nuevas pero 15 returns procesados se ve como "día tranquilo" cuando en realidad fue activo.
- **Solución propuesta:**
  - Nueva sección o sub-bloque en el Activity Report: **"FedEx Returns"** — similar a los otros bloques del reporte (card glass con header icon).
  - Contenido mínimo del día: count, top-5 returns (SKU, qty, original order_number, fecha), total unidades reingresadas.
  - Fuente: tabla `fedex_returns` (migration `20260416210000_fedex_returns.sql`).
  - Hook nuevo: `useFedExReturnsForReport(nyDate)` similar a `useLowStockAlerts` — filtra por ventana NY-day.
- **Edge cases:** Viernes acumulado semanal (Mon-Fri); returns sin `original_order_number` agrupar en "Walk-in returns"; sin returns → omitir bloque.
- **Fuera de scope:** dashboard standalone de returns (ya existe `/fedex-returns`). Esto es solo visibilidad en el reporte diario.

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
- [ ] **FedEx Returns — "Add Item" → "Return to Stock"** — Renombrar el botón/acción `Add Item` en `src/features/fedex-returns/` (ver `AddItemSheet.tsx`) a `Return to Stock` para reflejar mejor la intención del flujo. <!-- id: idea-066 -->
- [ ] **Bike/Part/Unknown selector en "New Item"** — Al registrar un SKU nuevo, el form debe forzar la selección manual de tipo (Bike / Part / Unknown). Hoy `is_bike` queda en `false` por default y el picker no tiene manera de clasificarlo. Sirve de respaldo cuando la heurística de prefijo "03-" falle. Tocar `UnifiedForm` / `register_new_sku` RPC para persistir el flag. <!-- id: idea-068 -->
- [x] ~~**DoubleCheckView — counter "X / N Units Verified" más visible**~~ ✅ 2026-04-28 — `text-lg font-black` + color dinámico (rojo/ámbar/emerald) según progreso. PR #49. <!-- id: idea-093 -->
- [x] ~~**Activity Report — desglose del KPI Inventory Accuracy**~~ ✅ 2026-04-28 — 5 bullets per-source (cycle counted, movements, additions, on-site checked, quantity edited) en web + PDF. RPC `compute_daily_report_data` v2 mirror. PostgREST cap fix `.limit(50_000)`. PR #51. **Reemplazado por idea-097.** <!-- id: idea-094 -->
- [x] ~~**Activity Report — Out of Stock formato más simple**~~ ✅ 2026-04-28 — `Name (SKU)` con name primero, completions sub-list eliminada solo en este bloque. Dead code `onClickOrder`/`useModal`/`handleClickOrder` removido. PR #50. <!-- id: idea-095 -->
- [x] ~~**Activity Report — Projects opcionales con dropdown por categoría + flash on add**~~ ✅ 2026-04-28 — Panel "Projects to include" en el editor con 3 dropdowns colapsables (`<details>`) + checkbox por task. Selección persistida en `DailyReportManual.included_project_ids`. Flash verde via `useHighlight()` keyed sobre IDs filtrados. Filter en Screen, View queda presentational. PR #52. <!-- id: idea-096 -->
- [x] ~~**Activity Report — KPI Inventory Accuracy: rework live (tablas + nota + polish PDF)**~~ ✅ 2026-04-28 — Reemplaza los 5 bullets agregados de idea-094 por una vista live-only del día con dos secciones (no las 3 originalmente planeadas — VERIFIED ON SITE y ADDED se eliminaron por feedback "ya está cubierto en On the Floor"): **MOVED** (4 col: Item, SKU, `From → To` con `(n)` solo si multi-loc o move parcial + línea "also LOC (qty)" si multi-loc, Total now) y **CONSOLIDATION** (1 línea: `Item (SKU), consolidated on LOCATION` — detectado vía `inventory_logs.EDIT` con `quantity_change = 0` que representa edits de sublocation/distribution sin tocar stock). Reglas: omitir SKUs sin `item_name`; cronológico sin timestamp; dedupe per-SKU; cross-section dedupe (MOVED gana sobre CONSOLIDATION); `cycle_counted` y EDIT fuera; sublocations ocultas en todo el reporte. El % accuracy headline sigue 90d. Mirror PDF con `<TodayEventsPdfBlock>`. Polish: nota "Why this matters" arriba del KPI; % redondeado a integer en PDF; sección 03 forzada a página nueva en PDF; cards Done/InProg/Next vacíos ocultos en PDF; defensive `events?` en ambos consumers para tolerar IDB cache stale; bump `CACHE_VERSION v1.2.0→v1.4.0`. Fix de item_name: bulk fetch ahora incluye filas qty=0 (los moves crean filas destino sin name; las filas con name suelen estar en qty=0). Commits: 9a24fbc, 6e5bbbb, 8e42201, 2f42510, 13c4b79, 69587f4, 49c946e, f7679fd, 4578d1d, e2e1ab1. Sin migración SQL. **Bloquea precisión de `(n)` en moves parciales — depende de idea-098.** <!-- id: idea-097 -->
- [ ] **BUG — MOVE inflando inventario** — Reportado por usuario el 2026-04-28: las operaciones MOVE no son zero-sum, el stock total del SKU crece. Sospecha: migración reciente o cambio en `move_inventory_stock` RPC. Pista observada: cada MOVE en `inventory_logs` (data 2026-04-16) genera **2 PHYSICAL_DISTRIBUTION rows duplicados** sobre el mismo SKU al destino (puede ser síntoma o causa). Todos los MOVE rows tienen `quantity_change = 0` (esperado o no?). Investigación en curso por agente — diagnóstico pendiente. Migraciones a auditar primero: `20260427120000_fedex_return_items_target_location.sql`, familia `fedex_returns_*` (Apr 16). <!-- id: idea-098 -->

---

## P1 — Refinados pendientes

### 40. Notas de proyecto siempre visibles (quitar line-clamp) <!-- id: idea-062 -->
- **Problema:** Hoy `line-clamp-2` recorta notas largas en task cards del kanban.
- **Solución:** Quitar `line-clamp-2` en `TaskCard` (`src/features/projects/ProjectsScreen.tsx`). Las cards crecen tanto como sea necesario para mostrar la nota completa.
- **Trivial.**

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
