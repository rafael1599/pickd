# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-05-21 (compactado — 30+ items archivados desde la última pasada).
> **Convención (operador, 2026-06-10):** cada idea nueva se registra con **fecha y hora**
> del input del operador (hora NY). Ideas previas a la convención llevan solo fecha.

---

## P1 — Alto (operación diaria)

### ~~53. SKU normalization at intake — close idea-092 path 1~~ <!-- id: idea-101 --> ✅ 2026-06-10 (watchdog #35 — premisa verificada como ya cubierta)
- **Resolución 2026-06-10:** verificado con tests que `_to_cart_items` del watchdog **ya matchea normalizado desde su commit inicial** (`034664BR` ↔ `03-4664BR` resuelve al canónico en el intake; no llega UNREG). El incidente que originó la idea fue un **typo de dígito** (4664 vs 4666) — correctamente manual, la normalización no adivina dígitos. Lo único que faltaba era la nota de riesgo del propio spec: **colisiones** (dos SKUs canónicos con la misma forma normalizada) se elegían en silencio; ahora se dejan sin resolver para que el picker decida (watchdog #35, equivale al contrato LIMIT-2 de `lookup_canonical_sku`). No hace falta llamar al RPC: la lógica local es equivalente y batched.
- **Hallazgo verificado 2026-05-01:** la flag `sku_not_found` se setea EN watchdog al ingestar el PDF (vive como campo dentro del JSONB `picking_lists.items`). Pickd la lee, nunca la escribe — confirmado en migraciones (`process_picking_list`, `reopen_completed_orders` solo leen) y en src/ (todas las refs en DoubleCheckView/CorrectionModeView son lecturas). Conclusión: **no hay un fallback client-side viable** para auto-corregir el guion. El item JSON es inmutable post-intake.
- **Síntoma operativo:** `034664BR` desde el PDF queda como UNREG en DoubleCheckView aunque `03-4664BR` exista en `sku_metadata`. El picker tiene que hacer click en "Use 03-4666BR instead" (botón ya entregado en idea-092 path 2). 100% determinístico, no debería requerir intervención manual.
- **Solución única:** path (1) de idea-092 — watchdog (otro repo `watchdog-pickd`) llama `lookup_canonical_sku(p_raw)` (RPC ya disponible en migración `20260430160000`) antes de armar `picking_lists.items`. Si match único, sustituye el SKU + registra la sustitución en `combine_meta` o `notes` para auditar. Si match múltiple, deja el original (ambiguous → manual).
- **Riesgo:** falsos positivos teóricos si dos SKUs canónicos comparten forma normalizada (ej. `034-666-BR` y `03-4666BR`). `register_new_sku` no normaliza al guardar y no hay CHECK constraint en `sku_metadata.sku`. La RPC ya tiene `LIMIT 2` y solo un `=` exacto sobre normalizados — devuelve >1 row si hay ambigüedad real, watchdog no auto-corrige en ese caso.
- **Fuera de scope:** auto-corrección en pickd. La flag viene del intake — no podemos modificar el item JSON sin un correction.
- **Origen:** sesión 2026-05-01.

### 55. New orders never auto-route to Ready to Double-Check <!-- id: idea-103 -->
- **Contexto:** Reportado en sesión 2026-05-01: una orden recién creada apareció directamente en la zona "Ready to Double-Check" del Verification Board en lugar de en su lane FedEx/Regular.
- **Hipótesis (sin diagnóstico aún):** alguna creación de orden setea `status='ready_to_double_check'` en vez de `active`. Posibles caminos:
  - Watchdog intake con default status incorrecto.
  - Reabrir una orden completada deja status en `ready_to_double_check` por accidente.
  - Auto-flag idle (idea-099 commit `37c2060`) que cambia status sin querer.
- **Plan al implementar:** primero diagnosticar — query a `picking_lists` filtrando `status='ready_to_double_check' AND created_at = updated_at` (proxy de "recién creada y nunca tocada") los últimos 7 días. Identificar patrón antes de proponer fix. Probable: guard en intake (CHECK constraint o trigger BEFORE INSERT que rechace `ready_to_double_check` para rows nuevos).
- **Datos pendientes para diagnóstico:** order_number observado + día/hora + si fue de watchdog o creación manual / reopen.
- **Origen:** sesión 2026-05-01.

### ~~48. Auto-mover órdenes idle a Waiting (en vez de borrarlas)~~ <!-- id: idea-099 --> ✅ 2026-04-30
- **Contexto:** El 2026-04-30 desapareció la orden `879469` que se dejó pendiente la noche anterior por falta de un item. Causa raíz: `usePickingSync.ts` borraba con DELETE las órdenes `active|needs_correction|reopened` cuyo `updated_at` fuera mayor a 5h cuando el user reabre la app.
- **Resuelto en commits:**
  - `1645bff` — quitar el DELETE: ahora solo libera la sesión local, la orden sobrevive.
  - `37c2060` — auto-flag idle `needs_correction` como `is_waiting_inventory` via `mark_picking_list_waiting`. Aterriza en la Waiting zone del Verification Board (UI ya existente desde idea-053/idea-055). RPC admin-only: si el caller no es admin, warn y queda en `needs_correction`.
  - Migración `20260430140000_picking_lists_delete_audit.sql` — trigger `BEFORE DELETE` que captura row + auth.uid() en tabla `picking_lists_deleted_audit`. Cualquier delete futuro deja rastro forensic.
- **Threshold actual:** 5h (heredado del código previo). Si en uso real resulta corto/largo, ajustar a "del día NY anterior" (TODO menor).

### ~~47. Reactivación de SKU al cambiar qty~~ <!-- id: idea-098 --> ✅ 2026-04-30 (no requiere código)
- **Investigación 2026-04-30:** `adjust_inventory_quantity` en prod ya hace el flip bidireccional automático (`is_active = (v_new_qty > 0)` — comentario explícito *"Bidirectional: activate when stock arrives, deactivate when depleted"*). Cliente la usa en `useInventoryMutations.ts:38`. Resultado: subir qty desde 0 reactiva el row sin cambio adicional.
- **`register_new_sku`** sigue creando placeholders con qty=0/is_active=true, no se ve afectado.
- **No se requiere botón "Reactivate"** — descartado.

### ~~46. Auto-resolver SKU format mismatches en intake / pick-time~~ <!-- id: idea-092 --> ✅ 2026-06-10 (cerrado junto con idea-101)
- **Estado parcial 2026-04-30:** ✅ entregado el path (2) — RPC `lookup_canonical_sku(p_raw)` en `supabase/migrations/20260430160000_lookup_canonical_sku.sql` + hook `useSkuSuggestion` + botón "Use {canonical} instead" en `CorrectionModeView` cuando el item está `sku_not_found`. **Path (1) cerrado 2026-06-10:** el intake del watchdog ya normalizaba desde siempre (ver idea-101); se agregó la guarda de ambigüedad (watchdog #35).
- **Contexto:** Las órdenes llegan con SKUs que no coinciden con `sku_metadata` solo por formato (guion/espacios faltantes). Ej: catalog tiene `09-4802BK` pero el PDF/sistema upstream pone `094802BK`. El picker hoy resuelve manualmente con un `Replaced X → Y` correction y razón "Sku def" / "Wrong name". En las últimas 2 semanas: `094802BK→09-4802BK` (2 órdenes, 2 customers el mismo día) y `033769BLD→03-3769BLD` (1 orden). Detección: la versión normalizada (lowercase + strip `[-\s]`) de ambos SKUs es idéntica → no es variant real, es ruido de formato.
- **Problema:** trabajo manual recurrente del picker para algo que la DB puede resolver sola. Cada caso suma ~30s + un correction note que infla el dashboard cross-team.
- **Solución propuesta — dos puntos de entrada que ya tocan la DB:**
  1. **Watchdog (intake):** al parsear el PDF, antes de crear `picking_lists.items`, normalizar cada SKU y hacer lookup contra `sku_metadata`. Si el SKU literal no existe pero el normalizado coincide con un único SKU canónico, sustituir y registrar la sustitución en `picking_lists.notes` o `combine_meta` (`{ sku_normalized: { from, to, reason: 'format' } }`). Si el normalizado coincide con múltiples canónicos, dejar el original y que el picker resuelva (ambiguous).
  2. **DoubleCheckView (pick-time, fallback):** al renderizar un item cuyo SKU no matchee `sku_metadata`, hacer la misma búsqueda normalizada. Si hay match único, ofrecer auto-resolución con un botón "Use 03-4070BK instead" (sin generar `Replaced` correction — porque no es un fix real). Si hay >1 match, mostrar selector. Reusa la normalización de la stock search RPC (idea-074) — `regexp_replace(sku, '[-\s]', '', 'g')`.
- **Out of scope:** variants reales (color/size distinto). Esos siguen requiriendo decisión manual del picker — son señal cross-team legítima para sales.
- **Impacto medible:** el reporte cross-team de 2 weeks (2026-04-13→2026-04-27) bajó de 5 mismatches a 3 al excluir los format-only. Esperado: ~40% menos correction notes "Sku def" / "Wrong name".
- **Riesgo:** falso positivo si un SKU `094802BK` existe POR SI MISMO en el catálogo (no debería pasar — todos los SKUs en `sku_metadata` tienen el formato canónico — pero la lookup `WHERE LOWER(REPLACE(sku, '-', '')) = $1` debe protegerse con `LIMIT 2` y rechazar match si retorna >1).
- **Origen:** sesión 2026-04-27.

### ~~45. FedEx Returns en el Activity Report~~ <!-- id: idea-091 --> ✅ 2026-05-06
- **Resuelto en commit `9051a9d`:** sección "FedEx Returns — N" dentro de la card de Inventory Accuracy. Muestra tracking number, status, item count, total units por return — sin nombres, sin timestamps, según pedido del operador. Hidden cuando no hay returns en el día.
- **Cambios:**
  - `useActivityReport`: nuevo `FedExReturnSummary` type + query paralela a `fedex_returns` (joined con `fedex_return_items`) en la ventana NY-day.
  - `ActivityReportView`: `FedExReturnsBlock` con tabla 4-col + total summary line. Color AMBER para diferenciar de Moved/Consolidated.
- **Out of scope (descartado del spec original):** Viernes acumulado semanal, agrupación walk-in returns, top-5. El user prefirió listado simple full-day, no top.

### 43. Orders view — UX/UI rework <!-- id: idea-065 -->
- **Problema:** La vista `/orders` tiene varios pain points:
  1. El **encabezado de PickD desaparece** en esta ruta. Debería estar siempre presente.
  2. **LivePrintPreview** tintea toda la card según el carrier — colores saturados rompen la estética.
  3. La asignación visual del carrier al label no es clara — sin logo identificable.
  4. Densidad y jerarquía visual no son lo suficientemente minimalistas comparado con el resto del sistema.
- **Solución propuesta:**
  - Mantener el header global de PickD visible en `/orders` (revisar `AppShell` / layout wrapper).
  - **Invertir el uso del color del carrier:** color vivo va al **fondo del preview card** con overlay glass oscuro (`bg-card/80 backdrop-blur-xl`).
  - **Logo del carrier** debajo del label impreso (FedEx / UPS / USPS / Regular), tamaño discreto, grayscale si el fondo ya expresa el carrier.
  - Pasar a estilo más minimalista: menos chrome, más whitespace.
- **Requiere:** Inventariar componentes ocultando el header; definir paleta por carrier; resolver assets de logos; evaluar impacto en PDF de labels (`jsPDF`).

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
- **Consideraciones antes de implementar:** Investigar edge cases — ¿qué pasa si otro usuario modifica la orden mientras está cacheada? ¿Se necesita una columna `updated_at` más granular o un hash de versión? ¿Impacto en optimistic updates existentes? Evaluar si TanStack Query `staleTime` + `structuralSharing` ya cubre parte del problema o si se necesita un cache layer adicional.
- **Requiere:** Análisis profundo antes de implementar.

### 60. Optimistic updates — Top 3 y 5 pendientes <!-- id: idea-112 -->
- **Contexto:** Auditoría 2026-05-21 identificó 5 mutations donde el optimistic update está mal usado o ausente. Top 1 (pick/unpick), #2 (ShippingTypeToggle), #4 (addNote) resueltos. Quedan #3 y #5.
- **#3 — `usePickingActions.markAsReady` batch (`src/features/picking/hooks/usePickingActions.ts:157-168`)** [~1.5h, ROI 🔥🔥]
  - Hoy: 2-3 `.update()` calls secuenciales sin onMutate. Si una falla, el estado local no rollback.
  - Fix: una sola mutation `useMarkAsReady` que ejecute las updates, capture snapshot de los affected lists, y rollback en bloque si una de las queries fail. Transactionar server-side via RPC `mark_picking_list_ready_with_release(p_list_id, p_user_id)` es la opción más limpia (también lo deja idempotente).
- **#5 — Photo upload de pallets (`PickingCartDrawer.tsx:624`, `DoubleCheckView.tsx:250`)** [~1.5h, ROI 🔥]
  - Hoy: sube foto + `.update({ pallet_photos })` sin optimistic.
  - Fix: `useMutation` que en `onMutate` agrega un blob URL local al array `pallet_photos` (preview instantáneo). `mutationFn` sube a storage + persiste. `onSuccess` reemplaza el blob URL por la URL final. `onError` lo quita. Cleanup del blob URL en ambos casos.
- **Template:** `usePickItemMutation.ts` (Top 1) + `ShippingTypeToggle.tsx` `useMutation` block (Top 2) + `usePickingNotes.addNote` (Top 4) cubren el patrón. Reusar.
- **Origen:** auditoría 2026-05-21.

---

## Reportado 2026-06-09 — batch operador (corto plazo)

> 12 ítems reportados por el operador. Refinados con sus respuestas el 2026-06-09. Repo indicado donde no sea pickd.

### ~~61. Separar (un-merge) órdenes combinadas~~ <!-- id: idea-128 --> ❌ descartado 2026-06-09
- Descartado por el operador ("olvida 128").

### ~~62. Botón "Stock" desde DoubleCheckView no oculta la vista~~ <!-- id: idea-129 --> ✅ 2026-06-11 (#120)
- **Causa raíz:** el efecto de cierre del drawer saltaba deliberadamente las órdenes abiertas externamente (Verification Board) — el camino típico del double-check.
- **Fix:** `requestStockView()` en ViewModeContext emite una señal explícita; el botón STOCK la usa y `PickingCartDrawer` ejecuta exactamente lo de la X (`handleReleaseOrder`: claim + release + cerrar), puenteando el keep-alive solo para esa petición explícita.
- **Origen:** sesión 2026-06-09; implementado 2026-06-11.

### ~~78. Sublocation igual al número de ubicación~~ <!-- id: idea-145 --> ✅ 2026-06-11 (#119) — input: 2026-06-11 ~09:00 NY
- En DoubleCheckView la sublocation era un chip chiquito; ahora hereda el estilo exacto del número grande (mismo ámbar, mono/black, 3xl/6xl, sin contenedor) — se lee como parte de la ubicación.

### ~~63. Verification Board → reabrir orden: misma sin fricción, distinta con confirmar~~ <!-- id: idea-130 --> ✅ 2026-06-11
- **Causa:** `handleOrderSelect` (VerificationBoard) bloqueaba con toast "Finish or clear your active picking session first" siempre que hubiera sesión de picking activa — incluso para la misma orden.
- **Fix:** misma orden → reentrada directa a DoubleCheckView; orden distinta → `showConfirmation` ("Switch order") en vez de bloqueo. La anterior conserva su status y queda en el board (nada se elimina); take-over intacto (corre en el external-load path, no se tocó).
- **Origen:** sesión 2026-06-09; implementado 2026-06-11.

### ~~79. Double-check: colapsar detalle de items marcados~~ <!-- id: idea-146 --> ✅ 2026-06-11 (#122) — input: 2026-06-11 ~09:20 NY
- Al marcar un item desaparecen nombre, distribution y sublocation — la fila se encoge y los pendientes dominan la pantalla. SKU/cantidad/ubicación se mantienen (tinte verde + check). Review mode muestra todo.

### 64. Búsqueda de consolidation <!-- id: idea-131 -->
- **Dash-insensitive:** ✅ **YA RESUELTO** (#107, `searchCandidates.ts`). Verificado con test `searchCandidates.test.ts` ("03398 → 03-3982BL" pasa). El guion NO es el problema.
- **Pendiente (decisión operador 2026-06-09):** "buscar en TODO el stock de bikes." El reporte "03398 no muestra 03-3982BL" es de **alcance**: consolidation solo busca su set de candidatos (RPCs por modo + only_bikes). Falta: cuando hay query y no hay candidato, también buscar en el stock de bikes completo (reusar el RPC de stock search, idea-074) y mostrar esos resultados. **Feature media — siguiente foco.**
- **Origen:** sesión 2026-06-09.

### ~~65. Overlays/menus con blur + scroll-lock~~ <!-- id: idea-132 --> ✅ ya aplicado (#107, 2026-06-09)
- El operador confirma que ya se aplica ("ya la aplicamos"). Commit `090f999` añadió *blur/scroll-lock overlay menus*.

### ~~66. Bug de dirección (imagen de Roman)~~ <!-- id: idea-133 --> ❌ retirado 2026-06-10 (operador: quitar del backlog)

### ~~67. Formatear Order Date de AS400 (060826 → 06/08/2026)~~ <!-- id: idea-134 --> ✅ 2026-06-10 (#113 + watchdog #32)
- **Hecho:** watchdog extrae `Order Date:` (MMDDYY → ISO) con `parser.parse_order_date` y la escribe en la columna nueva `picking_lists.source_order_date date` (migración `20260610120000`, aplicada a prod; 4 lugares actualizados). pickd la muestra formateada ("Order date: Jun 8, 2026") en el header de DoubleCheckView y en el board card; el watcher la muestra en su tarjeta local.
- **Bonus:** el watcher ahora aplica sus migraciones de esquema solo (`migrations.py` vía `SUPABASE_DB_URL`, paso [3/6] del botón ⟳ Update) — PostgREST descarta columnas desconocidas en silencio, así que la columna queda garantizada desde el update.
- **Origen:** sesión 2026-06-09; implementado 2026-06-10.

### ~~75. Watcher: "2 pallets · 20 units" en vez de item count~~ <!-- id: idea-142 --> ✅ 2026-06-10 (watchdog #34) — input: 2026-06-10 ~14:45 NY
- La tarjeta del watcher mostraba "10 items · 20 units"; ahora estima pallets con el port de la regla de PickD (parts-only = 1; bikes = ceil/12, parts apilan) usando el catálogo de bikes cacheado 1 h. Fail-open a "items · units" sin DB.

### ~~76. Watcher: dot AS400 gris aunque todo funcione~~ <!-- id: idea-143 --> ✅ 2026-06-10 (watchdog #36) — input: 2026-06-10 ~15:05 NY
- El círculo solo se coloreaba con Connect/Check manual. Ahora un health beacon alimentado por cada interacción real (scanner, capturas, connect) lo pone verde/rojo vía `GET /api/as400` en el poll de 8 s; señal >30 min sin actividad degrada a gris.

### ~~77. Watcher: carriles FedEx (izq) / Truck (der) con colores de fondo~~ <!-- id: idea-144 --> ✅ 2026-06-10 (watchdog #37) — input: 2026-06-10 ~15:45 NY
- La lista activa es ahora una grilla de dos carriles: FedEx a la izquierda (fondo púrpura) y Truck a la derecha (fondo esmeralda) — paleta FDX/TRK del Verification Board. Conteos en vivo por carril; se apilan en pantallas angostas. Already-in-PickD/Sent/Archived siguen full-width abajo.

### ~~74. Batch de mejoras double-check + watcher (lista del operador 2026-06-10)~~ <!-- id: idea-141 --> ✅ 2026-06-10
Implementado en pickd **#113** y watchdog-pickd **#32/#33** (todo en main):
- **Pallet X/Y** en DoubleCheckView (Y = total de pallets de la orden).
- **Resúmenes con pallets + unidades** (sin "N items"): board card (`getOrderUnits`) y footer de PickingSummaryModal.
- **Última nota en ROJO en la vista principal** (board card, sin abrir la orden) — batched: una query para todos los list_ids visibles (`useLatestNotesByList` + `LatestNotesProvider`; staleTime 10s, sin realtime dedicado por ahora).
- **FedEx púrpura:** en pickd DoubleCheckView (badge FDX + tinte, `shipping_type ?? autoClassifyShippingType`); en el watcher con **ambas** fuentes (`Ship Via` AS400 autoritativo + heurística ≥5 unidades, `pipeline.classify_shipping`) — clasificación local-only, no se escribe a PickD.
- **Watcher: nota roja** (`order_comments`) prominente en la tarjeta principal.
- **Watcher: auto-archivado** de candidatas sin enviar >8 días (`AUTO_ARCHIVE_DAYS`, recuperables del archivo local).
- **Watcher: toast verde** prominente al enviar a PickD.
- **Watcher: Verification Board espejo (fase 1)** — `GET /api/verification` (TTL 30s, fail-safe), botón con contador rojo en vivo (sube al enviar, baja al completar), modal read-only agrupado por status. Posible fase 2: zonas completas estilo board.
- **Watcher: skip de órdenes VOID/vacías (#33)** — pantalla completa (END OF ORDER) + 0 items → el cursor avanza (`scanned_store.skip`) sin crear tarjeta; la captura manual devuelve 422 claro. Antes el scanner reintentaba la misma VOID cada 20 min para siempre (reportado con la #880138).
- **Origen:** lista del operador, sesión 2026-06-10.

### ~~68. Al reiniciar la MacBook: Safari (UI) derecha + AS400 izquierda, 50/50~~ <!-- id: idea-135 --> ✅ 2026-06-10 (confirmado operador: ya está)

### ~~69. Auto-captura/envío de órdenes — refinar~~ <!-- id: idea-136 --> ❌ retirado 2026-06-10 (operador: quitar del backlog)

### ~~70. Número de cantidad de distribución: grande, al costado (fuera del gráfico)~~ <!-- id: idea-137 --> ✅ 2026-06-10 (#115)
- **Problema:** el número de cantidad de cada distribución debe verse mucho más grande.
- **Decisión operador:** **mantener** la representación gráfica, pero **quitar el número de adentro** del gráfico y **colocarlo al costado** (LINE/TOWER/unassigned) para aprovechar el espacio y que se vea **muchísimo más grande**, reconocible de lejos como los otros números.
- **Plan:** en DoubleCheckView, mover el valor de `.dist .tile` fuera del tile, a un número grande adyacente a la etiqueta de ubicación.
- **Origen:** sesión 2026-06-09.

### ~~71. Notas del watcher en rojo~~ <!-- id: idea-138 --> ✅ 2026-06-09 (interino)
- **Hecho (#110):** se muestra `picking_lists.notes` en **rojo** bajo el header en DoubleCheckView y PickingSummaryModal (Orders). Display-only, sin migración. Las notas pasadas con contenido aparecen automáticamente.
- **Limitación aceptada por el operador:** `picking_lists.notes` está **mezclado** — además de los Order Comments del watcher (`FREE FREIGHT`, `FREIGHT $65.00`…) contiene mensajes de sistema/cancelación (`User Cancelled`, `[System: Auto-cancelled…]`, `[User Cancelled — manual fix…]`). Por ahora se muestran todos (el operador prefiere verlos a no verlos). La separación limpia queda en idea-140.
- **Origen:** sesión 2026-06-09.

### 73. Columna dedicada `watcher_notes` (separar notas del watcher de sistema/manual) <!-- id: idea-140 --> ⏸ en pausa (operador 2026-06-10: "deja las notas como están por ahora")
- **Problema:** `picking_lists.notes` es un cajón mezclado (watcher Order Comments + appends de sistema/cancel). La UI roja (idea-138) hoy muestra todo. Para mostrar **solo** las del watcher hace falta separar el origen.
- **Plan:**
  1. **Migración (aditiva):** `ALTER TABLE picking_lists ADD COLUMN watcher_notes text;` + actualizar los 4 lugares (migración, Zod, types x2, selects).
  2. **watchdog (`supabase_client.create_order`):** escribir los Order Comments en `watcher_notes` (dejar de meterlos en `notes`, que queda para sistema/cancel). Repo `watchdog-pickd`.
  3. **pickd:** cambiar el display rojo (DoubleCheckView + PickingSummaryModal) para leer `watcher_notes` en vez de `notes`.
  4. **Backfill:** `UPDATE picking_lists SET watcher_notes = notes WHERE source='pdf_import' AND notes !~* 'cancelled|\[system'` (ajustar patrón) — para que las pasadas también queden limpias.
  5. Aplicar migración a prod tras el merge (checklist de migraciones del CLAUDE.md).
- **Origen:** sesión 2026-06-09 (follow-up de idea-138).

### 72. DoubleCheckView: últimos 3 dígitos de cada orden mergeada, separados por "/" <!-- id: idea-139 --> ✅ 2026-06-09 (#109)
- **Decisión operador:** cuando son **exactamente 2** mergeadas, mostrar los **últimos 3 dígitos de cada una separados por "/"** (ej. `083 / 121`). Cuando son **más de 2**, dejar como hoy (lista completa).
- **Hecho:** helper puro `orderHeaderLabel` + render en DoubleCheckView. 
- **Origen:** sesión 2026-06-09.

---

## P2 — Medio (conveniencia)

- [x] ~~**Orders PDF preview full-width mobile**~~ ✅ 2026-05-27 — Implementado: sublocation inline a la derecha del SKU en ConsolidationCard + sticky header sub-agrupado por sublocation. PlaceSkuTab tile con chip. Commits aea31b5, 95ab3bb. <!-- id: idea-113 -->

- [x] ~~**SMS Ship-Out — quitar dirección + ocultar Parts/Bikes con qty=0**~~ ✅ 2026-05-27 — Implementado: dirección eliminada del SMS + Parts/Bikes ocultos si qty=0. Tests actualizados (20/20). Commit aea31b5. <!-- id: idea-114 -->

- [x] ~~**Consolidation — ocultar toggle "Bikes only" de la UI (mantener default ON)**~~ ✅ 2026-05-27 — Implementado: toggle "Bikes only" eliminado de la UI, onlyBikes hardcodeado a true. Commit aea31b5. <!-- id: idea-115 -->

- [x] ~~**ConsolidationMoveModal — sublocation seleccionable (chips A-F) en vez de input libre**~~ ✅ 2026-05-27 — Implementado: input free-text reemplazado por chips A-F en ConsolidationMoveModal (mismo patrón que MovementModal). Commit aea31b5. <!-- id: idea-116 -->

- [x] ~~**Consolidation — filtro "Hide rows" por tab (persistido en localStorage)**~~ ✅ 2026-05-27 (MVP) — Implementado: nuevo hook `useHiddenRows(modeKey, defaults)` con persistencia por modo en `localStorage` clave `consolidation_hidden_rows_{modeKey}`. Nuevo componente `HiddenRowsPicker` (botón "Hidden: N" → popover con chips A-F-style por ROW + presets opcionales). Aplicado a: Send to slow / Bring to active / Clear a row (filtra `source_row` de candidatos) y Where to put? (filtra `location` de suggestions). El viejo toggle binario "Exclude ROW 20-34" eliminado; su comportamiento queda preservado vía default seed `DEEP_SLOW_ROWS` en consolidate mode + preset "Deep slow 20-34" en el popover. **Out of scope (queda para follow-up si surge demanda):** filtros adicionales hide-full-rows, hide-empty-rows, only-ROW-prefix, velocity-match-only. Investigación encontrada: ROW 21-27 no salían en Send to slow porque estaban en `DEEP_SLOW_ROWS` y ese set estaba hardcoded ON via toggle — ahora son seteables individualmente vía picker.

- [ ] **Consolidation — filtros adicionales recomendados** — Follow-up de idea-117 (MVP). Filtros opcionales que el operador puede activar/desactivar por tab (mismo patrón localStorage):
  - **Hide full rows** — esconde rows con `free_units = 0` (útil en Where to put + Send to slow para reducir ruido de destinos sin capacidad).
  - **Hide empty rows** — esconde rows con `current_units = 0` (útil en Clear a row).
  - **Only ROW prefix** — excluye M-slots / FDX RETURNS / shipping areas / otros non-ROW (hardcodearlo en `suggest_locations_for_sku` RPC sería más limpio, ver idea-118).
  - **Velocity match only** — en Where to put?, esconde destinos cuya `zone` no matchea el `sku_velocity_tier` del SKU activo.
  **Decisión 2026-05-28:** los 4 filtros propuestos quedaron DESCARTADOS — ninguno aporta en este warehouse. Only-ROW ya está hardcoded en el RPC (idea-118); Velocity-match quedó obsoleto tras el rework a picking_order (el ranking ya encode la velocidad); Hide-empty es contraproducente (rows vacías son buenos destinos); Hide-full (idea-124, revertido) no sirve porque con todo en movimiento `free_units = 0` casi nunca ocurre. El lever real de reducción de ruido es el **Hide rows manual** (idea-117) que ya existe + el "show top 12". No se necesitan más filtros automáticos. <!-- id: idea-120 -->

- [x] ~~**"Where to put?" logic al marcar SKU en Send to slow / Bring to active**~~ ✅ 2026-05-28 — Extraído `DestinationList` (componente compartido: corre `suggest_locations_for_sku`, lista rankeada + HiddenRowsPicker propio + expander "show all"). PlaceSkuTab refactorizado para usarlo (comparte queryKey `['suggest-locations', sku]` → una sola llamada RPC, sin duplicar). En Send to slow / Bring to active, tocar "Move" en una card expande la lista de destinos inline debajo (toggle); elegir un destino abre el ConsolidationMoveModal pre-targeteado a esa row (vía `placeTargetRow`, que ahora alimenta `suggestedRow` y se inyecta en `targetRows` para que aparezca como chip aunque esté fuera de las listas hardcoded). Cada tab persiste su propio filtro hidden-rows con key `dest_{mode}`. **Bonus en el mismo cambio:** la búsqueda de place-sku (query + confirmed) se elevó a ConsolidationScreen para que no se pierda al cambiar de tab. <!-- id: idea-122 -->

  - **Hide full rows** (free_units = 0) — útil en Where to put + Send to slow para reducir ruido.
  - **Hide empty rows** (current_units = 0) — útil en Clear a row.
  - **Only ROW prefix** (excluir M-slots, shipping areas, FDX RETURNS) — debería ser hardcoded en `suggest_locations_for_sku` directamente (ver idea-118). En otras tabs, toggle opcional.
  - **Velocity match only** (zone == sku_tier) — útil en Where to put para soluciones aspiracionales.
  Reset rápido "clear hidden" en cada tab. ~3-4h. <!-- id: idea-117 -->

- [x] ~~**Where to put? — rediseño completo (autocomplete + solo ROW + panel velocidad)**~~ ✅ 2026-05-27/28 — Entregado en 4 capas a lo largo de 2 commits:
  1. **Autocomplete** (commit 5584273): input con `useDebounce(200)` → query `ilike` sobre `inventory` (no `sku_metadata`, así solo aparece stock que ya tenemos), dedupe por SKU, sort exact/prefix/qty-desc, top 8. Dropdown con `SKU · nombre · Xu · N loc`. Enter toma top match; botón "Change" resetea. Las queries pesadas (currentRows + RPC) solo corren post-confirmación.
  2. **Inventario obligatorio:** el autocomplete solo busca `inventory` activo con `quantity > 0`, así que SKUs sin stock nunca aparecen. Mensaje explícito "No active stock matches X. Register the SKU first via Stock → New Item."
  3. **Solo ROW como targets** (migración `20260528083212_suggest_locations_row_only.sql`, aplicada a prod): `AND l.location ILIKE 'ROW%'` en el CTE `loc_summary`. Excluye M-slots, FDX RETURNS, shipping areas. Verificado: `suggest_locations_for_sku('0344')` ahora solo devuelve ROWs.
  4. **Panel SKU context:** header muestra velocity tier coloreado (HOT/WARM/COLD), orders 30d/90d, total stock, y **última orden** (nueva query a `picking_lists` con `contains('items', [{sku}])` + `status='completed'` order by updated_at desc limit 1, formateada "today/Nd ago/Nmo ago"). **Nota:** el panel depende de que la RPC devuelva ≥1 suggestion (la data de velocity viene de ahí); si un SKU no tiene ROW destinos válidos el panel no aparece — edge raro, aceptable.
  No se creó la RPC `search_skus` planeada — el `ilike` directo sobre inventory cubre el caso sin viaje extra. <!-- id: idea-118 -->

- [x] ~~**Consolidation — filtro qty-bucket (Singles / Lines / 1 Tower / 1 Tower+)**~~ ✅ 2026-06-01 — Nuevo hook `useQtyBucketFilter(modeKey)` con persistencia por modo en `localStorage` clave `consolidation_qty_bucket_{mode}` (mismo patrón que `consolidation_hidden_rows_{mode}`). Single-select, sin default seed: clickear el bucket activo lo desactiva (vuelve a "sin filtro"). Buckets: Singles (1-2), Lines (3-15), 1 Tower (16-30), 1 Tower+ (>30). Chips horizontales junto al HiddenRowsPicker en la barra de filtros, mismo estilo visual que Max/Min orders. Aplicado client-side en el memo `preSearch` después del filtro hidden-rows. Visible en Send to slow / Bring to active / Clear a row; oculto en place-sku (esa tab lista destinos, no candidatos con qty). 100% client-side, no toca DestinationList ni RPCs. <!-- id: idea-125 -->

- [x] ~~**Consolidation — persistir avance al salir (filtros, búsqueda, selección)**~~ ✅ 2026-06-01 — ConsolidationScreen ahora hidrata todo el state relevante desde `localStorage` (clave `consolidation_state_v1`) al montar y lo re-serializa en cada cambio via `useEffect`. Cubre: `mode`, `maxOrders`, `minOrders`, `searchQuery`, `placeSkuQuery`, `placeSkuConfirmed`, `clearRow`, `movedIds` (Set→number[]), `selectedIds` (Set→number[]) y `destForId` (solo el id; el `destFor` Candidate completo se re-resuelve via un useEffect diferido cuando el `useQuery` de candidates devuelve resultados — si ya no existe se descarta sin ruido). Los filtros que ya tenían su propio localStorage (`useHiddenRows`, `useQtyBucketFilter`) no se duplican; mantienen sus claves `consolidation_hidden_rows_{mode}` y `consolidation_qty_bucket_{mode}`. Por usuario implícitamente (localStorage del dispositivo). <!-- id: idea-127 -->

- [x] ~~**Stock view — visualización Jenga de la distribución encima de cada card**~~ ✅ 2026-06-01 — Nuevo componente `DistributionJengaViz` (franja horizontal a full-width arriba de location+SKU+stock) que renderiza un glyph por DistributionItem respetando exactamente `inventory.distribution` (no deriva de quantity total). LINE → palito horizontal con `units_each` al centro; TOWER → stack vertical de mini-rungs; PALLET/OTHER → chip neutro (TODO: visuales dedicados). Botón "+" al borde derecho de la franja abre el ItemDetailView (mismo flujo que click en la card). El rollup en texto ("2 Towers · 1 Line") eliminado del bottom row. Si `distribution` está vacío, la franja no aparece. `Stock: N` del lado derecho intacto. <!-- id: idea-126 -->

- [x] ~~**Combined orders — suprimir warnings cruzados con órdenes del mismo grupo**~~ ✅ 2026-05-27 — Bug confirmado en dos hooks raíz, no solo uno: `useWaitingConflicts.ts` (waiting orders cross-customer) Y `useStockReservations.ts` (active orders reservation visibility — más grave, alimenta el badge "🔒 N elsewhere" en DoubleCheckView y los tooltips "Reserved by other orders" en InventoryCard). Ambos consultaban `picking_lists` sin filtrar por `group_id`, así que las hermanas de una combined order aparecían como conflictos externos. **Fix entregado:** (a) ambos hooks ahora aceptan parámetro opcional `myGroupId` / `excludeGroupId`; cuando set, filtran rows con `group_id === excludeGroupId` (skip silent siblings). (b) Ambos hooks incluyen `group_id` en su `.select()`. (c) `DoubleCheckView` añade `useQuery(['picking_list_group_id', activeListId])` (staleTime 60s) y pasa el resultado a ambos hooks. (d) `StockReservationBreakdown` (ItemDetailView) NO recibe groupId — correcto, vive fuera del flujo de picking y debe mostrar todas las reservas globales. Test manual pendiente: combinar 2 órdenes con SKU compartido, confirmar que no aparece "needed in another order" ni "reserved elsewhere" para items propios de la combinada. <!-- id: idea-119 -->

---

## P1 — Refinados pendientes

### ~~40. Notas de proyecto siempre visibles (quitar line-clamp)~~ <!-- id: idea-062 --> ✅ 2026-04-27
- `line-clamp-2` removido del `TaskCard` en `src/features/projects/ProjectsScreen.tsx`. Verificado: no quedan refs a `line-clamp` en el archivo. PR #43 (bundle).

---

## Inventory Audit — pendientes de revisión

- [ ] **ROW 10 — 6 SKUs sin sublocation confirmada** — `03-3718GY` (1), `03-3719GY` (1), `03-3817GY` (1), `03-3846BR` (5), `03-4201GN` (3), `03-4208GY` (1). Verificar físicamente si siguen en ROW 10 o deben moverse/desactivarse. <!-- audit-2026-04-15 -->

---

## Bugs pendientes

_(ninguno abierto al 2026-04-28 — bug-013 archivado)_

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
| Automatic Inventory Email (idea-007) | 2026-04-22 — `send-daily-report` nunca se usó en operación; eliminada del runtime para cerrar endpoint sin auth. Snapshot R2 sigue activo vía `daily-snapshot`. `0d85fc2`. |
