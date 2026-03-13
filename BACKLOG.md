# Roman-app — Backlog de Mejoras

> Mejoras pendientes ordenadas por impacto en el usuario final.
> Actualizado: 2026-03-11 15:00 EDT
>
> **Formato:** cada item incluye `[fecha hora]` de creación para trazabilidad.

---

## Prioridad 1 — Impacto Alto (operación diaria / integridad de datos)

### 1. Combinar órdenes del mismo shop
- **Creado:** `[2026-03-11 10:00]`
- **Estado:** Por hacer.
- Permitir **combinar varias órdenes** cuando pertenecen al mismo shop, consolidando sus items en una sola orden.
- **Impacto:** reduce trabajo duplicado de picking y verificación; ahorra tiempo significativo en el día a día.

### 2. Order number en label de pallets (vista de órdenes) — COMPLETADO
- **Creado:** `[2026-03-11 10:00]` · **Completado:** `[2026-03-11 14:28]`
- **Estado:** Completado.
- `ORDER #:` agregado en Page A del PDF de la vista de órdenes, debajo de la dirección y encima de PALLETS/UNITS/LOAD.
- **Archivo:** `OrdersScreen.tsx:413`

### 3. Barra de capacidad de locations no refleja correctamente el uso
- **Creado:** `[2026-03-11 10:00]`
- **Estado:** Regresión — funcionaba correctamente hace ~4 semanas.
- La barra de progreso de capacidad (actual vs total) **no se actualiza correctamente en ninguna location** (no solo row 18, aplica a todas).
- **Impacto:** el equipo no puede confiar en la capacidad reportada; decisiones de almacenamiento se toman a ciegas.

### 4. Sesión de warehouse: inactividad 5min + selector de perfil
- **Creado:** `[2026-03-11 10:00]`
- **Estado:** Por hacer.
- La cuenta de warehouse debe bloquearse tras **5 minutos de inactividad**.
- Al reactivarse, mostrar un **selector de perfil sin contraseña**.
- **Impacto:** actualmente cualquiera puede operar bajo la sesión de otro usuario sin que se registre quién hizo qué.

### 5. Takeover muestra al picker real en vez de "Warehouse Team"
- **Creado:** `[2026-03-11 15:30]`
- **Estado:** Por hacer.
- Cuando alguien hace takeover de una orden, el sistema debe registrar y mostrar el nombre de esa persona como "Picked by" en vez del genérico "Warehouse Team".
- **Impacto:** trazabilidad completa de quién recogió cada orden.

### 6. Vista de reporte diario por usuario de almacén
- **Creado:** `[2026-03-11 15:30]`
- **Estado:** Por hacer.
- Nueva vista tipo dashboard para un rol de supervisión/gerencia que muestre la actividad diaria de cada usuario del almacén: órdenes pickeadas, verificadas, items movidos, y cualquier otra métrica derivada de los movimientos registrados.
- **Impacto:** visibilidad de productividad individual sin depender de reportes manuales; habilita un nuevo tipo de usuario (supervisor/manager).

---

## Prioridad 2 — Impacto Bajo (mejoras de conveniencia)

### 5. Auto-inicio del script al reiniciar laptop
- **Creado:** `[2026-03-11 10:00]`
- **Estado:** Por hacer.
- Configurar el script de sincronización para que se ejecute automáticamente al encender/reiniciar (launchd plist en macOS).
- **Impacto:** evita olvido manual; solo afecta al admin.

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
