# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-04-22 (añadido idea-067 Add On Phase 2)

---

## P1 — Alto (operación diaria)

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
- **Archivos a tocar:** `OrdersScreen.tsx` (handler), `usePickingSync.ts` (merge photos de siblings), `DoubleCheckView.tsx` (visual split photos + badge + validación), `usePickingActions.ts` (hook `completeAddOnGroup`, `cancelAddOn`), `PickingContext.tsx` (entry point), nueva migración SQL. Mantener `AddOnOrderPicker.tsx` y `ReasonPicker.tsx` tal cual (de PR cerrada #14).
- **Edge cases a resolver:**
  - Auto-cancel 2h sobre reopened con `group_id` → debe limpiar grupo también (modificar `auto_cancel_stale_reopened`).
  - Completion atomicity: RPC en transacción BEGIN/EXCEPTION/ROLLBACK.
  - Insufficient stock en SKU nuevo del add-on → validar en la RPC antes de aplicar deltas.
  - Shipping type: heredar del target, bloquear auto-reclassify en re-complete.
  - Watchdog auto-combine del mismo customer durante add-on → ya mitigado en Fase 1 (trigger excluye reopened).
- **Test matrix resumido:**
  - F1-F5: flujo happy path (remove item completado → stock sube, adjust qty delta correcto, agregar SKU nuevo, sin cambios, 3+ orders en grupo).
  - M1: target con `checked_by ≠ null` → rechazado.
  - P1-P3: fotos viejas visibles, ≥1 nueva requerida, delete de fotos viejas bloqueado.
  - A1: auto-cancel 2h → reopened revert + group_id NULL ambos.
  - R1-R5: regresión de reopen normal, merge regular, grouped view sin addon, complete simple, cancel reopen.
- **Deferrable a Fase 3:** hardening de `takeOverOrder` (checked_by divergente), scoping realtime por group_id, RPC `lock_group_for_check` atomic.
- **Análisis completo:** conversación 2026-04-22 (sesión claude/addon-db-prereqs). Cerrada PR #14 (merge visual incompleto).

### 43. Orders view — UX/UI rework <!-- id: idea-065 -->
- **Problema:** La vista `/orders` tiene varios pain points:
  1. El **encabezado de PickD desaparece** en esta ruta. Debería estar siempre presente (consistencia con el resto de la app).
  2. El **LivePrintPreview** tintea toda la card según el carrier — los colores saturados (naranja FedEx, morado FedEx Ground, etc.) se ven chillones y rompen la estética general.
  3. La asignación visual del carrier al label no es clara — no hay un logo del carrier identificable a simple vista.
  4. En general, la densidad y jerarquía visual no son lo suficientemente minimalistas comparado con el resto del sistema.
- **Solución propuesta:**
  - Mantener el header global de PickD visible en `/orders` (revisar `AppShell` / layout wrapper — la ruta probablemente lo está ocultando con un `hidden` condicional).
  - **Invertir el uso del color del carrier:** el color vivo va al **fondo del preview card** con un overlay glass oscuro (matching el glassmorphism del resto — `bg-card/80 backdrop-blur-xl`). El contenido (texto del label) queda legible sin competir con el color.
  - **Logo del carrier** debajo del label impreso (FedEx / UPS / USPS / Regular), no como fondo inline. Tamaño discreto, en grayscale si el fondo ya expresa el carrier.
  - Pasar a un estilo más minimalista: menos chrome, más whitespace, tipografía consistente con el dashboard.
- **Requiere:**
  - Inventariar qué componentes de la ruta están ocultando el header (OrdersScreen, LivePrintPreview, PickingSessionView).
  - Definir paleta por carrier (hex del fondo + versión glass) y resolver assets de logos (probablemente SVG) — ver si ya existen en `public/` o hay que agregarlos.
  - Evaluar si el rework afecta el PDF de labels existente (`jsPDF` en LivePrintPreview) o solo la preview en pantalla.

### ~~37. Activity Report → PDF export~~ <!-- id: idea-059-pdf --> ✅ 2026-04-21
- Botón "Download PDF" en `/activity-report` con imágenes **full-resolution** (gallery + pallet photos). Client-side via `jsPDF` + `html2canvas` (dynamic import para no inflar el bundle de entrada — chunk se carga solo al click). Filename `activity-report-YYYY-MM-DD.pdf`.
- **Cambios:** `useProjectReportData.ts` ahora trae `url` además de `thumbnail_url`; `BucketTask.photo_fullsize[]` paralelo a `photo_thumbnails[]`. `ActivityReportView` acepta prop `printMode` que swap-ea a full-res, expande Team Detail, y añade `crossOrigin="anonymous"` para CORS. Utilidad `exportReportPdf.tsx` renderiza el view off-screen, espera `<img>` loads, html2canvas → jsPDF multi-página A4.
- **Mantenido:** "Save & Copy Report" intacto (sin imágenes, para email). PDF es acción separada.
- **Nota:** El id `idea-059` colisiona con el id de "Pallet photos en reporte" (`main` BACKLOG — ya done). Usado sufijo `-pdf` aquí para evitar duplicado.

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
- [x] ~~**Automatic Inventory Email**~~ ❌ 2026-04-22 — Retirado. Función `send-daily-report` nunca se usó en operación diaria; eliminada del código y del runtime de prod para cerrar endpoint sin auth interna. R2 snapshot upload sigue activo vía `daily-snapshot`. <!-- id: idea-007 -->
- [x] ~~**Fotos Fase 3 — Bulk Upload**~~ ✅ 2026-04-16 — Multi-file picker en gallery (`multiple` attr), uploads paralelos con throttling=3, progress bar `Uploading X of Y` + conteo de errores. `uploadBulk` usa `mutateAsync` + worker pool. Cámara queda single. <!-- id: idea-023-p3 -->
- [ ] **Migrar cron jobs a pg_cron** — Elimina dependencia de GitHub Actions. <!-- id: idea-030 -->
- [ ] **FedEx Returns — "Add Item" → "Return to Stock"** — Renombrar el botón/acción `Add Item` en `src/features/fedex-returns/` (ver `AddItemSheet.tsx`) a `Return to Stock` para reflejar mejor la intención del flujo (el item regresa al inventario, no se "agrega" como si fuera nuevo). <!-- id: idea-066 -->
- [ ] **Bike/Part/Unknown selector en "New Item"** — Al registrar un SKU nuevo, el form debe forzar la selección manual de tipo (Bike / Part / Unknown). Hoy `is_bike` queda en `false` por default y el picker no tiene manera de clasificarlo. Sirve de respaldo cuando la heurística de prefijo "03-" falle (bikes con prefijos distintos o parts registradas con prefijo 03-). Tocar `UnifiedForm` / `register_new_sku` RPC para persistir el flag. <!-- id: idea-068 -->
- [ ] **Remaining qty display en Picking Summary (post-deduct)** — Tras completar una orden, en `PickingSummaryModal` mostrar bajo cada SKU "Remaining: N" con el stock warehouse-wide (suma de `inventory.quantity` activo) resultante después del deduct. Solo lectura, no bloquea nada. <!-- id: idea-069 -->
- [ ] **Low-stock tracking para reporte** — Al completar una orden, capturar el remanente warehouse-wide por SKU. SKUs que queden en ≤1 unidad se marcan como "last unit" / "out of stock" para el daily report. No se muestra inline al usuario, solo se registra/expone para reporting. <!-- id: idea-070 -->
- [ ] **Activity Report — low-stock en "On the floor"** — Extender la sección "On the floor" del daily report para incluir SKUs que quedaron en ≤1 unidad hoy (out of stock en rojo, last unit en ámbar). Los viernes, acumular la lista de toda la semana dentro de la misma sección. <!-- id: idea-071 -->
- [x] ~~**Ghost trail audit — from_location + link a picking list**~~ ✅ 2026-04-24 — `useLastActivity` expone `list_id` y `formatLastActivity` incluye `from {location}`. El activity line de un SKU en qty=0 ahora es clickeable cuando hay `list_id` (abre PickingSummaryModal vía `setExternalOrderId`). <!-- id: idea-072 -->
- [x] ~~**Low-stock audit details — completions per SKU**~~ ✅ 2026-04-24 — `useLowStockAlerts` incluye `completions[]` por SKU (order_number, performed_by, from_location, quantity_change, prev→new qty, created_at). `LowStockAlertsBlock` renderiza una sub-línea por completion bajo cada SKU alertado. <!-- id: idea-073 -->

---

## P1 — Refinados (sesión 2026-04-16)

### ~~37. Pallet photos en reporte y orders~~ <!-- id: idea-059 --> ✅ 2026-04-16
- `458addb` Daily Report: nueva sección "PALLET PHOTOS" agrupada por order_number. OrdersScreen: thumbnails arriba del título en LivePrintPreview, clickeables a fullscreen via `PhotoLightbox` (nuevo en `src/components/ui/`).
- `0a38819` Fix crítico: pallet photo upload usaba SKU mode → fallaba silenciosamente en prod. Cambiado a gallery mode.
- `0abedf1` Add Photo desde PickingSummaryModal incluso después de completar la orden.

### ~~38. Print Label respeta orientación toggle~~ <!-- id: idea-060 --> ✅ 2026-04-16
- `58e6b69` Hook `useLabelLayoutPreference` con localStorage (`pickd-label-layout`). 5 entry points fixados (ItemDetailView, HistoryMode, LabelGen reprint+batch, UnifiedForm). LayoutToggle escribe al storage. Cross-tab sync via storage event.

### ~~39. Imágenes del reporte llegan a Gmail~~ <!-- id: idea-061 --> ✅ 2026-04-16
- `6a7cd24` `handleCopy` async: clona el reporte, fetcha cada `<img>` y la convierte a base64 data URI, escribe HTML al clipboard via `ClipboardItem`. Fallback a `execCommand` si falla. Loading state en botones.

### 40. Notas de proyecto siempre visibles (quitar line-clamp) <!-- id: idea-062 -->
- **Problema:** Hoy `line-clamp-2` recorta notas largas en task cards del kanban.
- **Solución:** Quitar `line-clamp-2` en `TaskCard` (`src/features/projects/ProjectsScreen.tsx`). Las cards crecen tanto como sea necesario para mostrar la nota completa.
- **Trivial.**

### ~~41. Galería de proyectos: Cámara o Galería del teléfono~~ <!-- id: idea-063 --> ✅ 2026-04-16
- `6a7cd24` Modal selector con dos opciones (Camera/Gallery), cada una dispara su propio `<input>` (con/sin `capture`). Modal mobile bottom-sheet, desktop centered.

### ~~42. Foto obligatoria antes de completar orden~~ <!-- id: idea-064 --> ✅ 2026-04-16
- `53a3b85` DoubleCheckView fetcha `pallet_photos` count al montar y trackea local. Si 0 fotos: banner amarillo + slide deshabilitado con texto "PHOTO REQUIRED TO COMPLETE". `e66339f` gate optimista (intent to take photo, no upload success).
- [x] ~~**FedEx default single group**~~ ✅ 2026-04-16 — Trigger `auto_group_fedex_orders` (migraciones `20260416220000` + `20260416230000`) auto-agrupa TODAS las órdenes FedEx activas en un solo grupo (cross-customer). Operacional: picker maneja todas las FedEx en un Double Check + completa-todo-de-un-jalón. Auto-clasifica server-side via `classify_picking_list_fedex` (join con `sku_metadata.weight_lbs`). 5/5 + 4/4 smoke tests. <!-- id: idea-057 -->
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
