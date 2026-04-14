# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-04-13 (compactado — 12 items archivados, 7 micro-compactados)

---

## P1 — Alto (operación diaria)

### ~~26. Mostrar notas en picking summary~~ <!-- id: idea-044 --> ✅ 2026-04-10
- Implementado: PickingSummaryModal rediseñado con accordion amber para notas de corrección. Cada nota muestra usuario, timestamp y mensaje. Colapsable, solo aparece si la orden tiene notas.

### ~~29. Estandarización visual completa~~ <!-- id: idea-046 --> ✅ 2026-04-08
- 4 fases: colors (`82bcfc8`) → z-index (`27cf781`) → overlays (`723e57e`) → picking screens (`f28c666`). Revert parcial: 6 modales restaurados a z-[150]/[200] (`7b23781`).

### 22. Alerta de orden duplicada por cliente + reabrir <!-- id: idea-039 --> (deprioritized)
- **Problema:** Cuando llega una orden nueva para un cliente cuya orden anterior ya fue completada, el picker no se entera y la procesa por separado.
- **Solución:** Detectar si existe otra orden completada del mismo `customer_name`. Mostrar alerta con opción de reabrir y mergear.
- **Estado:** Deprioritizado 2026-04-13. No es urgente — se maneja manualmente por ahora.

### ~~23. Generador de SKU labels para bicicletas~~ <!-- id: idea-040 --> ✅ 2026-04-09
- `7022cbd` — tabla `asset_tags` con sequence (PK-000001) + lifecycle (`printed/in_stock/allocated/picked/shipped/lost`), QR encoding `short_code|sku` (decisión deliberada vs UPC tradicional para trazabilidad por unidad física), labels 4×6" landscape (Side A/B), batch screen `/labels` con location selector + search, individual desde `ItemDetailView` three-dot menu (bikes only). Parser `parseBikeName` con 10 tests. Extendido por `8e1e5a0` (public tag view + anti-enumeration) y `e152d7a` (QR pallet scan en DoubleCheckView).

### 8. Sub-locations alfabéticas por ROW <!-- id: idea-024 -->
- **Problema:** ROWs sin subdivisiones. Picker recorre toda la fila buscando un SKU.
- **Solución:** Nueva columna `sublocation` (varchar, nullable). Display: `ROW 5A`. Backward compatible.

### ~~20. Verification Queue — Split View con drag & drop~~ <!-- id: idea-037 --> ✅ 2026-04-13
- Absorbido por idea-055 (Verification Board Redesign). Full-screen multi-zone kanban con drag & drop entre lanes FedEx/Regular/Waiting/Completed. `VerificationBoard.tsx` reemplaza el antiguo modal single-column.

### 15. Distribution type "Other" → texto libre <!-- id: idea-026 -->
- **Problema:** OTHER muestra "unit/units" genérico.
- **Solución:** Text input para nombre custom ("Box", "Crate"). Se guarda en distribution JSONB.

### ~~27. Daily Warehouse Activity Report — Refinamiento~~ <!-- id: idea-041 --> ✅ 2026-04-08
- `42ac9fd` `68950b6` — layout HTML email, secciones condicionales (WIN/UPDATES manuales + DONE/IN PROGRESS/ON THE FLOOR/COMING UP NEXT auto kanban), Inventory Accuracy KPI, correcciones del día desde `picking_list_notes`, team detail colapsable, Copy Report.

### ~~28. Reestructurar menú principal~~ <!-- id: idea-045 --> ✅ 2026-04-08
- `4afd94c` — hamburger reemplaza avatar, Warehouse Activities como contenido principal, profile sub-panel en footer, eliminado Export Inventory CSV (dead code).

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

### ~~33. Activity Report Phase 2 — Persistencia y lock~~ <!-- id: idea-052 --> ✅ 2026-04-10
- 4 fases: `f88a569` (tabla `daily_reports` + RLS + 3 RPCs) → `aa9b001` (edge function `daily-report-snapshot` + GitHub Actions cron `15 5 * * *`) → `84cdfa1` (hooks `useDailyReport`/`useSaveDailyReportManual` + ActivityReportScreen reescrito) → `77bad82` (polish: disabled inputs non-admin, beforeunload, Locked pill).
- **Decisiones clave (NO replantear):** save manual, RPC save-all (no patch per-field), LWW puro, fallo del cron = live compute silencioso, `task_buckets` se mantiene en JS cliente.
- **Validación pendiente:** primer cron run automático 05:15 UTC mañana o merge develop → main para `gh workflow run`.

### ~~35. Label Studio — personalización avanzada de SKU labels~~ <!-- id: idea-054 --> ✅ 2026-04-13
- **4 fases implementadas:**
  - **Phase 1:** LabelGeneratorScreen (1170 LOC) reescrito como LabelStudioScreen modular. Fusión create+custom en UnifiedLabelForm. uFuzzy search (4KB) con thumbnails y ranking. Toggle visual horizontal/vertical. Preview en vivo. History mode extraído como componente independiente.
  - **Phase 2:** Inline SKU creation (`register_new_sku` RPC). Location obligatoria (`asset_tags.location NOT NULL`). Auto-status `in_stock` cuando SKU tiene inventory. Botón "+ New" y "Create new SKU" en búsqueda sin resultados.
  - **Phase 3:** Hybrid sync — `possible_locations text[]` en asset_tags. `move_inventory_stock` sincroniza tags después de cada MOVE. `resolve_tag_location` RPC para confirmar location exacta al escanear. History tab muestra "Could be: ROW 15, ROW 43" en amber.
  - **Phase 4:** Print + Edit Label desde ItemDetailView (vista de producto). Qty picker con input editable + "All". "Edit in Studio" navega a /labels con SKU pre-llenado. Layout default vertical.
- **Migraciones:** `20260413200000` (register_new_sku + location NOT NULL), `20260413220000` (possible_locations + move sync + resolve_tag_location).
- **Archivos nuevos:** LabelStudioScreen, UnifiedLabelForm, HistoryMode, FuzzySearch, EntryList, LayoutToggle, LabelPreview, InlineSkuCreate + hooks: useLabelItems, useTagCounts, useFuzzySearch, useGenerateLabels, useQuickPrintLabel.
- **Pendiente (extensiones futuras):**
  - DoubleCheckView entry point (reprint label per item)
  - Receiving flow (batch labels)
  - Campos configurables (toggles show/hide fields, drag-and-drop reorder)
  - Phase 3.5: Tags virtuales al completar orden (shipping sync)
  - UI para resolver location de un tag individual (scan confirm)

### ~~35b. Verification Board Redesign — multi-zone kanban~~ <!-- id: idea-055 --> ✅ 2026-04-13
- Full-screen overlay con 6 zonas: Priority (auto, arriba), FedEx lane, Regular lane, In Progress Projects (read-only), Recently Completed (drag=reopen), Waiting (colapsable, scroll).
- Auto-clasificación `shipping_type`: item >50lbs → Regular, ≥5 items → Regular, else → FedEx. Persistido al drag-reclasificar o completar.
- DnD: drag→zone=reclasificar, drag→order=merge, drag→Waiting=prompt razón (admin), drag completada→lane=reopen con razón. Cross-lane confirmación.
- Absorbe idea-037 (split view) + idea-053 fase 4 (drag-to-waiting). Descarta idea-031 (nada expira).
- Plan: `~/.claude/plans/verification-queue-redesign.md`.

### ~~34. Long-Waiting Orders — orders que esperan inventario meses~~ <!-- id: idea-053 --> ✅ 2026-04-13
- Migración `20260410230000`: 3 columnas (`is_waiting_inventory`, `waiting_since`, `waiting_reason`), 3 RPCs admin-only (`mark_picking_list_waiting`, `unmark_picking_list_waiting`, `take_over_sku_from_waiting`), rama verification 24h de `auto_cancel_stale_orders` **eliminada**. 7/7 smoke tests.
- UI: toggle "Waiting for Inventory (N)" en verification queue (amber, colapsable), badge WAIT en order cards, botón "Mark as Waiting" con ReasonPicker (admin-only), "Resume"/"Cancel" cuando ya es waiting.
- Conflict resolution: `WaitingConflictModal` bloqueante detecta cross-customer SKU conflicts al abrir DoubleCheckView, con Take Over / Edit Order / Proceed Anyway.
- Activity report: card "WAITING FOR INVENTORY" con count condicional (live, no snapshotted).
- Plan formal: `~/.claude/plans/long-waiting-orders.md`.

### ~~32. Modal Manager — Context + root render pattern~~ <!-- id: idea-050 --> ✅ 2026-04-10
- `330bbcd` — `ModalContext` + `ModalProvider` en `LayoutMain` (root level), hook `useModal()`. Resuelve "ningún modal crítico vive dentro del componente que lo abre". `ItemDetailView` desde `DoubleCheckView` ya no se desmonta al cerrar el drawer. Documentado en `docs/modal-pattern.md` + `CLAUDE.md`.

---

## P2 — Medio (conveniencia)

- [ ] **Orders PDF preview full-width mobile** — `w-full` en mobile. <!-- id: idea-034 -->
- [ ] **Order List View** — Picking list first with print option. <!-- id: idea-006 -->
- [ ] **Automatic Inventory Email** — Edge function `send-daily-report` + query + cron. <!-- id: idea-007 -->
- [ ] **Fotos Fase 3 — Bulk Upload** — Multi-file picker, batching, progress bar. <!-- id: idea-023-p3 -->
- [ ] **Migrar cron jobs a pg_cron** — Elimina dependencia de GitHub Actions. <!-- id: idea-030 -->
- [ ] **Projects — drag to reorder priority** — En Coming Up Next y In Progress, arrastrar para reordenar. Más arriba = más prioridad. No se refleja en ningún otro lado por ahora, solo capacidad de reordenar dentro de cada columna. <!-- id: idea-049 -->
- [x] ~~**Activity Report — quitar la hora del header**~~ ✅ 2026-04-10 `35ff19c` <!-- id: idea-051 -->

---

## Bugs pendientes

- [x] ~~**[bug-013]** Teclado aparece al abrir orden desde Verification Queue~~ — Fix `51e55a5` (overlay detection con `elementFromPoint()`). Pendiente: confirmar en mobile.
- [x] ~~**[bug-009]** Address parser falla con calles numéricas + direccionales~~ ✅ 2026-04-10 — `parseFromLines` agrega newline-aware Strategy 0 en `parseUSAddress.ts`. Resuelve `"100 W 5TH\nBrooklyn, NY 11215"`. 33/33 tests passing.
- [x] ~~**[bug-015]** Menú de perfil se queda trabado~~ ✅ 2026-04-09/10 — `16b657a` reset `showProfile` en `navTo()` + useEffect, `6839114` saca `InventorySnapshotModal` del lifecycle del menú, `330bbcd` Modal Manager (idea-050).
- [x] ~~**[bug-016]** Projects/Activity Report — duplicación, missing direct-add, races~~ ✅ 2026-04-10 — `92cd477` dedupe + `4df57be` filtro `created_at` + `810290b` reconstrucción histórica desde `task_state_changes` + `960749e` NY tz bounds. Lógica pura en `historicalTaskStatus.ts` con 21 unit tests.
- [x] ~~**[bug-017]** `auto_cancel_stale_orders` creaba inventario fantasma~~ ✅ 2026-04-10
  - **Causa raíz:** rama verification (24h) llamaba `adjust_inventory_quantity` con `+qty` para "restorar" inventario. Premisa falsa: durante `ready_to_double_check`/`double_checking` el inventario está intacto (la deducción real solo pasa al transicionar a `completed`). Cada cron run añadía unidades fantasma.
  - **Fixes:** `0ffbe3d` (`create_daily_snapshot` filtra `location IS NOT NULL`) → `05cf9b2` (rama verification ya no toca inventario, 8 rows huérfanos eliminados) → migración `20260410130000` (`adjust_inventory_quantity` rechaza `delta>0 AND location NULL` como defensa permanente).
  - **Verificación física completada vía cycle count UI.** Conteos físicos divergieron del audit log para 3 SKUs → física es la verdad.
  - **Aprendizaje:** auto-cancel 24h en verification es conceptualmente equivocado → tracked como `idea-053`.

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
| Resumen diario soft per-user (ID original idea-041, conflicto con `/activity-report`) | Brainstorm orphan, sin commits. El team detail de `/activity-report` cubre el caso de "qué hizo cada usuario" — el tono narrativo soft no se considera necesario por ahora. |
| Auto-cancel → expiración (idea-031) | Nada expira; liberación manual. La rama verification 24h fue eliminada en idea-053. |
