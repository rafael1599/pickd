# Overstock Put-Away Plan (Towers & Lines)

MVP design for deciding **where physically** an Overstock/Slow-Mover SKU should
sit inside the merged 3-row block (rows 31, 32, 33 — see `WarehouseMap`).
This is a placement layer on top of infrastructure that already exists; it
does not replace it.

## What already exists (reuse, don't rebuild)

- **Overstock filter** — `OverstockReportModal.tsx` + `get_sku_movement_stats_batch`
  RPC. A SKU qualifies when `orders_completed <= maxOrders` within `months`
  (defaults: 12 orders / 12 months — this doc's filter is just those defaults).
- **Tower/line counts** — `src/utils/containerDistribution.ts`
  (`containerDistribution(qty)`): `towers = floor(qty/30)`, remainder `>= 18`
  rounds up to one more (partial) tower, otherwise remainder becomes
  `ceil(remainder/5)` lines. This doc reuses that function as-is — the
  "18 could go either way" discussion converges on the same threshold, so no
  new counting logic is needed, only _placement_.
- **Display** — `inventory.distribution` (jsonb) + `DistributionJengaViz`
  already render TOWER/LINE glyphs per inventory row. Out of scope here: this
  plan only computes a placement _suggestion_; it does not write to
  `inventory` or `distribution` (see Scope below).

## What's new here: physical placement

### Block layout

Rows 31, 32, 33 are physically merged into one block (no aisle between them)
to save floor space. Aisles run around the block's 4 outer sides only.

- **Row 31** — one long side faces an aisle → every sublocation (A–J) is
  directly reachable. `accessible`.
- **Row 33** — same, the opposite long side faces an aisle. `accessible`.
- **Row 32** — sandwiched between 31 and 33, no side aisle. Only reachable
  from the two ends of the block → **A and J are `accessible`**, **B–I are
  `landlocked`** (no direct pallet/tower access without going through a
  neighboring row).

Each row has 10 sublocations, A–J. Each sublocation has a capacity of 30
units, filled either as one **tower** (mono-SKU, bulk) or as up to **6
lines** (each ≤ 5 units, one SKU per line, multiple SKUs per sublocation
allowed as long as no single line mixes two SKUs). 6 lines × 5 units = 30 —
same capacity either way.

**J is reserved** in all three rows — not assigned to any SKU for now. The
highest-priority qualifying SKUs (per the weighted score below) are placed
closest to J, working inward from I. **31-A and 33-A are forced to always be
towers**, never lines.

### Placement rules

1. **Towers are mono-SKU.** One sublocation = one SKU when used as a tower.
2. **No side preference.** A SKU needing multiple towers can use either 31 or
   33 (or both) — whichever has room. No requirement to keep them together.
3. **Landlocked cells (32, B–I) are tower-only, and only as reserve stock.**
   A tower may be placed in a landlocked cell **only if that SKU already has
   an accessible unit (tower or line) elsewhere** — pickers must never need
   to enter the dead zone to fulfill an order; landlocked stock is pulled
   forward manually when the accessible stock runs out.
4. **Lines are always accessible.** Never placed in a landlocked cell.
5. **No two consecutive line-sublocations** within a row. Lines must
   alternate with at least one tower between them (`... T L T ... `, never
   `... L L ...`). Towers may sit next to each other freely.
6. **Max 6 lines per sublocation**, 5 units per line, one SKU per line (a
   single SKU can occupy more than one line if it needs more than 5 units in
   that bucket).
7. **Picking order**: within a SKU, lines are picked before its tower; within
   a tower, pick from the top (LIFO), decrementing that SKU's total. Same
   picking-priority logic as DoubleCheckView.
8. **No demotion trigger yet.** Moving a SKU out of Overstock once it starts
   moving again is a manual decision for now (MVP) — no automated re-slotting.
9. **Box size is ignored for now.** Capacity assumes uniform units; revisit
   once this is validated on the floor.

### Goal #1: fill the block, not filter purity

The Overstock filter (≤12 orders / 12 months, qty ≥ 3) is a **starting point**,
not a hard cutoff. Leaving sublocations empty is worse than including a SKU
that's slightly more active or slightly lighter in stock than the baseline.
So `useOverstockLayoutPlan` doesn't filter the candidate pool at all — it
ranks **every** bike SKU by a weighted score (see below) and hands the _whole_
ranked list to `planOverstockPutaway`. The greedy placer fills from the top
until the block runs out of room; anything beyond capacity is reported as
`unplaced`.

Because the list is priority-ranked, this reaches past the baseline only as
far as it has to — it can't do better than that with less relaxation. The hook
reports `effectiveMaxOrders` / `effectiveMinQty` (the actual bounds among
placed SKUs) so the UI can show how far it had to loosen past the 12/3
baseline to get a full block.

### Weighted placement score

Placement priority (who gets placed first, and who ends up closest to J)
comes from `rankByWeightedScore` in `src/utils/overstockPutaway.ts` — a single
composite score per SKU, not a strict tie-break chain:

```
score = weights.qty * (totalQty / maxQty) - weights.moved * (ordersCompleted / maxOrders)
```

Both axes are normalized 0-1 against the current candidate pool so the two
weights stay comparable regardless of the pool's actual ranges. Higher score
places first. This lets a SKU with a lot of stock but a few more orders than
another still outrank a barely-stocked SKU that never moved, if that's how
the weights are tuned — instead of one criterion always trumping the other.

Weights are user-adjustable (sliders in `WarehouseMapFilters`, persisted via
`useRankingWeights`), defaulting to `{ qty: 1, moved: 1 }` (`DEFAULT_RANKING_WEIGHTS`).

Regardless of the weights chosen, `orderForPlacement` still runs _after_ the
score sort as a safety net: SKUs needing 2+ towers always go first (stable
within their own rank), so a crowd of small SKUs can never starve out the
landlocked zone by hogging every accessible anchor first (see the regression
test in `overstockPutaway.test.ts`).

### Algorithm (greedy, first-fit)

Input: list of `{ sku, totalQty }`, pre-sorted by the caller in placement
priority order (weighted score, then multi-tower-first — see above).

For each SKU:

1. `{ fullTowers, extraTowerUnits, lineUnits[] } = splitQty(totalQty)` — same
   thresholds as `containerDistribution`, but keeps the actual unit count of
   the partial tower / each line instead of just the count.
2. Place the SKU's **first unit anywhere** (a tower if `fullTowers > 0` or
   `extraTowerUnits > 0`, otherwise its first line) into an **accessible**
   empty sublocation. This guarantees rule 3's precondition before anything
   of this SKU is allowed to go landlocked.
3. Place any **remaining towers**, preferring landlocked empty sublocations
   first (to conserve accessible slots for lines), falling back to
   accessible ones if the landlocked zone is full.
4. Place **lines** into accessible sublocations only:
   - Reuse an existing line-sublocation for this SKU/row if it has a free
     line slot (≤ 6 lines) and isn't full.
   - Otherwise open a new line-sublocation, skipping any candidate whose
     immediate neighbor (previous or next letter in the same row) is also a
     line-sublocation (rule 5).
5. Anything that can't be placed (block is full) is reported as `unplaced`
   with a reason, rather than silently dropped.

### Pull-from info

Each placed slot's tooltip shows where to physically grab the SKU from:
current `location` (+ `sublocation` if set) aggregated from `inventory`,
sorted by quantity so the biggest source shows first. This is display-only —
computed client-side in `useOverstockLayoutPlan`, not persisted anywhere.

## Scope for this pass

- **Pure calculation only.** Produces a suggested plan to visualize on
  `WarehouseMap`; does **not** write to `inventory.location` /
  `inventory.sublocation`. Turning the plan into an actual move is a later,
  separate step (would need a new RPC + confirmation UI, given it mutates
  shared production data).
- Implementation: `src/utils/overstockPutaway.ts` (pure algorithm, shared
  across features) + `src/features/warehouse-management/hooks/useOverstockLayoutPlan.ts`
  (data fetching + ranking).
