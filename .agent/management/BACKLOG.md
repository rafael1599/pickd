# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-04-03

---

## P1 — Alto (operación diaria)

### 8. Sub-locations alfabéticas por ROW <!-- id: idea-024 -->
- **Problema:** ROWs sin subdivisiones. Picker recorre toda la fila buscando un SKU.
- **Solución:** Nueva columna `sublocation` (varchar, nullable). Display: `ROW 5A`. Backward compatible.

### 9. Multi-Address Customers <!-- id: idea-012 -->
- **Problema:** Un customer = una dirección. Si envía a dos sitios, hay que editar o duplicar.
- **Solución:** Nueva tabla `customer_addresses` con FK. Selector en OrderSidebar.

### 19. Auto-cancel → expiración con reactivación <!-- id: idea-031 -->
- **Problema:** Auto-cancel a 15min/24hrs sin aviso. Órdenes legítimas desaparecen.
- **Solución:** Nuevo estado `expired` a 3 días. Visible, reactivable con un tap. Eliminar timer 15min.

### 14. Separar peso de dimensiones + defaults para partes <!-- id: idea-025 -->
- **Problema:** Partes heredan defaults de bikes (54×8×30×45 lbs).
- **Solución:** Migración: partes a 0×0×0×0.1. Form defaults dinámicos por tipo.

### 15. Distribution type "Other" → texto libre <!-- id: idea-026 -->
- **Problema:** OTHER muestra "unit/units" genérico.
- **Solución:** Text input para nombre custom ("Box", "Crate"). Se guarda en distribution JSONB.

### 16. Labels — "Units" → "Bikes" + partes separadas <!-- id: idea-027 -->
- **Problema:** Labels no distinguen bikes de partes.
- **Solución:** Orden mixta: `BIKES: 15` + `PARTS: 3`. Solo bikes: `BIKES: N`.

### 17. Peso por parte en Orders <!-- id: idea-028 -->
- **Problema:** Partes con peso default 0.1 lbs. No hay dónde corregir.
- **Solución:** Sección "Parts Weight" editable debajo del label preview. Guarda en `sku_metadata`.

### 18. Badge peso y dimensiones en Stock View <!-- id: idea-029 -->
- **Problema:** Badge dimensiones con defaults incorrectos. Peso no visible.
- **Solución:** Badge solo si dimensiones > 0. Peso siempre visible. Mobile + desktop.

---

## P2 — Medio (conveniencia)

- [ ] **Orders mobile UX overhaul** — Customer info colapsable, search visible, hide desktop-only buttons. <!-- id: idea-033 -->
- [ ] **Orders PDF preview full-width mobile** — `w-full` en mobile. <!-- id: idea-034 -->
- [ ] **Order List View** — Picking list first with print option. <!-- id: idea-006 -->
- [ ] **Automatic Inventory Email** — Edge function `send-daily-report` + query + cron. <!-- id: idea-007 -->
- [ ] **Fotos Fase 3 — Bulk Upload** — Multi-file picker, batching, progress bar. <!-- id: idea-023-p3 -->
- [ ] **Migrar cron jobs a pg_cron** — Elimina dependencia de GitHub Actions. <!-- id: idea-030 -->
- [ ] **History en perfil** — Vista de órdenes completadas/canceladas del usuario. <!-- id: idea-035 -->

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
