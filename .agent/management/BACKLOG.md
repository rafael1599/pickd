# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-04-07 (noche)

---

## P1 — Alto (operación diaria)

### ~~21. Campos de bicicleta en `sku_metadata`~~ <!-- id: idea-042 --> ✅
- ~~Implementado: columnas `is_bike` y `upc` en `sku_metadata`. Migración pobló `is_bike` automáticamente desde SKUs existentes. Filtros de stock view usan `is_bike` en vez de location.~~

### ~~21a. Detección mejorada bike vs part~~ <!-- id: idea-038A --> ✅
- ~~Implementado: filtros e inventario usan `sku_metadata.is_bike` como fuente de verdad. Stats RPC filtra por `is_bike`. Regex como fallback final.~~

### 26. Mostrar notas en picking summary <!-- id: idea-044 -->
- **Problema:** Las notas de corrección (picking_list_notes) no se muestran en el resumen de picking. El picker/checker no ve el historial de cambios al revisar una orden.
- **Solución:** Incluir las notas relevantes en la vista de picking summary (OrdersScreen o label preview area).
- **Datos:** Tabla `picking_list_notes` ya tiene las notas con timestamps y usuario.

### 21b. Fallback manual BIKES/PARTS en labels <!-- id: idea-038B -->
- **Problema:** El conteo automático BIKES vs PARTS en pallet labels puede ser incorrecto y no hay forma de corregirlo.
- **Solución:** En la pantalla de labels/distribución, campos editables para que el picker corrija manualmente la cantidad de BIKES y PARTS según lo que ve en el piso.
- **Independiente** — no requiere cambios en DB.

### 22. Alerta de orden duplicada por cliente + reabrir <!-- id: idea-039 -->
- **Problema:** Cuando llega una orden nueva para un cliente cuya orden anterior ya fue completada, el picker no se entera y la procesa por separado.
- **Solución:** Al abrir una orden en la app, detectar si existe otra orden **completada** del mismo `customer_name`. Mostrar alerta con opción de reabrir la completada y mergear los items nuevos. Usa la lógica existente de `reopened` + snapshot tracking para no deducir dos veces items ya recogidos.
- **Ubicación:** En la app (al abrir la orden), no en watchdog.

### 23. Generador de SKU labels para bicicletas <!-- id: idea-040 -->
- **Problema:** No hay forma de generar etiquetas de SKU para bicicletas desde PickD.
- **Solución:** Label tipo JAMIS (6×4") con: marca, nombre del modelo (de `item_name`), SIZE, COLOR (parseados de `item_name`), UPC + barcode (de `sku_metadata.upc`), SKU grande al fondo.
- **Depende de:** idea-042 (campo `upc` en `sku_metadata`).
- **Infra existente:** jsPDF ya en el proyecto. Agregar librería de barcode (`bwip-js` o `jsbarcode`).
- **Pendiente definir:** Desde dónde se accede (InventoryCard, stock view, batch) y parser de `item_name` para extraer size/color.

### 24. Resumen diario de actividad por usuario (soft) <!-- id: idea-041 -->
- **Problema:** No hay resumen de lo que se hizo en el warehouse cada día. Se necesita para demostrar que se trabaja, sin exponer métricas de rendimiento individuales.
- **Tono:** Narrativo y suave. Rangos vagos ("procesó varias órdenes") en vez de números exactos. Sin comparativas entre usuarios.
- **Datos disponibles:** `inventory_logs` (picks, adds, moves por user_id), `picking_lists` (órdenes por user_id/checked_by), `cycle_count_sessions`, `picking_list_notes`.
- **Categorías sugeridas:** picking, receiving, warehouse organization, inventory verification.
- **Prerequisito:** Lluvia de ideas sobre formato, audiencia y frecuencia antes de implementar.

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
- **Investigación completada:** Análisis profundo de los 2 sistemas (groups vs combine_meta), archivos clave, módulos reutilizables identificados. Ver `memory/project_verification_queue_research.md`.

### 15. Distribution type "Other" → texto libre <!-- id: idea-026 -->
- **Problema:** OTHER muestra "unit/units" genérico.
- **Solución:** Text input para nombre custom ("Box", "Crate"). Se guarda en distribution JSONB.

### ~~16. Labels — "Units" → "Bikes" + partes separadas~~ <!-- id: idea-027 --> ✅
- ~~Implementado: labels muestran BIKES: X y PARTS: Y por separado.~~

### ~~17. Peso por parte en Orders~~ <!-- id: idea-028 --> ✅
- ~~Implementado: editor inline de peso por parte debajo del label preview.~~

### ~~18. Badge peso y dimensiones en Stock View~~ <!-- id: idea-029 --> ✅
- ~~Implementado: badges condicionales (solo si > 0), peso visible en mobile.~~

### ~~25. Notas de corrección interactivas + recovery de órdenes reopened~~ <!-- id: idea-043 --> ✅
- ~~Implementado: ReasonPicker con presets por tipo de acción (remove/swap/adjust/add/reopen). Notas ricas con razón ("Removed X: Out of stock"). Auto-detección de insufficient_stock pre-selecciona razón. Smart tip "use Replace instead" cuando se hace remove+add. Botón "Continue Editing" / "Take Over & Edit" para órdenes stuck en reopened. Reopen reason se pasa al RPC.~~

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
