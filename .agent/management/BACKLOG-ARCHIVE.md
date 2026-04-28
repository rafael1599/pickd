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
