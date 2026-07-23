// Physical put-away planner for Overstock/Slow-Mover SKUs.
//
// Takes SKUs that already passed the Overstock filter (see
// OverstockReportModal / get_sku_movement_stats_batch) and decides WHERE in
// the merged 3-row block (31/32/33, see WarehouseMap) each SKU's towers and
// lines should sit. Pure calculation — does not write to `inventory`.
//
// Rules are documented in docs/overstock-putaway-plan.md. Candidates are
// expected to already be sorted by caller in the priority order they should
// be placed (e.g. least-moved first, so they land closest to J).

export const ROWS = ['31', '32', '33'] as const;
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

export const TOWER_CAPACITY = 30;
export const LINE_CAPACITY = 5;
export const MAX_LINES_PER_SUBLOCATION = 6;

/** J is reserved — never assigned to a SKU (for now). */
export const RESERVED_LETTER: (typeof LETTERS)[number] = 'J';

/** These two slots must always be towers, never lines. */
export const FORCED_TOWER_SLOT_IDS = ['31-A', '33-A'];

export type Accessibility = 'accessible' | 'landlocked';

export interface SublocationSlot {
  id: string;
  row: (typeof ROWS)[number];
  letter: (typeof LETTERS)[number];
  accessibility: Accessibility;
}

export type SlotUsage =
  | { kind: 'empty' }
  | { kind: 'reserved' }
  | { kind: 'tower'; sku: string; units: number }
  | { kind: 'lines'; entries: { sku: string; units: number }[] };

export interface PlannedSlot extends SublocationSlot {
  usage: SlotUsage;
}

export interface OverstockCandidate {
  sku: string;
  totalQty: number;
}

export interface UnplacedUnit {
  sku: string;
  units: number;
  reason: string;
}

export interface PutawayPlan {
  slots: PlannedSlot[];
  unplaced: UnplacedUnit[];
}

/** Row 32's middle sublocations have no side aisle — no direct tower/pallet access. */
function accessibilityFor(
  row: (typeof ROWS)[number],
  letter: (typeof LETTERS)[number]
): Accessibility {
  if (row !== '32') return 'accessible';
  return letter === 'A' || letter === 'J' ? 'accessible' : 'landlocked';
}

export function buildBlockLayout(): PlannedSlot[] {
  return ROWS.flatMap((row) =>
    LETTERS.map((letter) => ({
      id: `${row}-${letter}`,
      row,
      letter,
      accessibility: accessibilityFor(row, letter),
      usage:
        letter === RESERVED_LETTER ? { kind: 'reserved' as const } : { kind: 'empty' as const },
    }))
  );
}

/**
 * Same thresholds as containerDistribution, but keeps the actual unit count
 * of the partial tower / each line instead of just counts.
 */
export function splitQty(qty: number): {
  fullTowers: number;
  extraTowerUnits: number;
  lineUnits: number[];
} {
  if (!Number.isFinite(qty) || qty <= 0) {
    return { fullTowers: 0, extraTowerUnits: 0, lineUnits: [] };
  }
  const fullTowers = Math.floor(qty / TOWER_CAPACITY);
  const remainder = qty % TOWER_CAPACITY;

  if (remainder >= 18) {
    return { fullTowers, extraTowerUnits: remainder, lineUnits: [] };
  }

  const lineUnits: number[] = [];
  let left = remainder;
  while (left > 0) {
    const chunk = Math.min(LINE_CAPACITY, left);
    lineUnits.push(chunk);
    left -= chunk;
  }
  return { fullTowers, extraTowerUnits: 0, lineUnits };
}

function isEmpty(slot: PlannedSlot): boolean {
  return slot.usage.kind === 'empty';
}

/** Distance from J — 0 = J itself, 1 = I, 2 = H, etc. Lower = closer to J = higher priority. */
function distanceFromJ(letter: (typeof LETTERS)[number]): number {
  return LETTERS.length - 1 - LETTERS.indexOf(letter);
}

function byProximityToJ(a: PlannedSlot, b: PlannedSlot): number {
  return distanceFromJ(a.letter) - distanceFromJ(b.letter);
}

function neighborIsLineSlot(slots: PlannedSlot[], slot: PlannedSlot): boolean {
  const idx = LETTERS.indexOf(slot.letter);
  const prev = idx > 0 ? LETTERS[idx - 1] : null;
  const next = idx < LETTERS.length - 1 ? LETTERS[idx + 1] : null;
  return slots.some(
    (s) =>
      s.row === slot.row && (s.letter === prev || s.letter === next) && s.usage.kind === 'lines'
  );
}

/** The up-to-2 immediate letter-neighbors of a slot, same row. */
function adjacentSlots(slots: PlannedSlot[], anchor: PlannedSlot): PlannedSlot[] {
  const idx = LETTERS.indexOf(anchor.letter);
  const letters = [
    idx > 0 ? LETTERS[idx - 1] : null,
    idx < LETTERS.length - 1 ? LETTERS[idx + 1] : null,
  ].filter((l): l is (typeof LETTERS)[number] => l !== null);
  return letters
    .map((letter) => slots.find((s) => s.row === anchor.row && s.letter === letter))
    .filter((s): s is PlannedSlot => s !== undefined);
}

/**
 * A shared line cell can end up with several unrelated SKUs' entries in it.
 * If one of the cell's two letter-neighbors is a tower, and that tower's
 * SKU also has a line entry in this cell, that entry needs to sit at the
 * edge of the list closest to that tower — otherwise it can read as
 * "buried" in the middle of unrelated SKUs even though the sublocation
 * itself is already the tower's direct neighbor. Insertion order during
 * placement can't guarantee this on its own (a later, unrelated SKU can
 * always push in after an earlier tower-facing entry), so this runs once,
 * after every SKU has been placed, as a final presentation pass — it never
 * moves anything between sublocations, only reorders entries within one.
 */
function reorderLinesToFaceTowers(slots: PlannedSlot[]): void {
  for (const slot of slots) {
    if (slot.usage.kind !== 'lines') continue;
    const [prevSlot, nextSlot] = [-1, 1].map((delta) => {
      const letter = LETTERS[LETTERS.indexOf(slot.letter) + delta];
      return letter ? slots.find((s) => s.row === slot.row && s.letter === letter) : undefined;
    });
    const prevSku = prevSlot?.usage.kind === 'tower' ? prevSlot.usage.sku : undefined;
    const nextSku = nextSlot?.usage.kind === 'tower' ? nextSlot.usage.sku : undefined;
    if (!prevSku && !nextSku) continue;

    const entries = slot.usage.entries;
    const facingPrev = prevSku ? entries.filter((e) => e.sku === prevSku) : [];
    const facingNext = nextSku ? entries.filter((e) => e.sku === nextSku) : [];
    const rest = entries.filter((e) => e.sku !== prevSku && e.sku !== nextSku);
    slot.usage.entries = [...facingPrev, ...rest, ...facingNext];
  }
}

function placeTower(
  slots: PlannedSlot[],
  sku: string,
  units: number,
  preferLandlocked: boolean
): PlannedSlot | null {
  const pool = (accessibility: Accessibility) =>
    slots
      .filter(isEmpty)
      .filter((s) => s.accessibility === accessibility)
      .sort(byProximityToJ);
  const candidates = pool(preferLandlocked ? 'landlocked' : 'accessible');
  const fallback = preferLandlocked ? pool('accessible') : [];
  const target = candidates[0] ?? fallback[0];
  if (!target) return null;
  target.usage = { kind: 'tower', sku, units };
  return target;
}

/**
 * @param anchorSlot If this SKU already has a tower, its line remainder must
 * never drift away from it — the furthest it's allowed to land is one of the
 * tower's immediate (always-accessible) neighbors in the same row. No
 * `anchorSlot` means this SKU has no tower (pure-lines), so the normal
 * proximity-to-J placement applies instead.
 */
function placeLine(
  slots: PlannedSlot[],
  sku: string,
  units: number,
  anchorSlot?: PlannedSlot
): boolean {
  const notForcedTower = (s: PlannedSlot) => !FORCED_TOWER_SLOT_IDS.includes(s.id);

  // Prefer topping off a sublocation that already has a line for this SKU
  // (keeps a SKU's own multi-chunk lines together — if that slot was chosen
  // as a tower's neighbor, this keeps every later chunk there too).
  const existing = slots
    .filter(
      (s) =>
        s.accessibility === 'accessible' &&
        s.usage.kind === 'lines' &&
        s.usage.entries.length < MAX_LINES_PER_SUBLOCATION &&
        s.usage.entries.some((e) => e.sku === sku)
    )
    .sort(byProximityToJ)[0];
  if (existing && existing.usage.kind === 'lines') {
    existing.usage.entries.push({ sku, units });
    return true;
  }

  if (anchorSlot) {
    const neighbors = adjacentSlots(slots, anchorSlot);

    const emptyNeighbor = neighbors
      .filter(
        (s) =>
          s.accessibility === 'accessible' &&
          isEmpty(s) &&
          notForcedTower(s) &&
          !neighborIsLineSlot(slots, s)
      )
      .sort(byProximityToJ)[0];
    if (emptyNeighbor) {
      emptyNeighbor.usage = { kind: 'lines', entries: [{ sku, units }] };
      return true;
    }

    // A neighbor already running someone else's lines, with room, still
    // keeps this SKU physically next to its own tower.
    const neighborWithRoom = neighbors
      .filter(
        (s) =>
          s.accessibility === 'accessible' &&
          s.usage.kind === 'lines' &&
          s.usage.entries.length < MAX_LINES_PER_SUBLOCATION
      )
      .sort(byProximityToJ)[0];
    if (neighborWithRoom && neighborWithRoom.usage.kind === 'lines') {
      neighborWithRoom.usage.entries.push({ sku, units });
      return true;
    }

    // Never drift further than a neighbor of this SKU's own tower.
    return false;
  }

  // No tower anchor (pure-lines SKU) — any accessible sublocation already running lines with room.
  const openSlot = slots
    .filter(
      (s) =>
        s.accessibility === 'accessible' &&
        s.usage.kind === 'lines' &&
        s.usage.entries.length < MAX_LINES_PER_SUBLOCATION
    )
    .sort(byProximityToJ)[0];
  if (openSlot && openSlot.usage.kind === 'lines') {
    openSlot.usage.entries.push({ sku, units });
    return true;
  }

  // Open a new line-sublocation — must not sit next to another line-sublocation,
  // and never on a slot reserved for towers only.
  const newSlot = slots
    .filter(
      (s) =>
        s.accessibility === 'accessible' &&
        isEmpty(s) &&
        notForcedTower(s) &&
        !neighborIsLineSlot(slots, s)
    )
    .sort(byProximityToJ)[0];
  if (!newSlot) return false;
  newSlot.usage = { kind: 'lines', entries: [{ sku, units }] };
  return true;
}

/**
 * @param candidates Must already be sorted by the caller in placement
 * priority order (e.g. least-moved-first, so it lands closest to J).
 */
export function planOverstockPutaway(candidates: OverstockCandidate[]): PutawayPlan {
  const slots = buildBlockLayout();
  const unplaced: UnplacedUnit[] = [];

  for (const { sku, totalQty } of candidates) {
    const { fullTowers, extraTowerUnits, lineUnits } = splitQty(totalQty);
    let hasAccessiblePlacement = false;
    let anchorTowerSlot: PlannedSlot | undefined;
    // Smallest-first: the partial tower (18-29 units, always smaller than a
    // full 30-unit one) goes first so it wins the guaranteed-accessible
    // anchor spot — same principle as lines always being accessible, just
    // applied to towers too. Full towers (all equal size) are the ones that
    // absorb the landlocked reserve space.
    const towerUnitsQueue = [
      ...(extraTowerUnits > 0 ? [extraTowerUnits] : []),
      ...Array(fullTowers).fill(TOWER_CAPACITY),
    ];
    const linesQueue = [...lineUnits];

    // First unit of this SKU must land somewhere accessible (rule 3's precondition).
    if (towerUnitsQueue.length > 0) {
      const units = towerUnitsQueue.shift() as number;
      const placed = placeTower(slots, sku, units, false);
      if (placed) {
        hasAccessiblePlacement = true;
        anchorTowerSlot = placed;
      } else {
        unplaced.push({ sku, units, reason: 'No accessible sublocation available' });
      }
    } else if (linesQueue.length > 0) {
      const units = linesQueue.shift() as number;
      if (placeLine(slots, sku, units)) {
        hasAccessiblePlacement = true;
      } else {
        unplaced.push({ sku, units, reason: 'No accessible sublocation available for line' });
      }
    }

    // Remaining towers: prefer landlocked (only allowed now that this SKU has accessible stock).
    while (towerUnitsQueue.length > 0) {
      const units = towerUnitsQueue.shift() as number;
      if (!placeTower(slots, sku, units, hasAccessiblePlacement)) {
        unplaced.push({ sku, units, reason: 'Block is full' });
      }
    }

    // Remaining lines: glued to this SKU's own tower (its immediate
    // neighbor) if it has one — never left to drift elsewhere in the block.
    while (linesQueue.length > 0) {
      const units = linesQueue.shift() as number;
      if (!placeLine(slots, sku, units, anchorTowerSlot)) {
        unplaced.push({
          sku,
          units,
          reason: anchorTowerSlot
            ? "No accessible sublocation next to this SKU's tower"
            : 'No accessible line capacity left',
        });
      }
    }
  }

  reorderLinesToFaceTowers(slots);
  return { slots, unplaced };
}

/**
 * Placement order, in three tiers (each tier keeps its incoming — i.e.
 * score-ranked — relative order):
 *   1. Pinned SKUs — a specific list someone decided needs a slot right now
 *      (e.g. pallets already sorted into "goes to this block"). These always
 *      go first, guaranteeing them a spot as long as the block has room.
 *   2. Candidates needing 2+ towers — otherwise a crowd of many small
 *      never-moved SKUs (all tied on orders=0) can grab every accessible
 *      anchor slot before a genuinely large overstock SKU gets a turn,
 *      leaving the landlocked zone empty even though it's exactly what that
 *      zone is for.
 *   3. Everything else.
 */
export function orderForPlacement<T extends OverstockCandidate>(
  candidates: T[],
  pinnedSkus: ReadonlySet<string> = new Set()
): T[] {
  const pinned: T[] = [];
  const multiTower: T[] = [];
  const rest: T[] = [];
  for (const c of candidates) {
    if (pinnedSkus.has(c.sku)) {
      pinned.push(c);
      continue;
    }
    const { fullTowers, extraTowerUnits } = splitQty(c.totalQty);
    const towerCount = fullTowers + (extraTowerUnits > 0 ? 1 : 0);
    (towerCount >= 2 ? multiTower : rest).push(c);
  }
  return [...pinned, ...multiTower, ...rest];
}

export interface RankingWeights {
  /** How much having a lot of stock bumps placement priority (fills efficiently). */
  qty: number;
  /** How much having few/no completed orders bumps placement priority (closer to J). */
  moved: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = { qty: 1, moved: 1 };

/**
 * Composite priority score, normalized 0-1 per axis so the two weights are
 * comparable regardless of the pool's actual qty/order ranges:
 *   score = weights.qty * (qty / maxQty) - weights.moved * (orders / maxOrders)
 * Higher score places first (and ends up closer to J). Both axes are blended
 * rather than one strictly overriding the other, so e.g. a huge-stock SKU
 * that moved a little can still outrank a barely-stocked SKU that never
 * moved, depending on how the weights are tuned.
 */
export function rankByWeightedScore<T extends OverstockCandidate & { ordersCompleted: number }>(
  candidates: T[],
  weights: RankingWeights
): T[] {
  let maxQty = 1;
  let maxOrders = 1;
  for (const c of candidates) {
    if (c.totalQty > maxQty) maxQty = c.totalQty;
    if (c.ordersCompleted > maxOrders) maxOrders = c.ordersCompleted;
  }
  const score = (c: T) =>
    weights.qty * (c.totalQty / maxQty) - weights.moved * (c.ordersCompleted / maxOrders);
  return [...candidates].sort((a, b) => score(b) - score(a));
}

export interface OverstockPlanComputation<T extends OverstockCandidate> {
  plan: PutawayPlan;
  candidates: T[];
  effectiveMaxOrders: number;
  effectiveMinQty: number;
}

/**
 * Filters out excluded SKUs, ranks the rest by weighted score, orders for
 * placement (pinned SKUs first, then multi-tower — both independent of the
 * weights), runs the placer, and reports how far past the baseline
 * thresholds we had to reach to get this fill (see
 * docs/overstock-putaway-plan.md).
 */
export function computeOverstockPlan<T extends OverstockCandidate & { ordersCompleted: number }>(
  pool: T[],
  excludedSkus: ReadonlySet<string>,
  baseline: { maxOrders: number; minQty: number },
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  pinnedSkus: ReadonlySet<string> = new Set()
): OverstockPlanComputation<T> {
  const candidates = pool.filter((c) => !excludedSkus.has(c.sku));
  const ranked = rankByWeightedScore(candidates, weights);
  const plan = planOverstockPutaway(orderForPlacement(ranked, pinnedSkus));

  const placedSkus = new Set(
    plan.slots.flatMap((s) =>
      s.usage.kind === 'tower'
        ? [s.usage.sku]
        : s.usage.kind === 'lines'
          ? s.usage.entries.map((e) => e.sku)
          : []
    )
  );
  const placedCandidates = candidates.filter((c) => placedSkus.has(c.sku));
  const effectiveMaxOrders = placedCandidates.reduce(
    (max, c) => Math.max(max, c.ordersCompleted),
    baseline.maxOrders
  );
  const effectiveMinQty = placedCandidates.reduce(
    (min, c) => Math.min(min, c.totalQty),
    baseline.minQty
  );

  return { plan, candidates, effectiveMaxOrders, effectiveMinQty };
}
