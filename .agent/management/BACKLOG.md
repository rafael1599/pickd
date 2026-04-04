# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-04-03

---

## P1 — Alto (operación diaria)

### 8. Sub-locations alfabéticas por ROW <!-- id: idea-024 -->
- **Problema:** ROWs sin subdivisiones. Picker recorre toda la fila buscando un SKU.
- **Solución:** Nueva columna `sublocation` (varchar, nullable). Display: `ROW 5A`. Backward compatible.

### ~~9. Multi-Address Customers~~ <!-- id: idea-012 --> ✅
- ~~Implementado: tabla `customer_addresses` con dedup normalizada, dropdown autocomplete en OrderSidebar, auto-save al imprimir.~~

### 19. Auto-cancel → expiración con reactivación <!-- id: idea-031 -->
- **Problema:** Auto-cancel a 15min/24hrs sin aviso. Órdenes legítimas desaparecen.
- **Solución:** Nuevo estado `expired` a 3 días. Visible, reactivable con un tap. Eliminar timer 15min.

### ~~14. Separar peso de dimensiones + defaults para partes~~ <!-- id: idea-025 --> ✅
- ~~Implementado: defaults dinámicos por tipo (bikes vs partes), migración aplicada.~~

### 20. Verification Queue — Split View con drag & drop <!-- id: idea-037 -->
- **Problema:** La verification list es una sola columna que mezcla órdenes regulares y FedEx. Combinar/separar órdenes requiere múltiples taps.
- **Solución:** Vista full-width dividida en dos columnas: izquierda FedEx (fondo purple translúcido), derecha regulares (fondo green translúcido). Arriba las pendientes, abajo las 3 últimas completadas por lado. Drag & drop para mover entre lados y combinar. Lógica de combinación extraída como módulo reutilizable.
- **Requiere:** Investigación profunda de la lógica de agrupación/combinación actual (useOrderGroups, combine_meta, GroupOrderModal, DoubleCheckHeader drag) para separar la lógica compartida de la específica por tipo.

### 15. Distribution type "Other" → texto libre <!-- id: idea-026 -->
- **Problema:** OTHER muestra "unit/units" genérico.
- **Solución:** Text input para nombre custom ("Box", "Crate"). Se guarda en distribution JSONB.

### ~~16. Labels — "Units" → "Bikes" + partes separadas~~ <!-- id: idea-027 --> ✅
- ~~Implementado: labels muestran BIKES: X y PARTS: Y por separado.~~

### ~~17. Peso por parte en Orders~~ <!-- id: idea-028 --> ✅
- ~~Implementado: editor inline de peso por parte debajo del label preview.~~

### ~~18. Badge peso y dimensiones en Stock View~~ <!-- id: idea-029 --> ✅
- ~~Implementado: badges condicionales (solo si > 0), peso visible en mobile.~~

---

## P2 — Medio (conveniencia)

- [ ] **Orders mobile UX overhaul** — Customer info colapsable, search visible, hide desktop-only buttons. <!-- id: idea-033 -->
- [ ] **Orders PDF preview full-width mobile** — `w-full` en mobile. <!-- id: idea-034 -->
- [ ] **Order List View** — Picking list first with print option. <!-- id: idea-006 -->
- [ ] **Automatic Inventory Email** — Edge function `send-daily-report` + query + cron. <!-- id: idea-007 -->
- [ ] **Fotos Fase 3 — Bulk Upload** — Multi-file picker, batching, progress bar. <!-- id: idea-023-p3 -->
- [ ] **Migrar cron jobs a pg_cron** — Elimina dependencia de GitHub Actions. <!-- id: idea-030 -->
- [ ] **History en perfil** — Vista de órdenes completadas/canceladas del usuario. <!-- id: idea-035 -->
- [x] ~~**Double check: distribución no refresca picking path** — Fix: re-fetch `skuInventoryMap` después de `updateItem` en `onSave`.~~ <!-- id: bug-014 -->
- [x] ~~**Reemplazar Edit Item por ItemDetailView** — Eliminado InventoryModal (1099 LOC). DoubleCheckView y StockCountScreen ahora usan ItemDetailView.~~ <!-- id: idea-036 -->

---

## Bugs pendientes

- [ ] **[bug-013]** Teclado aparece al abrir orden desde Verification Queue — Fix en develop `51e55a5`, pendiente confirmar mobile.
- [ ] **[bug-009]** Address parser falla con calles numéricas + direccionales — `parseUSAddress.ts`, agregar fallback newline.

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
