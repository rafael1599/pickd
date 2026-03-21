# Roman-app — Backlog de Mejoras

> Mejoras pendientes ordenadas por impacto en el usuario final.
> Actualizado: 2026-03-21
>
> **Formato:** cada item incluye `[fecha hora]` de creación para trazabilidad y `<!-- id: xxx -->` para tracking.
> **Single source of truth** — no editar BACKLOG.md en la raíz del proyecto (es un puntero a este archivo).

---

## Prioridad 1 — Impacto Alto (operación diaria / integridad de datos)

### ~~1. Combinar órdenes del mismo shop~~ — COMPLETADO <!-- id: task-007 -->
- **Creado:** `[2026-03-11 10:00]` · **Desarrollado:** `[2026-03-18 09:00]` · **Verificado:** `[2026-03-20]`
- **Estado:** En producción. Migración aplicada, auto-combine en watchdog, SplitOrderModal, OrderChip con 🔗.
- **Archivos:** `watchdog-pickd/supabase_client.py`, `watchdog-pickd/watcher.py`, `SplitOrderModal.tsx`, `OrderChip.tsx`, `OrderSidebar.tsx`, migración `20260317000001_add_combine_meta.sql`

### 2. Merge de órdenes FedEx (drag-and-drop en vista de verificación) <!-- id: idea-010b -->
- **Creado:** `[2026-03-18 16:00]`
- **Estado:** Por hacer.
- Permitir arrastrar una orden sobre otra en la lista de verificación para disparar un popup que permita elegir "FedEx" como tipo de envío y combinar ambas órdenes. Los SKUs de ambas órdenes se fusionan, los diferentes order numbers se concatenan (similar a la lógica de auto-combine por cliente: `"878279 / 878280"`), y la orden resultante se marca con un nuevo tipo `fedex`.
- **Consideración clave:** integridad de datos para auditoría futura — cada item debe conservar trazabilidad a su orden original (`source_order`), y el merge debe ser reversible (split). Evaluar si reusar `combine_meta` o crear un campo separado para distinguir combines automáticos (mismo cliente) de merges manuales (FedEx).
- **Archivos estimados:** `DoubleCheckView.tsx` (drag-and-drop), nuevo `MergeOrderModal.tsx`, `picking.schema.ts` (nuevo tipo), posible migración para `order_type` o similar.

### 3. 📦 Distribución física inteligente <!-- id: idea-015 -->
- **Creado:** `[2026-03-18 17:00]`
- **Estado:** Por hacer — pendiente análisis a fondo.
- Hacer más inteligente la distribución de inventario entre locations (LINE, PALLET, ROW). Definir alcance y enfoque en una sesión futura.

### 4. Vista de reporte diario por usuario de almacén <!-- id: idea-016 -->
- **Creado:** `[2026-03-11 15:30]`
- **Estado:** Por hacer.
- Nueva vista tipo dashboard para un rol de supervisión/gerencia que muestre la actividad diaria de cada usuario del almacén: órdenes pickeadas, verificadas, items movidos, y cualquier otra métrica derivada de los movimientos registrados.
- **Impacto:** visibilidad de productividad individual sin depender de reportes manuales; habilita un nuevo tipo de usuario (supervisor/manager).

### ~~5. Warehouse Selection Refinement~~ <!-- id: task-005 --> — COMPLETADO
- **Estado:** Completado. `processOrder()` ya acepta `warehousePreferences` como segundo parámetro.

### 6. Optimistic UI Fixes <!-- id: task-006 -->
- **Estado:** Por hacer.
- Address flashes in quantity updates.

---

## Prioridad 2 — Impacto Medio (mejoras de conveniencia)

- [ ] **Barcode/QR Integration**: Scan items directly. <!-- id: idea-001 -->
- [ ] **Order List View**: When reviewing orders, show the picking list first with an option to print. <!-- id: idea-006 -->
- [ ] **Automatic Inventory Email**: Send full inventory table to Jamis's email. Plain list only, NO links. <!-- id: idea-007 -->
- [ ] **Order Merging**: Combine 2 separate orders into one picking session. <!-- id: idea-010 -->
- [ ] **Multi-Address Customers**: Handle multiple shipping/billing addresses per client. <!-- id: idea-012 -->
- [ ] **Inventory Heatmaps**: Visualize picking frequency. <!-- id: idea-002 -->
- [ ] **Advanced Analytics**: Dashboard for warehouse efficiency. <!-- id: idea-003 -->
- [ ] **Smart Rebalancing**: Suggestions to move stock between warehouses. <!-- id: idea-004 -->
- [ ] **Persistent Preferences**: Remember user warehouse choices. <!-- id: idea-005 -->

---

## 🐛 Bug Tracker

### Bugs confirmados en producción (2026-03-21)

- [ ] **[bug-002] Undo borra en vez de mover** — `[2026-03-21]`
  Al mover un item (ej. 62 uds.) y hacer Undo, el item no regresa a la location original sino que queda con qty=0 sin distribución. El usuario tuvo que editar manualmente la qty y volver a mover.
  **Archivos:** `useInventoryMutations.ts` → `undoInventoryAction`, RPC `undo_inventory_action`.

- [ ] **[bug-003] Watcher envía items con qty=0** — `[2026-03-21]`
  El watchdog-pickd crea órdenes incluyendo SKUs que tienen qty=0 en la location seleccionada (ej. location con stock movido o agotado). El picker llega y no encuentra el item.
  **Causa probable:** el watcher no filtra `quantity > 0` al elegir locations.
  **Archivos:** `watchdog-pickd/watcher.py`, lógica de selección de location.

- [ ] **[bug-004] Órdenes duplicadas al retroceder de double-check a building** — `[2026-03-21]`
  Reproducido con orden 878695: al retroceder de double-check → building para corregir un SKU, luego volver a double-check y completar, el sistema genera un segundo registro en `picking_lists` con el mismo order number. La orden original queda sin completar. El usuario ve dos entradas en la lista; el teléfono sigue mostrando la original después de completar la copia.
  **Causa probable:** retroceder a building crea un nuevo `picking_list` en vez de reusar el existente.
  **Archivos:** `usePickingActions.ts` → flujo building→active, `PickingCartDrawer.tsx`.
  **Riesgo:** doble deducción de inventario si el usuario completa ambas.

- [ ] **[bug-005] Items con qty=0 aparecen en double-check sin advertencia** — `[2026-03-21]`
  En la vista de verificación se muestran items con qty=0 sin ningún indicador visual de problema. El picker no sabe que no hay stock hasta que busca físicamente.
  **Fix deseado:** ocultar el item si qty=0 Y existe en otra location con stock. Mostrar advertencia solo si no hay stock en ninguna location.
  **Archivos:** componentes de `double-check`, query de items en picking.

- [ ] **[bug-006] Orden completada reaparece desde estado original (watcher vs edición manual)** — `[2026-03-21]`
  Reproducido con orden 878662: usuario edita manualmente una orden que el watcher creó mal, la completa. Al reabrir la app, aparece la orden original sin los cambios manuales (como si el estado local se hubiera restaurado). Casi causó doble deducción.
  **Investigar:** si el watcher tiene algún mecanismo de re-envío, o si hay un estado local (localStorage/context) que no se limpió al completar.
  **Archivos:** `watchdog-pickd/watcher.py`, `PickingContext.tsx`, manejo de `activeListId` post-completion.

- [ ] **Offline Sync Edge Cases**: Handle complex rollback scenarios in InventoryProvider. <!-- id: bug-001 -->

---

## ✅ Completado

### Items con detalle

| Item | Creado | Completado | Estado |
|------|--------|------------|--------|
| Order number en label de pallets | `[2026-03-11]` | `[2026-03-11 14:28]` | Completado |
| Barra de capacidad de locations | `[2026-03-11]` | `[2026-03-18 10:00]` | Resuelto (fix de performance) |
| Takeover muestra picker real | `[2026-03-11]` | `[2026-03-13 13:12]` | Completado |
| Auto-inicio watchdog-pickd | `[2026-03-11]` | `[2026-03-18 09:30]` | Completado (launchd service) |
| Stock Printing (filtros + nueva tab) | — | — | Completado |
| iOS Pull-to-Refresh | — | — | Completado |
| Stock View Enhancements & History Fix | — | — | Completado |
| Multi-user Support (Realtime takeover) | — | — | Completado |
| TypeScript Core Migration | — | — | Completado |
| Robust Realtime System | — | — | Completado |
| Dual-Provider AI (Gemini + OpenAI) | — | — | Completado |
| Full English Localization | — | — | Completado |
| Management Setup (.agent/) | — | — | Completado |
| Warehouse Selection Basic | — | — | Completado |

### Descartado

| Item | Razón |
|------|-------|
| Sesión de warehouse: inactividad 5min + selector de perfil | No aplica — cada picker usa su propio dispositivo. `[2026-03-18]` |

### Verificado en código

| Mejora | Fecha | Evidencia |
|--------|-------|-----------|
| Orden completada no regresa a double-check | `[2026-03-11]` | Guards `.neq('status', 'completed')` + botón X oculto |
| Order number en label de impresión | `[2026-03-11]` | `PalletLabelsPrinter.tsx:111-116` |
| Jalar medidas al seleccionar item | `[2026-03-11]` | `InventoryModal.tsx:471-475` auto-fill |
| Buscador de locations mantiene opciones | `[2026-03-11]` | `AutocompleteInput.tsx` |
| Persistencia de nueva location al agregar | `[2026-03-11]` | `useLocationManagement.ts` |
| Order number clickeable en History | `[2026-03-11]` | `HistoryScreen.tsx:570-580` |
| Validación de items con 0 unidades | `[2026-03-11]` | `InventoryModal.tsx:291-298` |
| Consolidation: desglose multi-tipo | `[2026-03-10]` | `adjust_distribution()` + `pickPlanMap` |
| Limpieza distribution stale (qty=0) | `[2026-03-11]` | Migración `20260311000001` |
| Picked by / Checked by | `[2026-03-11]` | `DoubleCheckHeader.tsx`, `PickingSummaryModal.tsx` |
| Long-press → modal detalle + Edit | `[2026-03-11]` | `DoubleCheckView.tsx` |
| Performance: memoize + stabilize refs | `[2026-03-11]` | `AuthContext`, `ViewModeContext`, etc. |
| Fix: infinite re-render InventoryModal | `[2026-03-11]` | `InventoryModal.tsx` |
| Fix: infinite fetch loop distribution | `[2026-03-10]` | Distribution editing flow |
| Test: distribution e2e + realtime | `[2026-03-10]` | E2E tests |
| Script: prod→local data sync | `[2026-03-11]` | `scripts/sync-local-db.sh` |

---
