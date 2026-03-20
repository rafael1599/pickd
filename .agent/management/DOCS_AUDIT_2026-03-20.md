# Documentation Audit — 2026-03-20

Auditoría de documentación vs código real (últimos 50 commits).

## Crítico (info incorrecta que confunde al agente)

### README.md (líneas 27-30)
- Dice que tiene Auto Palletization, Photo Verification y Global Undo
- Auto Palletization: solo cuenta items, no crea objetos Pallet
- Photo Verification: `PalletVerification.tsx` no existe
- Global Undo: solo funciona para inventory movements, no picking sessions
- **Acción:** corregir o mover a sección "Planned"

### ARCHITECTURE.md
- Referencias a archivos `.js` que ahora son `.ts` (líneas 102-103)
- No documenta features de picking, settings, ni warehouse-management
- MapBuilder descrito incorrectamente
- **Acción:** actualizar refs, agregar secciones faltantes

### .agent/roadmap/WAREHOUSE_SELECTION.md (líneas 299-314)
- Lista tareas como pendientes pero `processOrder()` ya acepta `warehousePreferences`
- TODOs en el doc están resueltos en código
- **Acción:** marcar como COMPLETED

### .agent/roadmap/SMART_PICKING.md (líneas 200-215)
- "Future Enhancements" que ya están implementadas:
  - Integración con shipping labels (PalletLabelsPrinter.tsx, commit 9495d4d)
  - Performance analytics (useOptimizationReports.ts)
- **Acción:** mover a "Implemented"

## Stale (completado pero docs no actualizados)

### .agent/management/BACKLOG.md (línea 16)
- "Combinar órdenes del mismo shop" marcado como pendiente prueba manual
- Ya está en producción: migración, SplitOrderModal, OrderChip con 🔗, watchdog auto-combine
- **Acción:** mover a sección ✅ Completado

### .agent/tasks/ (6 archivos)
- inventory_logging_final.md, inventory_logging_finalization.md, phase_1_foundation.md, phase_1_progress.md, phase_2_service_isolation.md, smart_logging_optimization.md
- Describen trabajo de fases anteriores como pendiente — todo ya está en producción
- **Acción:** archivar o eliminar

### .agent/roadmap/LOCATION_CRUD.md
- Describe feature como "New Functionality" pero useLocationManagement.ts ya existe
- CRUD funciona solo para custom locations (localStorage), no para inventory locations de DB
- **Acción:** actualizar status a PARTIAL, clarificar limitación

### .agent/roadmap/AUTOCOMPLETE_FEATURE.md
- Referencia `locationValidations.js` pero el archivo real es `.ts`
- **Acción:** actualizar referencias

## Archivar o eliminar

| Doc | Razón |
|-----|-------|
| .agent/roadmap/ANALISIS_UNDO_SYSTEM.md | Post-mortem del incidente 2026-03-09, no spec actual. Riesgo: lector piensa que existe modo offline-first |
| .agent/roadmap/ANALISIS_RESILIENCIA.md | Análisis histórico de problemas ya resueltos |
| .agent/knowledge/TOKEN_DRAINS.md | Vacío ("None recorded yet") — no aporta valor |

## Features sin documentar

Existen en código pero no tienen docs:

| Feature | Commit | Ubicación |
|---------|--------|-----------|
| claimAsPicker | c4e0b3e | usePickingActions.ts |
| Weight system (weight_lbs, inline edit, labels) | 04f3544, 9495d4d, 43690bc | sku_metadata, InventoryModal, PalletLabelsPrinter |
| Physical distribution logs | 978bd8c | inventory.schema.ts |
| Double Check UX refactor | 6694f3c | picking components |
| Picking notes / CorrectionNotesTimeline | implementation_plan Phase 4 | usePickingNotes.ts, CorrectionNotesTimeline.tsx |
| Prod→local data sync | 70e8444 | scripts/sync-local-db.sh |

## Notas generales

- Mezcla de idiomas (EN/ES) en docs
- Docs no tienen fecha de última actualización — difícil saber si están stale
- implementation_plan.md y BACKLOG.md tienen scope que se solapa
