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
