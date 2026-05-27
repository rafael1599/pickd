# `inventory_logs` MOVE shapes

Updated: 2026-04-29

## TL;DR

A `MOVE` row in `inventory_logs` can have one of two historical shapes for
`quantity_change` / `prev_quantity` / `new_quantity`. Both eras coexist in
production data forever (we do not seed/rewrite the audit log). Always
read MOVE logs through the helper at
`src/features/inventory/utils/inventoryLogShape.ts`. Never branch inline
on `quantity_change == 0`.

## The two shapes

| Shape | Era                             | `quantity_change`                                                | `prev_quantity` → `new_quantity`                  | Meaning                                                                                         |
| ----- | ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **A** | until 2026-04-28 (intermittent) | `0` (when full move) or `newQty - prevQty` (partial / move+edit) | `N` → `N` (full move) or `N` → `newQty` (partial) | Row-state-centric: delta on the row that was relocated in place.                                |
| **B** | 2026-04-29 forward (every MOVE) | `-N` where `N` is the source qty                                 | `N` → `0`                                         | Move-event-centric: "N units left the source perspective". Mirrors the CASE 2 collision branch. |

`Math.abs(quantity_change)` only equals "units moved" under Shape B. For
Shape A, fall back to `prev_quantity` (or `prev_quantity - new_quantity`
for the rare partial / move+edit case).

## Why both existed

`src/features/inventory/api/inventory.service.ts > processItem` had two
branches:

1. **CASE 2 — collision at destination** (the destination row already
   exists, even if `qty=0` and `is_active=false`). Source row is
   updated to `qty=0`; destination is incremented. Audit log emitted as
   `quantity_change: -originalItem.quantity, new_quantity: 0` — Shape B.
2. **CASE 3 — no collision** (the same row gets relocated in place).
   Audit log emitted as `quantity_change: newQty - originalItem.quantity,
new_quantity: newQty`. For a pure move (`newQty == originalItem.quantity`)
   this reduces to `quantity_change: 0` — Shape A.

The mix of users hitting one path vs the other (driven by accumulation
of zero-qty inactive rows, sublocation features, etc.) is what produced
the historical mix.

The CASE 3 emission was changed on 2026-04-29 to mimic CASE 2 for
`action_type === 'MOVE'`. RENAME (`action_type === 'EDIT'`) keeps row-
state semantics because a rename does not move stock.

## How to read MOVE logs

```ts
import { moveDeltaUnits } from 'src/features/inventory/utils/inventoryLogShape';

// Returns the units physically moved, or null if the log is too sparse.
const units = moveDeltaUnits(log);
```

Consumers using the helper today:

- `src/features/reports/hooks/useActivityReport.ts` — Activity Report
  Today's Events tables.
- `src/features/inventory/HistoryScreen.tsx` — generic history list
  display quantity.
- `src/features/inventory/components/ItemDetailView/ItemHistorySheet.tsx`
  — per-SKU history sheet.

`useLastActivity.ts` previously filtered out `quantity_change = 0` rows,
which silently hid Shape A moves from the ghost trail. The filter was
removed on 2026-04-29.

## What NOT to do

- **Do not** rewrite or backfill historical MOVE rows. The append-only
  audit log is sacred even if no external compliance demands it.
- **Do not** branch inline on `quantity_change === 0` to "fix" the read.
  Use the helper instead.
- **Do not** assume `prev_quantity → new_quantity` reflects the actual
  source/destination row state for a MOVE. CASE 2 emits source-after = 0
  while the dest gets the qty; the log row is a single audit record per
  move event, not a per-row delta.

## Related

- Investigation that surfaced this: backlog idea-098 (closed 2026-04-29
  as NO REPRO — no inventory inflation, just an audit-shape inconsistency).
- Migration that consolidated zero-qty rows into the inactive pattern:
  `supabase/migrations/20260415120000_consolidate_zero_qty_inactive.sql`.
