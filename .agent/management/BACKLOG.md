# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-04-16 (compactado — 13 items archivados)

---

## P1 — Alto (operación diaria)

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
- **Consideraciones antes de implementar:** Investigar edge cases — ¿qué pasa si otro usuario modifica la orden mientras está cacheada? ¿Se necesita una columna `updated_at` más granular o un hash de versión? ¿Impacto en optimistic updates existentes? ¿Posible migración para agregar campo de versión/hash? Evaluar si TanStack Query `staleTime` + `structuralSharing` ya cubre parte del problema o si se necesita un cache layer adicional.
- **Requiere:** Análisis profundo antes de implementar.

### ~~36. Photo Gallery en Projects (4 fases)~~ <!-- id: idea-058 --> ✅ 2026-04-15
- `06d7de2` — Galería de fotos en Projects con captura de cámara, drag-to-assign a tasks (single + batch), trash 14d con restore, integración al Daily Activity Report. Tablas `gallery_photos` + `task_photos` (junction many-to-many). Edge function `upload-photo` extendida con modo `gallery: true`. Edge function `cleanup-gallery-trash` + cron 06:00 UTC. Hardening destructive ops (`fc14938`): confirmación 2-step para "Delete Forever", R2 cleanup antes de DB, fail-safe en cron.
- **Decisiones clave:** R2 paths `photos/gallery/{uuid}.webp`, soft delete via `deleted_at`, fotos en reportes son live query (no snapshot). Ver CLAUDE.md "Fotos (R2 + Edge Functions)".
- **Pendiente:** Migrar a `pg_cron` para cleanup (idea-030).

### ~~8. Sub-locations alfabéticas por ROW~~ <!-- id: idea-024 --> ✅ 2026-04-14
- Migración `20260414210000`: columna `sublocation` en `inventory` con CHECK constraints (`^[A-Z]{1,3}$`, solo `ROW%`), índice compuesto. RPC `move_inventory_stock` con `p_sublocation` y auto-clear en non-ROW. UI: chips en ItemDetailView/MovementModal, badge en InventoryCard/DoubleCheckView. Extendido a `string[]` (`6db7105` `f011085`) para múltiples sublocations por SKU.

### ~~15. Distribution type "Other" → texto libre~~ <!-- id: idea-026 --> ✅ 2026-04-14
- `204fb2d` — Text input para nombre custom ("Box", "Crate") en distribution JSONB. Inline editable label en InventoryCard.

### ~~20. Verification Queue — Split View con drag & drop~~ <!-- id: idea-037 --> ✅ 2026-04-13
- Absorbido por idea-055 (Verification Board Redesign).

### ~~35. Label Studio — personalización avanzada de SKU labels~~ <!-- id: idea-054 --> ✅ 2026-04-13
- 4 fases: LabelStudioScreen modular + UnifiedLabelForm + uFuzzy search → Inline SKU creation (`register_new_sku` RPC) + location obligatoria → Hybrid sync (`possible_locations text[]` + `resolve_tag_location` RPC) → Print + Edit Label desde ItemDetailView. Migraciones `20260413200000` y `20260413220000`.
- **Pendiente (extensiones futuras):** DoubleCheckView entry point, Receiving flow batch labels, Campos configurables, Phase 3.5 tags virtuales al completar orden, UI resolver location individual.

### ~~35b. Verification Board Redesign — multi-zone kanban~~ <!-- id: idea-055 --> ✅ 2026-04-13
- Full-screen overlay con 6 zonas: Priority, FedEx lane, Regular lane, In Progress Projects, Recently Completed, Waiting. Auto-clasificación `shipping_type` (>50lbs o ≥5 items → Regular). DnD: reclasificar/merge/waiting/reopen. Absorbe idea-037 + idea-053 fase 4. Plan: `~/.claude/plans/verification-queue-redesign.md`.

### ~~34. Long-Waiting Orders — orders que esperan inventario meses~~ <!-- id: idea-053 --> ✅ 2026-04-13
- Migración `20260410230000`: 3 columnas (`is_waiting_inventory`, `waiting_since`, `waiting_reason`), 3 RPCs admin-only, rama verification 24h de `auto_cancel_stale_orders` **eliminada**. UI: toggle waiting en verification queue, badge WAIT, "Mark as Waiting" con ReasonPicker. `WaitingConflictModal` para cross-customer SKU conflicts. Activity report con card "WAITING FOR INVENTORY". Plan: `~/.claude/plans/long-waiting-orders.md`.

---

## P2 — Medio (conveniencia)

- [ ] **Orders PDF preview full-width mobile** — `w-full` en mobile. <!-- id: idea-034 -->
- [ ] **Order List View** — Picking list first with print option. <!-- id: idea-006 -->
- [ ] **Automatic Inventory Email** — Edge function `send-daily-report` + query + cron. <!-- id: idea-007 -->
- [ ] **Fotos Fase 3 — Bulk Upload** — Multi-file picker, batching, progress bar. <!-- id: idea-023-p3 -->
- [ ] **Migrar cron jobs a pg_cron** — Elimina dependencia de GitHub Actions. <!-- id: idea-030 -->
- [x] ~~**FedEx default single group**~~ ✅ 2026-04-16 — Trigger `auto_group_fedex_orders` (migración `20260416220000`) auto-agrupa nuevas órdenes FedEx por `customer_id` con órdenes hermanas activas FedEx. Auto-clasifica server-side via `classify_picking_list_fedex` (join con `sku_metadata` para `weight_lbs > 50`). 5/5 smoke tests. <!-- id: idea-057 -->
- [x] ~~**Projects — drag to reorder priority**~~ ✅ 2026-04-15 — `0b85070` `c115c13` @dnd-kit/sortable within-column reorder con position persistence. <!-- id: idea-049 -->
- [x] ~~**Shopping List / Cosas por comprar**~~ ✅ 2026-04-14 — `dc2d19f` Vista compartida + PDF 4x6 térmico. <!-- id: idea-056 -->

---

## Inventory Audit — pendientes de revisión

- [ ] **ROW 10 — 6 SKUs sin sublocation confirmada** — `03-3718GY` (1), `03-3719GY` (1), `03-3817GY` (1), `03-3846BR` (5), `03-4201GN` (3), `03-4208GY` (1). Verificar físicamente si siguen en ROW 10 o deben moverse/desactivarse. <!-- audit-2026-04-15 -->

---

## Bugs pendientes

- [x] ~~**[bug-013]** Teclado aparece al abrir orden desde Verification Queue~~ — Fix `51e55a5` (overlay detection con `elementFromPoint()`). Pendiente: confirmar en mobile.

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
