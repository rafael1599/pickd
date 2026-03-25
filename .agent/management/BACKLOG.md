# PickD — Backlog de Mejoras

> Mejoras pendientes ordenadas por impacto en el usuario final.
> Actualizado: 2026-03-25
>
> **Formato:** cada item incluye `[fecha hora]` de creación para trazabilidad y `<!-- id: xxx -->` para tracking.
> **Single source of truth** — no editar BACKLOG.md en la raíz del proyecto (es un puntero a este archivo).

---

## Prioridad 1 — Impacto Alto (operación diaria / integridad de datos)

### ~~1. Combinar órdenes del mismo shop~~ — COMPLETADO <!-- id: task-007 -->

- **Creado:** `[2026-03-11 10:00]` · **Desarrollado:** `[2026-03-18 09:00]` · **Verificado:** `[2026-03-20]`
- **Estado:** En producción. Migración aplicada, auto-combine en watchdog, SplitOrderModal, OrderChip con 🔗.
- **Archivos:** `watchdog-pickd/supabase_client.py`, `watchdog-pickd/watcher.py`, `SplitOrderModal.tsx`, `OrderChip.tsx`, `OrderSidebar.tsx`, migración `20260317000001_add_combine_meta.sql`

### ~~2. Agrupación visual de órdenes FedEx/General (drag-and-drop)~~ — COMPLETADO <!-- id: idea-010b -->

- **Creado:** `[2026-03-18 16:00]` · **Completado:** `[2026-03-25]`
- **Estado:** En producción. Drag-and-drop con @dnd-kit en la verification queue.
- Agrupación visual (no merge de items): cada orden mantiene independencia pero se asocian para completarse juntas. Long-press (300ms) inicia drag, drop sobre otra orden abre GroupOrderModal para seleccionar tipo (FedEx/General). Batch completion: completar una orden del grupo completa todas. Group-aware returnToPicker y deleteList para lifecycle limpio.
- **Archivos:** migración `20260325000003_order_groups.sql`, `GroupOrderModal.tsx`, `useOrderGroups.ts`, `DoubleCheckHeader.tsx`, `PickingCartDrawer.tsx`, `usePickingActions.ts`, `useDoubleCheckList.ts`, `usePickingSync.ts`

### ~~3. 📦 Distribución física inteligente~~ — COMPLETADO <!-- id: idea-015 -->

- **Creado:** `[2026-03-18 17:00]` · **Completado:** `[2026-03-25]`
- **Estado:** Implementado — auto-distribución inteligente para SKUs de bicicleta.
- SKUs de bicicleta (formato `NN-NNNNWW+`, ej: `03-4703GY`) se distribuyen automáticamente: TOWER×30, LINE×5, LINE×residuo. Non-bike SKUs mantienen el default anterior (1 TOWER×qty).
- **Triggers:** INSERT (trigger DB), move sin merge (trigger DB), move con merge (recálculo en `move_inventory_stock`). Frontend auto-fill en InventoryModal (add mode) y preview en MovementModal.
- **Archivos:** migración `20260325000002_smart_bike_distribution.sql`, `src/utils/distributionCalculator.ts`, `InventoryModal.tsx`, `MovementModal.tsx`

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

### ~~7. Preservar `internal_note` al mover item entre locations (Stock View)~~ — COMPLETADO <!-- id: idea-017 -->

- **Creado:** `[2026-03-24 10:00]` · **Completado:** `[2026-03-25]`
- **Estado:** Implementado — nota interna se preserva en moves y se restaura en undo.
- **Move sin merge:** destino hereda `internal_note` automáticamente vía `move_inventory_stock` (parámetro `p_internal_note`).
- **Move con merge:** `NoteResolutionDialog` en MovementModal permite elegir nota origen, destino, o combinar ambas.
- **Undo:** `undo_inventory_action` restaura `internal_note` desde `snapshot_before`.
- **Archivos:** migración `20260325000001_preserve_internal_note_on_move.sql`, `MovementModal.tsx`, `InventoryScreen.tsx`, `useInventoryData.ts`, `useInventoryMutations.ts`, `inventory.service.ts`, `supabase/types.ts`

### ~~8. Override de cantidad de items por pallet (Double Check View)~~ — COMPLETADO <!-- id: idea-018 -->

- **Creado:** `[2026-03-24 10:00]` · **Completado:** `[2026-03-24]`
- **Estado:** En producción.
- Permitir al usuario editar manualmente la cantidad de items en una pallet específica durante double-check. Es un override local para esa orden, no persiste para futuras órdenes.
- **Comportamiento esperado:**
  - El usuario cambia la cantidad en una pallet → los items sobrantes o faltantes se redistribuyen automáticamente en las demás pallets siguiendo la lógica original de distribución.
  - Una pallet cuya cantidad fue editada manualmente por el usuario queda "bloqueada" — la redistribución automática nunca modifica pallets con override del usuario.
- **Archivos estimados:** `DoubleCheckView.tsx`, lógica de distribución de pallets.

### ~~9. Sumar peso de pallets al peso total de la orden en label (Orders View)~~ — COMPLETADO <!-- id: idea-019 -->

- **Creado:** `[2026-03-24 10:00]` · **Completado:** `[2026-03-24]`
- **Estado:** En producción.
- El peso total de la orden actualmente solo suma el peso de los items. Falta sumar el peso de las pallets: `peso total = peso items + (número de pallets × 40 lbs)`.
- **Archivos estimados:** `PalletLabelsPrinter.tsx` o componente de label de orden donde se calcula el peso total.

### ~~10. Auto-parse de dirección completa en campo address (Orders View)~~ — COMPLETADO <!-- id: idea-020 -->

- **Creado:** `[2026-03-24 10:00]` · **Completado:** `[2026-03-24]`
- **Estado:** En producción.
- Cuando el usuario pega una dirección completa (ej: "123 Main St, Miami, FL 33101") en el campo `address`, el sistema debe parsear automáticamente y llenar `city`, `state`, `zip`.
- **Restricciones:**
  - Solo formato US.
  - Si los campos destino ya tienen valores, se sobreescriben al pegar.
- **Archivos estimados:** Componente de edición de orden en Orders View, nueva utilidad de parsing de dirección US.

---

## Prioridad 2 — Impacto Medio (mejoras de conveniencia)

- [ ] **Barcode/QR Integration**: Scan items directly. <!-- id: idea-001 -->
- [ ] **Order List View**: When reviewing orders, show the picking list first with an option to print. <!-- id: idea-006 -->
- [ ] **Automatic Inventory Email**: Send full inventory table to Jamis's email. Plain list only, NO links. <!-- id: idea-007 -->
- [x] ~~**Order Merging**: Combine 2 separate orders into one picking session.~~ — Cubierto por task-007 (auto-combine same shop) + idea-010b (drag-and-drop grouping). <!-- id: idea-010 -->
- [ ] **Multi-Address Customers**: Handle multiple shipping/billing addresses per client. <!-- id: idea-012 -->
- [ ] **Inventory Heatmaps**: Visualize picking frequency. <!-- id: idea-002 -->
- [ ] **Advanced Analytics**: Dashboard for warehouse efficiency. <!-- id: idea-003 -->
- [ ] **Smart Rebalancing**: Suggestions to move stock between warehouses. <!-- id: idea-004 -->
- [ ] **Persistent Preferences**: Remember user warehouse choices. <!-- id: idea-005 -->

---

## 🐛 Bug Tracker

### Bugs confirmados en producción (actualizado 2026-03-23)

- [x] **[bug-002] Undo borra en vez de mover** — `[2026-03-21]` · **Fix:** `[2026-03-23]`
      Dos bugs encadenados: (1) `move_inventory_stock` construía el snapshot manualmente con `jsonb_build_object` usando qty post-move (=0) y sin distribution/item_name/is_active/location_id. (2) `undo_inventory_action` no restauraba la columna `distribution`. Fix: snapshot ahora usa `row_to_json(inventory.*)` pre-move, y undo restaura distribution con fallback para logs legacy.
      **Archivos:** migración `20260323000001_fix_undo_move_restore_distribution.sql` — redefine ambos RPCs.

- [x] **[bug-003] Watcher envía items con qty=0** — `[2026-03-21]` · **Fix:** `[2026-03-23]`
      El watchdog-pickd elegía locations por prioridad (PALLET>LINE>TOWER) sin verificar stock. Ahora filtra candidatos con qty=0 antes de ordenar: si hay stock en otra location, salta a esa; si qty=0 en todas, deja `location=None` + `insufficient_stock=True` para que el frontend muestre la alerta.
      **Archivos:** `watchdog-pickd/supabase_client.py` → `_to_cart_items()` (líneas 500-523).

- [x] **[bug-004] Órdenes duplicadas al retroceder de double-check a building** — `[2026-03-21]` · **Fix:** `[2026-03-23]`
      `returnToBuilding()` nulleaba `activeListId`, perdiendo la referencia al registro DB. Al generar path de nuevo, `generatePickingPath()` siempre hacía INSERT creando un duplicado. Fix: preservar `activeListId` al volver de double-check, y hacer UPDATE del registro existente en vez de INSERT. También se excluye la lista actual del cálculo de reservaciones para evitar falsos conflictos de stock.
      **Archivos:** `PickingContext.tsx` → `returnToBuilding()`, `usePickingActions.ts` → `generatePickingPath()`.

- [x] **[bug-005] Items con qty=0 aparecen en double-check sin advertencia** — `[2026-03-21]` · **Fix:** `[2026-03-23]`
      La causa raíz era bug-003: el watcher asignaba locations con qty=0 y los flags `insufficient_stock` no se propagaban correctamente. El DoubleCheckView ya tenía el indicador rojo ("No inventory") — el problema era que los datos llegaban mal desde el watcher. Resuelto con el fix de bug-003.
      **Archivos:** No requirió cambios en frontend — fix upstream en `watchdog-pickd/supabase_client.py`.

- [x] **[bug-006] Orden completada reaparece desde estado original (watcher vs edición manual)** — `[2026-03-21]` · **Fix:** `[2026-03-23]`
      Causa raíz compartida con bug-004: `returnToBuilding()` creaba registros zombie en `active` que sobrevivían post-completion. El fix de bug-004 (preservar `activeListId` + UPDATE en vez de INSERT) elimina la creación de zombies. Adicionalmente, el watcher ya tenía protección: hash SHA-256 para PDFs duplicados, lookup por `order_number` antes de insertar, y `reopen_completed_order()` que hace UPDATE (no INSERT). `usePickingSync` también purga IDs stale que apuntan a órdenes completadas al recargar la app.
      **Archivos:** Mismo fix que bug-004 — no requirió cambios adicionales.

- [x] **[bug-007] Verification list no muestra órdenes ready_to_double_check >24h** — `[2026-03-25]` · **Fix:** `[2026-03-25]`
      El query de `useDoubleCheckList` tenía `.gt('updated_at', 24h)` que descartaba órdenes no tocadas en 24+ horas. También `takeOverOrder` no actualizaba `updated_at`, así que el takeover no "revivía" la orden. Fix: eliminar filtro de 24h (auto-cancel ya limpia stale orders), y takeover ahora actualiza `updated_at`.
      **Archivos:** `useDoubleCheckList.ts`, `usePickingActions.ts`

- [ ] **Offline Sync Edge Cases**: Handle complex rollback scenarios in InventoryProvider. <!-- id: bug-001 -->

---

## ✅ Completado

### Items con detalle

| Item                                                        | Creado         | Completado           | Estado                                                               |
| ----------------------------------------------------------- | -------------- | -------------------- | -------------------------------------------------------------------- |
| Fix: undo move pierde qty y distribution (bug-002)          | `[2026-03-21]` | `[2026-03-23]`       | Completado — snapshot con `row_to_json` + undo restaura distribution |
| Fix: watcher asigna location con qty=0 (bug-003 + bug-005)  | `[2026-03-21]` | `[2026-03-23]`       | Completado — filtro qty>0 en `_to_cart_items()`                      |
| Fix: órdenes duplicadas al volver de double-check (bug-004) | `[2026-03-21]` | `[2026-03-23]`       | Completado — preservar activeListId + UPDATE en vez de INSERT        |
| Fix: orden completada reaparece (bug-006)                   | `[2026-03-21]` | `[2026-03-23]`       | Completado — misma raíz que bug-004, watcher ya tenía protección     |
| Peso de pallets en peso total de label (idea-019)           | `[2026-03-24]` | `[2026-03-24]`       | Completado — +40 lbs por pallet al peso total                        |
| Auto-parse de dirección US (idea-020)                       | `[2026-03-24]` | `[2026-03-24]`       | Completado — pegar dirección completa auto-llena city/state/zip      |
| Override cantidad por pallet en double-check (idea-018)     | `[2026-03-24]` | `[2026-03-24]`       | Completado — override manual + redistribución automática             |
| Preservar internal_note en moves (idea-017)                 | `[2026-03-24]` | `[2026-03-25]`       | Completado — herencia auto, diálogo merge, undo restore              |
| Distribución física inteligente para bikes (idea-015)       | `[2026-03-18]` | `[2026-03-25]`       | Completado — TOWER×30, LINE×5, LINE×residuo; trigger + frontend      |
| Agrupación visual de órdenes FedEx/General (idea-010b)      | `[2026-03-18]` | `[2026-03-25]`       | Completado — DnD grouping, batch completion, group lifecycle         |
| Backfill distribución para items legacy (idea-015b)         | `[2026-03-25]` | `[2026-03-25]`       | Completado — auto-gen para items sin dist, TOWER<16→LINE             |
| 25 errores TypeScript strict-mode corregidos                | `[2026-03-25]` | `[2026-03-25]`       | Completado — AutocompleteInput genérico, casts en tests, etc.        |
| Unidades en vez de SKUs en combined orders (OrderSidebar)   | `[2026-03-25]` | `[2026-03-25]`       | Completado — muestra unit count por orden fuente                     |
| Parser robusto de direcciones US con fuzzy matching         | `[2026-03-25]` | `[2026-03-25]`       | Completado — parseUSAddress.ts con sufijos completos + abreviados    |
| Fix: verification list no mostraba órdenes >24h (bug-007)   | `[2026-03-25]` | `[2026-03-25]`       | Completado — eliminado filtro 24h, takeover actualiza updated_at     |
| Order number en label de pallets                            | `[2026-03-11]` | `[2026-03-11 14:28]` | Completado                                                           |
| Barra de capacidad de locations                             | `[2026-03-11]` | `[2026-03-18 10:00]` | Resuelto (fix de performance)                                        |
| Takeover muestra picker real                                | `[2026-03-11]` | `[2026-03-13 13:12]` | Completado                                                           |
| Auto-inicio watchdog-pickd                                  | `[2026-03-11]` | `[2026-03-18 09:30]` | Completado (launchd service)                                         |
| Stock Printing (filtros + nueva tab)                        | —              | —                    | Completado                                                           |
| iOS Pull-to-Refresh                                         | —              | —                    | Completado                                                           |
| Stock View Enhancements & History Fix                       | —              | —                    | Completado                                                           |
| Multi-user Support (Realtime takeover)                      | —              | —                    | Completado                                                           |
| TypeScript Core Migration                                   | —              | —                    | Completado                                                           |
| Robust Realtime System                                      | —              | —                    | Completado                                                           |
| Dual-Provider AI (Gemini + OpenAI)                          | —              | —                    | Completado                                                           |
| Full English Localization                                   | —              | —                    | Completado                                                           |
| Management Setup (.agent/)                                  | —              | —                    | Completado                                                           |
| Warehouse Selection Basic                                   | —              | —                    | Completado                                                           |

### Descartado

| Item                                                       | Razón                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Sesión de warehouse: inactividad 5min + selector de perfil | No aplica — cada picker usa su propio dispositivo. `[2026-03-18]` |

### Verificado en código

| Mejora                                     | Fecha          | Evidencia                                             |
| ------------------------------------------ | -------------- | ----------------------------------------------------- |
| Orden completada no regresa a double-check | `[2026-03-11]` | Guards `.neq('status', 'completed')` + botón X oculto |
| Order number en label de impresión         | `[2026-03-11]` | `PalletLabelsPrinter.tsx:111-116`                     |
| Jalar medidas al seleccionar item          | `[2026-03-11]` | `InventoryModal.tsx:471-475` auto-fill                |
| Buscador de locations mantiene opciones    | `[2026-03-11]` | `AutocompleteInput.tsx`                               |
| Persistencia de nueva location al agregar  | `[2026-03-11]` | `useLocationManagement.ts`                            |
| Order number clickeable en History         | `[2026-03-11]` | `HistoryScreen.tsx:570-580`                           |
| Validación de items con 0 unidades         | `[2026-03-11]` | `InventoryModal.tsx:291-298`                          |
| Consolidation: desglose multi-tipo         | `[2026-03-10]` | `adjust_distribution()` + `pickPlanMap`               |
| Limpieza distribution stale (qty=0)        | `[2026-03-11]` | Migración `20260311000001`                            |
| Picked by / Checked by                     | `[2026-03-11]` | `DoubleCheckHeader.tsx`, `PickingSummaryModal.tsx`    |
| Long-press → modal detalle + Edit          | `[2026-03-11]` | `DoubleCheckView.tsx`                                 |
| Performance: memoize + stabilize refs      | `[2026-03-11]` | `AuthContext`, `ViewModeContext`, etc.                |
| Fix: infinite re-render InventoryModal     | `[2026-03-11]` | `InventoryModal.tsx`                                  |
| Fix: infinite fetch loop distribution      | `[2026-03-10]` | Distribution editing flow                             |
| Test: distribution e2e + realtime          | `[2026-03-10]` | E2E tests                                             |
| Script: prod→local data sync               | `[2026-03-11]` | `scripts/sync-local-db.sh`                            |

---
