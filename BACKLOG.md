# Roman-app — Backlog de Mejoras

> Mejoras pendientes ordenadas por impacto en el usuario final.
> Actualizado: 2026-03-18 10:00 EDT
>
> **Formato:** cada item incluye `[fecha hora]` de creación para trazabilidad.

---

## Prioridad 1 — Impacto Alto (operación diaria / integridad de datos)

### 1. Combinar órdenes del mismo shop — PENDIENTE PRUEBA MANUAL
- **Creado:** `[2026-03-11 10:00]` · **Desarrollado:** `[2026-03-18 09:00]`
- **Estado:** Desarrollado y desplegado — pendiente prueba manual en producción con órdenes reales del mismo cliente.
- Órdenes del mismo customer se combinan automáticamente en watchdog-pickd. Items se tagean con `source_order` para poder separarlas desde el UI con el Split Modal. Indicador 🔗 en OrderChip para órdenes combinadas.
- **Archivos:** `watchdog-pickd/supabase_client.py`, `watchdog-pickd/watcher.py`, `SplitOrderModal.tsx`, `OrderChip.tsx`, `OrderSidebar.tsx`, migración `20260317000001_add_combine_meta.sql`

### 2. Order number en label de pallets (vista de órdenes) — COMPLETADO
- **Creado:** `[2026-03-11 10:00]` · **Completado:** `[2026-03-11 14:28]`
- **Estado:** Completado.
- `ORDER #:` agregado en Page A del PDF de la vista de órdenes, debajo de la dirección y encima de PALLETS/UNITS/LOAD.
- **Archivo:** `OrdersScreen.tsx:413`

### 3. Barra de capacidad de locations no refleja correctamente el uso — RESUELTO
- **Creado:** `[2026-03-11 10:00]` · **Resuelto:** `[2026-03-18 10:00]`
- **Estado:** Resuelto — la regresión fue corregida por los fixes de performance (memoize contexts, infinite re-render fix) del 2026-03-11. Auditoría de DB local confirma que los datos de capacidad son consistentes y el cálculo del frontend coincide con la DB. Solo 2 locations (ROW 34, ROW 19B) tienen más stock que su max_capacity, lo cual es un tema operativo, no un bug.

### 4. Sesión de warehouse: inactividad 5min + selector de perfil — DESCARTADO
- **Creado:** `[2026-03-11 10:00]` · **Descartado:** `[2026-03-18 10:30]`
- **Estado:** Descartado — no aplica a la dinámica actual del almacén.
- Cada picker usa su propio dispositivo con su propia cuenta. La cuenta "warehouse" solo se usa en Bay 2 para el import automático de PDFs (watchdog-pickd). No hay rotación de tablets ni problema de identidad que resolver. Si la dinámica cambia en el futuro, se puede reconsiderar.

### 5. Takeover muestra al picker real en vez de "Warehouse Team" — COMPLETADO
- **Creado:** `[2026-03-11 15:30]` · **Completado:** `[2026-03-13 13:12]`
- **Estado:** Completado — pendiente prueba manual en producción.
- `claimAsPicker` actualiza el `user_id` al usuario real cuando alguien pickea una orden creada por script. Handlers unificados en `handleReleaseOrder`. Tests unitarios incluidos.
- **Archivos:** `usePickingActions.ts`, `PickingCartDrawer.tsx`, `PickingContext.tsx`, commit `c4e0b3e`

### 6. Vista de reporte diario por usuario de almacén
- **Creado:** `[2026-03-11 15:30]`
- **Estado:** Por hacer.
- Nueva vista tipo dashboard para un rol de supervisión/gerencia que muestre la actividad diaria de cada usuario del almacén: órdenes pickeadas, verificadas, items movidos, y cualquier otra métrica derivada de los movimientos registrados.
- **Impacto:** visibilidad de productividad individual sin depender de reportes manuales; habilita un nuevo tipo de usuario (supervisor/manager).

---

## Prioridad 2 — Impacto Bajo (mejoras de conveniencia)

### 5. Auto-inicio del script al reiniciar laptop — COMPLETADO
- **Creado:** `[2026-03-11 10:00]` · **Completado:** `[2026-03-18 09:30]`
- **Estado:** Completado.
- watchdog-pickd se instala como servicio launchd (`com.antigravity.watchdog-pickd`) con `RunAtLoad` y `KeepAlive`. Arranca solo al login y se resucita si muere.

---

## Ya Implementado (verificado en código)

| Mejora | Fecha completado | Evidencia |
|--------|-----------------|-----------|
| Orden completada no regresa a double-check | `[2026-03-11 14:28]` | Guards `.neq('status', 'completed')` + botón X oculto en `DoubleCheckView.tsx:306` |
| Order number en label de impresión | `[2026-03-11 14:28]` | `PalletLabelsPrinter.tsx:111-116` |
| Jalar medidas al seleccionar item del buscador | `[2026-03-11 14:28]` | `InventoryModal.tsx:471-475` auto-fill desde `sku_metadata` |
| Buscador de locations mantiene opciones visibles | `[2026-03-11 14:28]` | `AutocompleteInput.tsx` con modal mobile y dropdown desktop |
| Persistencia de nueva location al agregar item | `[2026-03-11 14:28]` | `useLocationManagement.ts` con auto-creación |
| Order number clickeable en History → preview picking | `[2026-03-11 08:47]` | `HistoryScreen.tsx:570-580`, commit `55926d1` |
| Validación de items con 0 unidades | `[2026-03-11 14:28]` | `InventoryModal.tsx:291-298` — traducido a inglés |
| Textos de la app en inglés | `[2026-03-11 14:28]` | `InventoryModal.tsx:296`, `HistoryScreen.tsx:1099` |
| Consolidation: desglose multi-tipo de picking | `[2026-03-10 21:05]` | Backend: `adjust_distribution()` migración `20260310000001`. Frontend: `pickPlanMap` en `DoubleCheckView.tsx` |
| Limpieza distribution stale (qty=0) | `[2026-03-11 13:57]` | Migración `20260311000001` + frontend ignora entries con qty=0 |
| Picked by / Checked by en Double Check y Summary | `[2026-03-11 14:28]` | `DoubleCheckHeader.tsx`, `PickingSummaryModal.tsx`, `OrdersScreen.tsx` |
| Long-press → modal detalle + Edit Item | `[2026-03-11 14:28]` | `DoubleCheckView.tsx` con `InventoryModal` integrado |
| Color Total Units en pallets | `[2026-03-11 14:28]` | `DoubleCheckView.tsx` — `text-blue-400` |
| Performance: memoize contexts + stabilize refs | `[2026-03-11 00:41]` | `AuthContext`, `ViewModeContext`, `useInventory`, `useLocationManagement` |
| Fix: infinite re-render InventoryModal | `[2026-03-11 00:08]` | `InventoryModal.tsx` |
| Fix: infinite fetch loop editing distribution | `[2026-03-10 22:49]` | Distribution editing flow |
| Test: distribution deduction e2e + realtime | `[2026-03-10 23:43]` | E2E tests para deducción de distribución |
| Script: prod→local data sync | `[2026-03-11 08:47]` | Script de sincronización de datos |

---
