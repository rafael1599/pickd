# PickD — Backlog Archive

> Items completados. Para investigar detalles: `git show <commit>`.

## P1 Features

| Item | Completed | Commits |
|------|-----------|---------|
| Combinar órdenes del mismo shop | 2026-03-18 | `adff48e` |
| Agrupación visual FedEx/General | 2026-03-25 | `adff48e` |
| Distribución física inteligente | 2026-03-25 | `d46d137` |
| Prevenir reserva duplicada watcher | 2026-03-26 | `221d057` |
| Filtro bike bins Stock View | 2026-03-26 | `91d0005` |
| Fotos SKU metadata Fase 1+2 | 2026-03-26 | `a227d99` |
| Preservar internal_note en moves | 2026-03-25 | `5e84c88` |
| Override qty por pallet | 2026-03-24 | `bd17608` |
| Peso pallets en label | 2026-03-24 | `5ace2da` |
| Auto-parse dirección | 2026-03-24 | `30bfcb7` |
| Security hardening RLS | 2026-03-29 | `20260329200000` |
| Egress bandwidth ~99% reduction | 2026-03-29 | `655d7a2` |
| Picking session hardening (fix-002) | 2026-04-02 | `395c49b` `9c8fb21` `27d2b8b` `9fbb3a6` |
| Edit Order mode (CorrectionModeView) | 2026-04-02 | `9fbb3a6` |
| Eliminar building mode (idea-032) | 2026-04-03 | `346e015` `67debf2` `bb192cd` `9b4eac4` `3a43a1e` |

## Bugs Resueltos

| Bug | Fixed | Commits |
|-----|-------|---------|
| bug-002: Undo borra en vez de mover | 2026-03-23 | `8092bbe` |
| bug-003: Watcher items qty=0 | 2026-03-23 | `87ea90b` |
| bug-004: Órdenes duplicadas | 2026-03-23 | `10ef3f8` |
| bug-007: Verification list >24h | 2026-03-25 | `3e10c0c` |
| bug-008: Save button no funciona | 2026-04-02 | `09b906b` |
| bug-010: Buscador dark mode | 2026-04-02 | `439b08a` |
| bug-011: Orden desaparece en double check | 2026-04-02 | fix-002 |
| Pantalla negra al retroceder double check | 2026-04-03 | `8286d4b` |
| Orden se pierde al abrir verificación | 2026-04-03 | `f12e8bb` |
| Inventory qty=0 no desaparece del cache (realtime+optimistic) | 2026-04-08 | `fae9110` |
| z-index modales bajo header/nav (idea-046 regression) | 2026-04-08 | (this session) |
| database.types.ts CLI noise + 46 tsc errors | 2026-04-08 | `4973c34` |

## Archived 2026-04-10 — 12 items compacted

### Completed P1 / P2

| # | Item | Completed | Commits | ID |
|---|------|-----------|---------|----|
| 1 | Campos de bicicleta en `sku_metadata` (`is_bike` + `upc`) | 2026-04-07 | `88d9bb9` | idea-042 |
| 2 | Detección mejorada bike vs part (filtros usan `is_bike`) | 2026-04-07 | `8d540b1` | idea-038A |
| 3 | Fallback manual BIKES/PARTS en labels (auto-calc + override) | 2026-04-07 | `731eff2` | idea-038B |
| 4 | Multi-Address Customers (`customer_addresses` + autocomplete) | 2026-04-03 | `88b878d` | idea-012 |
| 5 | Separar peso de dimensiones + defaults dinámicos por tipo | 2026-04-03 | `3e117d2` | idea-025 |
| 6 | Labels — "Units" → "Bikes" + partes separadas | 2026-04-03 | `7c9b01f` | idea-027 |
| 7 | Peso por parte en Orders (editor inline) | 2026-04-03 | `7c9b01f` | idea-028 |
| 8 | Badge peso/dimensiones en Stock View (condicionales) | 2026-04-03 | `3e117d2` | idea-029 |
| 9 | Notas de corrección interactivas (ReasonPicker) + recovery reopened | 2026-04-07 | `01a73bb` | idea-043 |
| 10 | Orders mobile UX overhaul (collapsable customer + search) | 2026-02-09 | `b8b10f0` | idea-033 |
| 11 | Reemplazar Edit Item por ItemDetailView (eliminado InventoryModal 1099 LOC) | 2026-03-26 | `3fc050d` `45b340f` | idea-036 |

### Resolved bugs

| Bug | Fixed | Root cause | Commits |
|-----|-------|-----------|---------|
| bug-014: Double check distribución no refresca picking path | 2026-04-03 | `skuInventoryMap` no se re-fetch tras updateItem | `45b340f` |

## Archived 2026-04-16 — 13 items compacted

### Completed P1 / P2

| # | Item | Completed | Commits | ID |
|---|------|-----------|---------|----|
| 1 | Mostrar notas en picking summary (PickingSummaryModal accordion) | 2026-04-10 | — | idea-044 |
| 2 | Estandarización visual completa (4 fases: colors → z-index → overlays → picking screens) | 2026-04-08 | `82bcfc8` `27cf781` `723e57e` `f28c666` `7b23781` | idea-046 |
| 3 | Generador de SKU labels para bicicletas (asset_tags + QR + Side A/B) | 2026-04-09 | `7022cbd` `8e1e5a0` `e152d7a` | idea-040 |
| 4 | Daily Warehouse Activity Report — Refinamiento (HTML email + KPIs + team detail) | 2026-04-08 | `42ac9fd` `68950b6` | idea-041 |
| 5 | Reestructurar menú principal (hamburger + Warehouse Activities) | 2026-04-08 | `4afd94c` | idea-045 |
| 6 | Activity Report Phase 2 — Persistencia y lock (daily_reports + cron snapshot) | 2026-04-10 | `f88a569` `aa9b001` `84cdfa1` `77bad82` | idea-052 |
| 7 | Modal Manager — Context + root render pattern | 2026-04-10 | `330bbcd` | idea-050 |
| 8 | Activity Report — quitar la hora del header | 2026-04-10 | `35ff19c` | idea-051 |

### Resolved bugs

| Bug | Fixed | Root cause | Commits |
|-----|-------|-----------|---------|
| bug-009: Address parser falla con calles numéricas + direccionales | 2026-04-10 | `parseFromLines` faltaba newline-aware Strategy 0 | `a53f5a4` |
| bug-015: Menú de perfil se queda trabado | 2026-04-09/10 | `showProfile` no se reseteaba en `navTo()` + InventorySnapshotModal en lifecycle del menú | `16b657a` `6839114` `330bbcd` |
| bug-016: Projects/Activity Report — duplicación + races + reconstrucción histórica | 2026-04-10 | Faltaba dedupe + filtro `created_at` + reconstrucción desde `task_state_changes` | `92cd477` `4df57be` `810290b` `960749e` |
| bug-017: `auto_cancel_stale_orders` creaba inventario fantasma | 2026-04-10 | Rama verification 24h llamaba `adjust_inventory_quantity` con `+qty` para "restorar" cuando inventario nunca se había deducido | `0ffbe3d` `05cf9b2` (migración `20260410130000`) |

### Notas técnicas

- bug-017 condujo a la eliminación de la rama verification 24h en `auto_cancel_stale_orders` y al diseño formal de Long-Waiting Orders (idea-053).
- bug-016 generó `historicalTaskStatus.ts` con 21 unit tests (lógica pura para reconstrucción de estado de tasks por día).

---

## Archived 2026-04-28 — 24 items compacted

### Completed (P1 + P2)

| # | Item | Completed | Commits | ID |
|---|------|-----------|---------|----|
| 1 | Activity Report PDF export (idea-059-pdf) | 2026-04-21 | `2a0c7d6` | idea-059-pdf |
| 2 | Photo Gallery en Projects (4 fases) | 2026-04-15 | `06d7de2` `fc14938` | idea-058 |
| 3 | Sub-locations alfabéticas por ROW | 2026-04-14 | `efe0d69` `6db7105` `f011085` | idea-024 |
| 4 | Distribution type "Other" texto libre | 2026-04-14 | `204fb2d` | idea-026 |
| 5 | Verification Queue Split + DnD (absorbido por idea-055) | 2026-04-13 | `14be449` | idea-037 |
| 6 | Label Studio — personalización SKU labels (4 fases) | 2026-04-13 | `e2fc436` `3bf12e8` | idea-054 |
| 7 | Verification Board Redesign — 6-zone kanban | 2026-04-13 | `ba0659c` `14be449` | idea-055 |
| 8 | Long-Waiting Orders | 2026-04-13 | `fe9907a` | idea-053 |
| 9 | Pallet photos en reporte y orders | 2026-04-16 | `458addb` `0a38819` `0abedf1` | idea-059 |
| 10 | Print Label respeta orientación toggle | 2026-04-16 | `58e6b69` | idea-060 |
| 11 | Imágenes del reporte llegan a Gmail (base64 inline) | 2026-04-16 | `6a7cd24` | idea-061 |
| 12 | Cámara o Galería del teléfono — selector | 2026-04-16 | `6a7cd24` | idea-063 |
| 13 | Foto obligatoria antes de completar orden | 2026-04-16 | `53a3b85` `e66339f` | idea-064 |
| 14 | FedEx default single group (auto-group trigger cross-customer) | 2026-04-16 | `8e836e7` | idea-057 |
| 15 | Projects — drag to reorder priority | 2026-04-15 | `c115c13` `0b85070` | idea-049 |
| 16 | Shopping List / Cosas por comprar | 2026-04-14 | `dc2d19f` | idea-056 |
| 17 | Fotos Fase 3 — Bulk Upload | 2026-04-16 | `81d4b3b` | idea-023-p3 |
| 18 | Remaining qty display en Picking Summary (post-deduct) | 2026-04-24 | PR #19 | idea-069 |
| 19 | Low-stock tracking para reporte | 2026-04-24 | `8d91033` (PR #20) | idea-070 |
| 20 | Activity Report — low-stock en "On the floor" | 2026-04-24 | `8d91033` (PRs #20/22/23) | idea-071 |
| 21 | Ghost trail audit — from_location + link a picking list | 2026-04-24 | PR #21 | idea-072 |
| 22 | Low-stock audit details — completions per SKU | 2026-04-24 | PR #22 | idea-073 |
| 23 | Automatic Inventory Email — retirado | 2026-04-22 | `0d85fc2` `ab01566` | idea-007 |

### Resolved bugs

| Bug | Fixed | Root cause | Commits |
|-----|-------|-----------|---------|
| bug-013: Teclado aparece al abrir orden desde Verification Queue | 2026-04-?? | overlay detection con elementFromPoint | `51e55a5` |

---

## Archived 2026-05-21 — May ops batch (33 items + 3 bugs)

### P1 features delivered

| # | Item | Completed | Commits | ID |
|---|------|-----------|---------|----|
| 1 | Add-On reopen Phase 2 (end-to-end full feature) | 2026-05-05 | `df1a2d3` | idea-067 P2 |
| 2 | Add-On Phase 3 — COMBINE button + drop Re-Complete gate + single canonical entry | 2026-05-05 | `ce01b64` `8c57506` `e31d476` | idea-067 P3 |
| 3 | Verification Board — color identification (tint bump + thicker stripes, pass 1) | 2026-05-05 | `2708280` (PR #63) | idea-102 |
| 4 | Explicit "Ready to Double-Check" button — split Park Order vs Ready to DC | 2026-05-05 | `cb458c1` (PR #64) | idea-104 |
| 5 | Realtime stock reservations — Phase 1 (persist verified_item_keys cross-user) | 2026-05-05 | `f320dc3` (PR #66) | idea-105 P1 |
| 6 | Realtime stock reservations — Phase 3 (reservations + realtime + pill UI) | 2026-05-?? | `69bbc3f` | idea-105 P3 |
| 7 | DoubleCheckView — agrandar SKU/loc/sublocation/distribution en tablet (`md:+`) | 2026-05-06 | `79b558d` | idea-106 |
| 8 | Inventory log notes — `inventory_logs.note` + edit retroactive + report note | 2026-05-06 | `1a25dd0` `f26cb3e` `cd587c5` `059720c` `a8af404` `18a2d19` `ba35a5f` | idea-111 |
| 9 | Consolidation admin screen — slow-mover slotting end-to-end (15 PRs) | 2026-05-20 | `ff14c8f` (PR #71) → `1db9059` (PR #85) | new |
| 10 | Consolidation — Send-to-slow / Bring-to-active / Clear-a-row tabs | 2026-05-20 | `9a87de7` (PR #80) `5664239` (PR #81) | new |
| 11 | Consolidation — smart per-SKU destination + Smart Suggestions panel | 2026-05-20 | `3cdba8c` (PR #82) | new |
| 12 | Consolidation — "Other" tile in Move modal + top-3 easiest to clear | 2026-05-20 | `ae45588` (PR #84) `1db9059` (PR #85) | new |
| 13 | Consolidation — visual revamp + select-to-move + checkbox UX | 2026-05-20 | `2336c98` (PR #77) `866362b` (PR #78) `96f923d` (PR #79) | new |
| 14 | Consolidation — modal z-index above BottomNavigation + safe-area pad | 2026-05-20 | `16afafe` (PR #75) | new |
| 15 | Ship-Out SMS at Double-Check slide-to-complete (Android+iOS, prefilled body) | 2026-05-21 | `c5a0a0d` (PR #87) | new |
| 16 | Ship-Out SMS — resend button in Picking Summary modal + Orders FAB | 2026-05-21 | `6b2713e` (PR #88) | new |
| 17 | Ship-Out SMS — empty-addressed Messages + skip PALLETS for FedEx + BIKES line | 2026-05-21 | `d8d2f62` (PR #89) `fc6e6de` (PR #90) | new |
| 18 | Sticky row headers fix — consolidation + stock (`overflow-x:clip` on LayoutMain) | 2026-05-21 | `f9cc1e9` (PR #86) | new |
| 19 | SKU history rename-aware via alias chain (resolve_sku_chain RPC) | 2026-05-19 | `b8b327a` (PR #69) `b3fb4b6` (PR #70) | new |
| 20 | Inventory location ↔ location_id drift fix via sync trigger + monitoring view | 2026-05-20 | `4c6a0be` (PR #76) `66e6e01` (PR #74) | new |
| 21 | Move stock edge guards — refuse no-op moves (same loc, zero qty) | 2026-05-20 | `5bbb266` (PR #83) | new |
| 22 | pick_item RPC group fallback — route to owning sibling list in grouped orders | 2026-05-08 | `716eb59` (PR #67) | new |
| 23 | Verification Board — "In Picking" zone + open active orders in DoubleCheckView | 2026-05-15 | `5129a6d` `ee7d688` | new |
| 24 | Verification Board — Show N more when either lane exceeds cap | 2026-05-13 | `03a207d` (PR #68) | new |
| 25 | DoubleCheckView header — compact + kebab actions + Pickd counter + collapsed combined list | 2026-05-06/19 | `224cd70` `a6127be` `99e3beb` | new |
| 26 | FedEx Returns rework — Misship flag, RMA on label, atomic process_fedex_return_item, Dispose button | 2026-05-06 | `5fbbe9b` `3bc6a89` `1276667` `bf5da10` `da94f7e` `66422d6` `0cb14ff` `1a25dd0` | new |
| 27 | FDX RETURNS — intake rename + bin reassignment dropdown | 2026-05-19 | `4272d94` | new |
| 28 | FedEx + history PDF labels at 4×6 native size | 2026-05-19 | `0ed1553` | new |
| 29 | Stock card visual revamp — operator text scaler + sublocation chip parity + 155% scale baked + distribution + pinned sublocation | 2026-05-08 | `4865155` `6e143ad` `3c905a8` | new |
| 30 | History — custom date range picker + multi-day moves preserved + AS400 Sync PDF mode | 2026-05-06/08 | `d4533c1` `e6424d8` `d55b3a8` `6d5d9a6` `18a2d19` | new |
| 31 | register_new_sku redirects to canonical SKU (closes idea-101 prereq path in pickd; watchdog wiring still pending) | 2026-05-04 | `5ff57e5` (PR #62) | idea-101 prereq |
| 32 | Orders UI — hide FedEx + collapse general groups into one card | 2026-05-05 | `ce1b89e` | new |
| 33 | DoubleCheckView — Take Photo CTA replaces disabled slider when no photo yet | 2026-05-05 | `aaa57e4` (PR #65) | new |

### Resolved bugs (this batch)

| Bug | Fixed | Commits |
|-----|-------|---------|
| Consolidation list 400s after a move (stale list refetch) | 2026-05-20 | `bbad1e8` (PR #72) |
| Consolidation source_row showing wrong location (FK join vs raw `inventory.location`) | 2026-05-20 | `66e6e01` (PR #74) |
| Ship-Out SMS settings page stuck on "Loading…" (prod migration not applied + setState-in-effect lint) | 2026-05-21 | (in PR #87 follow-up) |

## Archived 2026-08-27 — 37 items compacted

> Comprimidos desde BACKLOG.md; el contexto completo vive en los commits (`git show <hash>`) y en los PRs.

### Completed (P1 · batch 2026-06-09 · P2 · refinados)

| # | Item | Completed | Commits | ID | Qué quedó |
|---|------|-----------|---------|----|-----------|
| 1 | 53. SKU normalization at intake — close idea-092 path 1 | 2026-06-10 | watchdog #35 | idea-101 | **Resolución 2026-06-10:** verificado con tests que `_to_cart_items` del watchdog **ya matchea normalizado desde su commit inicial** (`034664BR` ↔ `03-4664BR` resuelve al canónico en el intake; no llega UNREG). El incidente que originó la idea fue un **typo de dígito** (4664 vs 4666) — correctamente manual, la normalización no adivina dígitos. Lo único que faltaba era la nota de riesgo del propio spec: **colisiones** (dos SKUs canónicos con la misma forma normalizada) se elegían en silencio; ahora se dejan sin resolver para que el picker decida (watchdog #35, equivale al contrato LIMIT-2 de `lookup_canonical_sku`). No hace falta llamar al RPC: la lógica local es equivalente y batched. |
| 2 | 48. Auto-mover órdenes idle a Waiting (en vez de borrarlas) | 2026-04-30 | `1645bff` `37c2060` `5c6fe9d` | idea-099 | **Contexto:** El 2026-04-30 desapareció la orden `879469` que se dejó pendiente la noche anterior por falta de un item. Causa raíz: `usePickingSync.ts` borraba con DELETE las órdenes `active/needs_correction/reopened` cuyo `updated_at` fuera mayor a 5h cuando el user reabre la app. |
| 3 | 47. Reactivación de SKU al cambiar qty | 2026-04-30 | — (sin código) | idea-098 | **Investigación 2026-04-30:** `adjust_inventory_quantity` en prod ya hace el flip bidireccional automático (`is_active = (v_new_qty > 0)` — comentario explícito *"Bidirectional: activate when stock arrives, deactivate when depleted"*). Cliente la usa en `useInventoryMutations.ts:38`. Resultado: subir qty desde 0 reactiva el row sin cambio adicional. |
| 4 | 46. Auto-resolver SKU format mismatches en intake / pick-time | 2026-06-10 | migración `20260430160000` + watchdog #35 | idea-092 | **Estado parcial 2026-04-30:** ✅ entregado el path (2) — RPC `lookup_canonical_sku(p_raw)` en `supabase/migrations/20260430160000_lookup_canonical_sku.sql` + hook `useSkuSuggestion` + botón "Use {canonical} instead" en `CorrectionModeView` cuando el item está `sku_not_found`. **Path (1) cerrado 2026-06-10:** el intake del watchdog ya normalizaba desde siempre (ver idea-101); se agregó la guarda de ambigüedad (watchdog #35). |
| 5 | 45. FedEx Returns en el Activity Report | 2026-05-06 | `9051a9d` `069ae0d` | idea-091 | **Resuelto en commit `9051a9d`:** sección "FedEx Returns — N" dentro de la card de Inventory Accuracy. Muestra tracking number, status, item count, total units por return — sin nombres, sin timestamps, según pedido del operador. Hidden cuando no hay returns en el día. |
| 6 | 62. Botón "Stock" desde DoubleCheckView no oculta la vista | 2026-06-11 | `6180bd6` (#120) | idea-129 | **Causa raíz:** el efecto de cierre del drawer saltaba deliberadamente las órdenes abiertas externamente (Verification Board) — el camino típico del double-check. |
| 7 | 78. Sublocation igual al número de ubicación | 2026-06-11 | #119 | idea-145 | En DoubleCheckView la sublocation era un chip chiquito; ahora hereda el estilo exacto del número grande (mismo ámbar, mono/black, 3xl/6xl, sin contenedor) — se lee como parte de la ubicación. |
| 8 | 63. Verification Board → reabrir orden: misma sin fricción, distinta con confirmar | 2026-06-11 | `a62996f` (#123) | idea-130 | **Causa:** `handleOrderSelect` (VerificationBoard) bloqueaba con toast "Finish or clear your active picking session first" siempre que hubiera sesión de picking activa — incluso para la misma orden. |
| 9 | 79. Double-check: colapsar detalle de items marcados | 2026-06-11 | #122 | idea-146 | Al marcar un item desaparecen nombre, distribution y sublocation — la fila se encoge y los pendientes dominan la pantalla. SKU/cantidad/ubicación se mantienen (tinte verde + check). Review mode muestra todo. |
| 10 | 80. Watchdog: SKU con sufijo truncado (03-3769BLD → 03-3769BL) | 2026-06-11 | watchdog #40 | idea-147 | **Clase distinta al matching de guiones (idea-101):** el parser asumía color de 2 letras y descartaba la 3ª como finish suffix ANTES del matching. Pero el catálogo es inconsistente: `03-3769BLD` existe con la D, `03-3768BL` no. |
| 11 | 81. Watchdog: VOID que cae en 'ADDITIONAL MESSAGE INFORMATION' | 2026-06-11 | watchdog #41 #42 | idea-148 | **Segunda variante de VOID** (la otra, pantalla completa 0 items, es #33): tras el F5 la orden caía en la pantalla de detalle de mensaje del AS400 (BAS-5065, "No matching key", prompt `Option:`); el loop seguía con ENTER, nunca END OF ORDER, y el scanner reintentaba el mismo número. |
| 12 | 82. Register Container acepta PDF (no solo XLSX) | 2026-06-11 | #130 | idea-149 | Las hojas de recepción llegan en PDF (ej. PO worksheet de Oyama Factory). `parseWorksheetText` (puro, testeado) + `parseShipmentPdf` (pdfjs-dist extrae texto, reensambla líneas por Y/X) producen el mismo `ParsedSheet` que el XLSX. La pantalla enruta `.pdf` → parseShipmentPdf; flujo aguas abajo (resolve/register_container, PO, audit) intacto. Validado end-to-end contra el PDF real del PO 6430N (19 SKUs, 2065 unidades). Nueva dep `pdfjs-dist` (chunk lazy). Layout soportado: worksheet tipo Oyama; otros formatos se extienden si aparecen. |
| 13 | 83. Double-check: auto-hide del header + filtro de notas ruido | 2026-06-11 | #132 | idea-150 | **Auto-hide:** el contexto del header (orden #, FedEx, toggle shipping, fecha) aparece al abrir y con cualquier scroll/tap de la lista, se desvanece 5s después del último scroll. Siempre visibles: botón salir, línea de progreso "X/Y Pickd", y la nota significativa. Lista + títulos de pallet nunca se mueven. `showHeaderInfo` + `bumpHeaderInfo` (timer); re-revela en onScroll/onPointerDown (cubre órdenes cortas). |
| 14 | 84. Drag-to-group siempre con confirmación + waiting fuera del auto-combine | 2026-06-11 | #134 · watchdog #43 #46 · `32948b0` (`20260612150000`) | idea-151 | **PickD (#134):** soltar una orden sobre otra agrupaba en silencio en la misma zona. Ahora TODA agrupación por drag pasa por `GroupOrderModal`: grupo existente → botón único "Add to group"; grupo nuevo → picker FedEx/General; si alguna orden está waiting → advertencia ámbar "⚠ #X is waiting for inventory". |
| 15 | 64. Búsqueda de consolidation | 2026-06-11 | `8fe9646` (#107) | idea-131 | **Dash-insensitive:** ✅ resuelto antes (#107, `searchCandidates.ts`). |
| 16 | 65. Overlays/menus con blur + scroll-lock | 2026-06-09 | `090f999` (#107) | idea-132 | El operador confirma que ya se aplica ("ya la aplicamos"). Commit `090f999` añadió *blur/scroll-lock overlay menus*. |
| 17 | 67. Formatear Order Date de AS400 (060826 → 06/08/2026) | 2026-06-10 | #113 · watchdog #32 (`20260610120000`) | idea-134 | **Hecho:** watchdog extrae `Order Date:` (MMDDYY → ISO) con `parser.parse_order_date` y la escribe en la columna nueva `picking_lists.source_order_date date` (migración `20260610120000`, aplicada a prod; 4 lugares actualizados). pickd la muestra formateada ("Order date: Jun 8, 2026") en el header de DoubleCheckView y en el board card; el watcher la muestra en su tarjeta local. |
| 18 | 75. Watcher: "2 pallets · 20 units" en vez de item count | 2026-06-10 | watchdog #34 | idea-142 | La tarjeta del watcher mostraba "10 items · 20 units"; ahora estima pallets con el port de la regla de PickD (parts-only = 1; bikes = ceil/12, parts apilan) usando el catálogo de bikes cacheado 1 h. Fail-open a "items · units" sin DB. |
| 19 | 76. Watcher: dot AS400 gris aunque todo funcione | 2026-06-10 | watchdog #36 | idea-143 | El círculo solo se coloreaba con Connect/Check manual. Ahora un health beacon alimentado por cada interacción real (scanner, capturas, connect) lo pone verde/rojo vía `GET /api/as400` en el poll de 8 s; señal >30 min sin actividad degrada a gris. |
| 20 | 77. Watcher: carriles FedEx (izq) / Truck (der) con colores de fondo | 2026-06-10 | watchdog #37 | idea-144 | La lista activa es ahora una grilla de dos carriles: FedEx a la izquierda (fondo púrpura) y Truck a la derecha (fondo esmeralda) — paleta FDX/TRK del Verification Board. Conteos en vivo por carril; se apilan en pantallas angostas. Already-in-PickD/Sent/Archived siguen full-width abajo. |
| 21 | 74. Batch de mejoras double-check + watcher (lista del operador 2026-06-10) | 2026-06-10 | #113 · watchdog #32 #33 | idea-141 | Implementado en pickd **#113** y watchdog-pickd **#32/#33** (todo en main): |
| 22 | 68. Al reiniciar la MacBook: Safari (UI) derecha + AS400 izquierda, 50/50 | 2026-06-10 | — (confirmado por el operador) | idea-135 |  |
| 23 | 70. Número de cantidad de distribución: grande, al costado (fuera del gráfico) | 2026-06-10 | `0abcd45` (#115) | idea-137 | **Problema:** el número de cantidad de cada distribución debe verse mucho más grande. |
| 24 | 71. Notas del watcher en rojo | 2026-06-09 | `3da86ea` (#110) | idea-138 | **Hecho (#110):** se muestra `picking_lists.notes` en **rojo** bajo el header en DoubleCheckView y PickingSummaryModal (Orders). Display-only, sin migración. Las notas pasadas con contenido aparecen automáticamente. |
| 25 | 72. DoubleCheckView: últimos 3 dígitos de cada orden mergeada, separados por "/" | 2026-06-09 | `6366544` (#109) | idea-139 | **Decisión operador:** cuando son **exactamente 2** mergeadas, mostrar los **últimos 3 dígitos de cada una separados por "/"** (ej. `083 / 121`). Cuando son **más de 2**, dejar como hoy (lista completa). |
| 26 | Orders PDF preview full-width mobile | 2026-05-27 | `5584273` `aea31b5` | idea-113 | Implementado: sublocation inline a la derecha del SKU en ConsolidationCard + sticky header sub-agrupado por sublocation. PlaceSkuTab tile con chip. Co |
| 27 | SMS Ship-Out — quitar dirección + ocultar Parts/Bikes con qty=0 | 2026-05-27 | `aea31b5` | idea-114 | quitar dirección + ocultar Parts/Bikes con qty=0**~~ ✅ 2026-05-27 — Implementado: dirección eliminada del SMS + Parts/Bikes ocultos si qty=0. Tests ac |
| 28 | Consolidation — ocultar toggle "Bikes only" de la UI (mantener default ON) | 2026-05-27 | `aea31b5` | idea-115 | ocultar toggle "Bikes only" de la UI (mantener default ON)**~~ ✅ 2026-05-27 — Implementado: toggle "Bikes only" eliminado de la UI, onlyBikes hardcode |
| 29 | ConsolidationMoveModal — sublocation seleccionable (chips A-F) en vez de input libre | 2026-05-27 | `aea31b5` | idea-116 | sublocation seleccionable (chips A-F) en vez de input libre**~~ ✅ 2026-05-27 — Implementado: input free-text reemplazado por chips A-F en Consolidatio |
| 30 | Consolidation — filtro "Hide rows" por tab (persistido en localStorage) | 2026-05-27 | `600f2ea` `a2a68f1` | idea-117 | filtro "Hide rows" por tab (persistido en localStorage)**~~ ✅ 2026-05-27 (MVP) — Implementado: nuevo hook `useHiddenRows(modeKey, defaults)` con persi |
| 31 | "Where to put?" logic al marcar SKU en Send to slow / Bring to active | 2026-05-28 | `a04f57c` | idea-122 | Extraído `DestinationList` (componente compartido: corre `suggest_locations_for_sku`, lista rankeada + HiddenRowsPicker propio + expander "show all"). |
| 32 | Where to put? — rediseño completo (autocomplete + solo ROW + panel velocidad) | 2026-05-28 | `5584273` · migración `20260528083212` | idea-118 | rediseño completo (autocomplete + solo ROW + panel velocidad)**~~ ✅ 2026-05-27/28 — Entregado en 4 capas a lo largo de 2 commits: 1. **Autocomplete**  |
| 33 | Consolidation — filtro qty-bucket (Singles / Lines / 1 Tower / 1 Tower+) | 2026-06-01 | `1081286` | idea-125 | filtro qty-bucket (Singles / Lines / 1 Tower / 1 Tower+)**~~ ✅ 2026-06-01 — Nuevo hook `useQtyBucketFilter(modeKey)` con persistencia por modo en `loc |
| 34 | Consolidation — persistir avance al salir (filtros, búsqueda, selección) | 2026-06-01 | `c023d21` | idea-127 | persistir avance al salir (filtros, búsqueda, selección)**~~ ✅ 2026-06-01 — ConsolidationScreen ahora hidrata todo el state relevante desde `localStor |
| 35 | Stock view — visualización Jenga de la distribución encima de cada card | 2026-06-01 | `f98f70c` `78285d1` | idea-126 | visualización Jenga de la distribución encima de cada card**~~ ✅ 2026-06-01 — Nuevo componente `DistributionJengaViz` (franja horizontal a full-width  |
| 36 | Combined orders — suprimir warnings cruzados con órdenes del mismo grupo | 2026-05-27 | `502871f` | idea-119 | suprimir warnings cruzados con órdenes del mismo grupo**~~ ✅ 2026-05-27 — Bug confirmado en dos hooks raíz, no solo uno: `useWaitingConflicts.ts` (wai |
| 37 | 40. Notas de proyecto siempre visibles (quitar line-clamp) | 2026-04-27 | `feaf688` (PR #43) | idea-062 | `line-clamp-2` removido del `TaskCard` en `src/features/projects/ProjectsScreen.tsx`. Verificado: no quedan refs a `line-clamp` en el archivo. PR #43 (bundle). |

### Retired by the operator (now rows in the Descartado table of BACKLOG.md)

| Item | When |
|------|------|
| Separar (un-merge) órdenes combinadas (idea-128) | descartado por el operador 2026-06-09 ("olvida 128") |
| Bug de dirección (imagen de Roman) (idea-133) | retirado 2026-06-10 (operador: quitar del backlog) |
| Auto-captura/envío de órdenes — refinar (idea-136) | retirado 2026-06-10 (operador: quitar del backlog) |
