# PickD — Backlog Archive

> Items archivados por compactación. Para investigar, usar `git show <commit>` o `git log <commit>..HEAD -- <archivo>`.

---

## Archived 2026-03-27 — 45 items compacted

### Completed P1 features

| # | Item | Completed | Commits | ID |
|---|------|-----------|---------|----|
| 1 | Combinar órdenes del mismo shop | 2026-03-18 | `adff48e` | task-007 |
| 2 | Agrupación visual de órdenes FedEx/General (drag-and-drop) | 2026-03-25 | `adff48e` | idea-010b |
| 3 | Distribución física inteligente | 2026-03-25 | `d46d137` `877d730` | idea-015 |
| 4 | Prevenir reserva duplicada de items en watcher | 2026-03-26 | `221d057` | idea-021 |
| 5 | Filtro de bike bins en Stock View | 2026-03-26 | `91d0005` | idea-022 |
| 6 | Fotos de items (SKU metadata) Fase 1+2 | 2026-03-26 | `a227d99` `c1e4c35` `ab6659f` | idea-023 |
| 7 | Warehouse Selection Refinement | — | — | task-005 |
| 10 | Preservar internal_note al mover item | 2026-03-25 | `5e84c88` | idea-017 |
| 11 | Override cantidad por pallet (Double Check) | 2026-03-24 | `bd17608` | idea-018 |
| 12 | Peso de pallets al peso total del label | 2026-03-24 | `5ace2da` | idea-019 |
| 13 | Auto-parse de dirección completa | 2026-03-24 | `30bfcb7` `6e78224` | idea-020 |

### Completed P2

| Item | Completed | Commits | ID |
|------|-----------|---------|----|
| Order Merging | 2026-03-25 | `adff48e` | idea-010 |

### Resolved bugs

| Bug | Fixed | Root cause | Commits |
|-----|-------|-----------|---------|
| bug-002: Undo borra en vez de mover | 2026-03-23 | snapshot usaba qty post-move, undo no restauraba distribution | `8092bbe` |
| bug-003: Watcher envía items con qty=0 | 2026-03-23 | no filtraba locations con qty=0 antes de ordenar | `87ea90b` |
| bug-004: Órdenes duplicadas al retroceder de double-check | 2026-03-23 | nulleaba activeListId, causaba INSERT en vez de UPDATE | `10ef3f8` |
| bug-005: Items qty=0 en double-check | 2026-03-23 | misma raíz que bug-003 | `87ea90b` |
| bug-006: Orden completada reaparece | 2026-03-23 | misma raíz que bug-004 | `10ef3f8` |
| bug-007: Verification list no muestra órdenes >24h | 2026-03-25 | filtro de 24h en query, takeover no actualizaba updated_at | `3e10c0c` |

### Completed detail table items

| Item | Completed | Commits |
|------|-----------|---------|
| Backfill distribución para items legacy | 2026-03-25 | `877d730` |
| 25 errores TypeScript strict-mode | 2026-03-25 | `d012423` |
| Unidades en vez de SKUs en combined orders | 2026-03-25 | `49151e8` |
| Parser robusto de direcciones US | 2026-03-25 | `e61f625` |
| 39 errores ESLint resueltos en 16 archivos | 2026-03-26 | `30e6db4` |
| Order number en label de pallets | 2026-03-11 | — |
| Barra de capacidad de locations | 2026-03-18 | — |
| Takeover muestra picker real | 2026-03-13 | — |
| Auto-inicio watchdog-pickd | 2026-03-18 | — |
| Stock Printing | — | — |
| iOS Pull-to-Refresh | — | — |
| Stock View Enhancements & History Fix | — | — |
| Multi-user Support (Realtime takeover) | — | — |
| TypeScript Core Migration | — | — |
| Robust Realtime System | — | — |
| Dual-Provider AI (Gemini + OpenAI) | — | — |
| Full English Localization | — | — |
| Management Setup (.agent/) | — | — |
| Warehouse Selection Basic | — | — |

### Verified behaviors (snapshot 2026-03-27)

> Behaviors verified at the time of archival; line numbers may have drifted.

| Behavior | Originally verified |
|----------|-------------------|
| Orden completada no regresa a double-check | 2026-03-11 |
| Order number en label de impresión | 2026-03-11 |
| Jalar medidas al seleccionar item | 2026-03-11 |
| Buscador de locations mantiene opciones | 2026-03-11 |
| Persistencia de nueva location al agregar | 2026-03-11 |
| Order number clickeable en History | 2026-03-11 |
| Validación de items con 0 unidades | 2026-03-11 |
| Consolidation: desglose multi-tipo | 2026-03-10 |
| Limpieza distribution stale (qty=0) | 2026-03-11 |
| Picked by / Checked by | 2026-03-11 |
| Long-press → modal detalle + Edit | 2026-03-11 |
| Performance: memoize + stabilize refs | 2026-03-11 |
| Fix: infinite re-render InventoryModal | 2026-03-11 |
| Fix: infinite fetch loop distribution | 2026-03-10 |
| Test: distribution e2e + realtime | 2026-03-10 |
| Script: prod→local data sync | 2026-03-11 |

---
