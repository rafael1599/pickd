// DS-Pallet put-away planner.
//
// Replaces the tower/line model of overstockPutaway.ts inside the managed
// blocks: one sublocation now holds exactly one double-stacked pallet of a
// single SKU, between DS_PALLET_MIN and DS_PALLET_MAX units. Anything that
// can't form a pallet goes to Pull First and is resolved by hand on the floor.
//
// Rules are documented in docs/prds/warehouse-ds-pallet-blocks.md. This module
// is pure calculation — it never writes to `inventory`.
//
// Two things differ structurally from the old planner:
//   1. The number of positions per row is configuration, not a constant
//      (RF-011b) — the floor is being re-labelled manually from ~6 double
//      slots to ~12 individual ones, and the map has to follow without a
//      code change.
//   2. A SKU that already sits inside its block keeps its exact cell
//      (RF-012). Placement only decides where the newcomers go.

export const DS_PALLET_MAX = 25;
export const DS_PALLET_MIN_DEFAULT = 20;

/** Bumped whenever the persisted plan shape changes; older plans are discarded, not migrated (RNF-004). */
export const PLAN_VERSION = 2;

export type Accessibility = 'accessible' | 'landlocked';

export interface BlockConfig {
  id: string;
  label: string;
  /** Left-to-right, as they sit on the floor. The middle one is landlocked. */
  rows: string[];
  /** RF-011b — read from configuration, never hardcoded downstream. */
  positionsPerRow: number;
  /** RF-011c — the last position of each row is never assigned. Only inside managed blocks. */
  reserveLastPosition: boolean;
}

export const BLOCK_A: BlockConfig = {
  id: 'A',
  label: 'ROW 31/32/33',
  rows: ['31', '32', '33'],
  positionsPerRow: 10,
  reserveLastPosition: true,
};

export const BLOCK_B: BlockConfig = {
  id: 'B',
  label: 'ROW 28/29/30',
  rows: ['28', '29', '30'],
  positionsPerRow: 10,
  reserveLastPosition: true,
};

export const BLOCKS: BlockConfig[] = [BLOCK_A, BLOCK_B];

export type SlotUsage =
  | { kind: 'empty' }
  | { kind: 'reserved' }
  /** `anchored` distinguishes "was already here" from "the planner put it here" (RNF-002). */
  | { kind: 'pallet'; sku: string; units: number; anchored: boolean };

export interface PalletSlot {
  id: string;
  row: string;
  letter: string;
  accessibility: Accessibility;
  usage: SlotUsage;
}

/** Where a SKU physically sits today, used to honour its anchor. */
export interface CurrentPlacement {
  row: string;
  letter: string;
  units: number;
}

export interface NoMoverCandidate {
  sku: string;
  totalQty: number;
  /** Which block this SKU belongs to. A SKU belongs to exactly one (RF-004). */
  blockId: string;
  /** Current physical cells. Only those inside `blockId` produce an anchor. */
  currentPlacements?: CurrentPlacement[];
}

export type PullFirstReason = 'below-min' | 'partition-remainder' | 'no-space';

export interface PullFirstEntry {
  sku: string;
  units: number;
  /**
   * The SKU's whole stock when the plan was built. Carried on the entry rather
   * than looked up live: the plan is read long after it was saved, often on
   * paper, and a total fetched now would describe a different day. Absent on
   * plans written before it was recorded.
   */
  total?: number;
  /** Human-readable origin, e.g. "ROW 31 · B". Absent when the SKU has no current cell. */
  from?: string;
  reason: PullFirstReason;
}

export interface BlockPlan {
  planVersion: number;
  blockId: string;
  slots: PalletSlot[];
  pullFirst: PullFirstEntry[];
}

export interface PlannerOptions {
  /** RF-010 — user-editable. The max is fixed: it's the pallet's physical capacity. */
  minUnits?: number;
}

/** A, B, C … Z, then AA, AB … for rows longer than 26 positions. */
export function positionLetters(count: number): string[] {
  const letters: string[] = [];
  for (let i = 0; i < count; i++) {
    let n = i;
    let label = '';
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    letters.push(label);
  }
  return letters;
}

/**
 * The middle row of a block is sandwiched between the other two, so only its
 * two end positions touch an aisle. Outer rows are reachable along their whole
 * length.
 */
function accessibilityFor(
  block: BlockConfig,
  rowIndex: number,
  letterIndex: number
): Accessibility {
  const isMiddleRow = rowIndex === Math.floor(block.rows.length / 2) && block.rows.length === 3;
  if (!isMiddleRow) return 'accessible';
  const isEnd = letterIndex === 0 || letterIndex === block.positionsPerRow - 1;
  return isEnd ? 'accessible' : 'landlocked';
}

export function buildBlockLayout(block: BlockConfig): PalletSlot[] {
  const letters = positionLetters(block.positionsPerRow);
  const lastIndex = block.positionsPerRow - 1;

  return block.rows.flatMap((row, rowIndex) =>
    letters.map((letter, letterIndex) => ({
      id: `${row}-${letter}`,
      row,
      letter,
      accessibility: accessibilityFor(block, rowIndex, letterIndex),
      usage:
        block.reserveLastPosition && letterIndex === lastIndex
          ? ({ kind: 'reserved' } as const)
          : ({ kind: 'empty' } as const),
    }))
  );
}

/**
 * Splits a quantity into full pallets plus whatever can't form one (RF-008).
 *
 * The remainder is never spread across the other pallets to top them up — the
 * whole point of the model is that the stacker can trust "a pallet holds 25"
 * without counting. A remainder that reaches the minimum earns its own pallet;
 * below that it leaves the block entirely.
 */
export function splitIntoPallets(
  qty: number,
  minUnits: number = DS_PALLET_MIN_DEFAULT
): { pallets: number[]; leftover: number } {
  if (!Number.isFinite(qty) || qty <= 0) return { pallets: [], leftover: 0 };

  const fullPallets = Math.floor(qty / DS_PALLET_MAX);
  const remainder = qty % DS_PALLET_MAX;
  const pallets = Array(fullPallets).fill(DS_PALLET_MAX) as number[];

  if (remainder >= minUnits) {
    return { pallets: [...pallets, remainder], leftover: 0 };
  }
  return { pallets, leftover: remainder };
}

function isEmpty(slot: PalletSlot): boolean {
  return slot.usage.kind === 'empty';
}

function formatOrigin(row: string, letter?: string): string {
  return letter ? `ROW ${row} · ${letter}` : `ROW ${row}`;
}

/**
 * Distance from the far end of the row — 0 = last position. Closest to the end
 * wins, which is how the old planner ordered towers and matches how the block
 * is walked.
 */
function proximityRank(slot: PalletSlot, letters: string[]): number {
  return letters.length - 1 - letters.indexOf(slot.letter);
}

function placePallet(
  slots: PalletSlot[],
  letters: string[],
  sku: string,
  units: number,
  preferLandlocked: boolean
): PalletSlot | null {
  const pool = (accessibility: Accessibility) =>
    slots
      .filter(isEmpty)
      .filter((s) => s.accessibility === accessibility)
      .sort((a, b) => proximityRank(a, letters) - proximityRank(b, letters));

  const primary = pool(preferLandlocked ? 'landlocked' : 'accessible');
  const fallback = pool(preferLandlocked ? 'accessible' : 'landlocked');
  const target = primary[0] ?? fallback[0];
  if (!target) return null;

  target.usage = { kind: 'pallet', sku, units, anchored: false };
  return target;
}

/**
 * Placement order. Multi-pallet SKUs go first so a crowd of small ones can't
 * grab every accessible cell and leave the landlocked reserve empty — that
 * zone exists precisely to absorb the bulk of a large SKU.
 */
export function orderForPlacement<T extends NoMoverCandidate>(
  candidates: T[],
  minUnits: number = DS_PALLET_MIN_DEFAULT
): T[] {
  const multi: T[] = [];
  const rest: T[] = [];
  for (const c of candidates) {
    const { pallets } = splitIntoPallets(c.totalQty, minUnits);
    (pallets.length >= 2 ? multi : rest).push(c);
  }
  return [...multi, ...rest];
}

interface ResolvedAnchor {
  candidate: NoMoverCandidate;
  slot: PalletSlot;
  placement: CurrentPlacement;
}

/**
 * Decides which anchors survive (RF-012 + the conflict table in §7 of the PRD):
 *
 *   - Under the minimum → the cell is freed and the units go to Pull First.
 *     The minimum wins over the anchor; a short pallet defeats the model.
 *   - Two SKUs anchored to the same cell → the larger quantity keeps it. This
 *     is a real case: today a cell can hold several SKUs' lines, and the new
 *     model only fits one.
 *   - Anything the anchor doesn't cover is handled as a normal placement.
 */
function resolveAnchors(
  candidates: NoMoverCandidate[],
  block: BlockConfig,
  slots: PalletSlot[],
  minUnits: number,
  pullFirst: PullFirstEntry[]
): Map<string, ResolvedAnchor> {
  const byCell = new Map<string, ResolvedAnchor[]>();

  for (const candidate of candidates) {
    for (const placement of candidate.currentPlacements ?? []) {
      if (!block.rows.includes(placement.row)) continue;
      const slot = slots.find((s) => s.row === placement.row && s.letter === placement.letter);
      if (!slot || slot.usage.kind === 'reserved') continue;

      const list = byCell.get(slot.id) ?? [];
      list.push({ candidate, slot, placement });
      byCell.set(slot.id, list);
    }
  }

  const winners = new Map<string, ResolvedAnchor>();

  for (const contenders of byCell.values()) {
    const sorted = [...contenders].sort((a, b) => b.placement.units - a.placement.units);
    const [winner, ...losers] = sorted;

    // Losers of a cell collision aren't punished — they simply lose the anchor
    // and get placed as if they came from outside the block.
    void losers;

    if (winner.candidate.totalQty < minUnits) {
      pullFirst.push({
        sku: winner.candidate.sku,
        units: winner.candidate.totalQty,
        total: winner.candidate.totalQty,
        from: formatOrigin(winner.slot.row, winner.slot.letter),
        reason: 'below-min',
      });
      continue;
    }

    // A SKU with stock spread over several cells only keeps one anchor: the
    // fullest. The rest of its units are placed normally.
    const existing = winners.get(winner.candidate.sku);
    if (existing && existing.placement.units >= winner.placement.units) continue;
    if (existing) winners.delete(existing.slot.id);

    winners.set(winner.candidate.sku, winner);
  }

  return winners;
}

/**
 * @param candidates No-movers assigned to this block. Callers should pass them
 * already filtered — this function does not decide who is a no-mover.
 */
export function planBlock(
  block: BlockConfig,
  candidates: NoMoverCandidate[],
  options: PlannerOptions = {}
): BlockPlan {
  const minUnits = options.minUnits ?? DS_PALLET_MIN_DEFAULT;
  const letters = positionLetters(block.positionsPerRow);
  const slots = buildBlockLayout(block);
  const pullFirst: PullFirstEntry[] = [];

  const mine = candidates.filter((c) => c.blockId === block.id);

  // A SKU under the minimum never occupies a cell, anchored or not (RF-009).
  const eligible: NoMoverCandidate[] = [];
  for (const candidate of mine) {
    if (candidate.totalQty < minUnits) {
      const first = (candidate.currentPlacements ?? []).find((p) => block.rows.includes(p.row));
      pullFirst.push({
        sku: candidate.sku,
        units: candidate.totalQty,
        total: candidate.totalQty,
        from: first ? formatOrigin(first.row, first.letter) : undefined,
        reason: 'below-min',
      });
      continue;
    }
    eligible.push(candidate);
  }

  const anchors = resolveAnchors(eligible, block, slots, minUnits, pullFirst);

  // Anchored pallets are written first so placement can't steal their cells.
  const remainingUnits = new Map<string, number>();
  for (const candidate of eligible) {
    const anchor = anchors.get(candidate.sku);
    if (!anchor) {
      remainingUnits.set(candidate.sku, candidate.totalQty);
      continue;
    }
    const units = Math.min(candidate.totalQty, DS_PALLET_MAX);
    anchor.slot.usage = { kind: 'pallet', sku: candidate.sku, units, anchored: true };
    remainingUnits.set(candidate.sku, candidate.totalQty - units);
  }

  for (const candidate of orderForPlacement(eligible, minUnits)) {
    const left = remainingUnits.get(candidate.sku) ?? 0;
    if (left <= 0) continue;

    const { pallets, leftover } = splitIntoPallets(left, minUnits);
    const origin = (candidate.currentPlacements ?? [])[0];
    const from = origin ? formatOrigin(origin.row, origin.letter) : undefined;

    let hasAccessible = anchors.has(candidate.sku);
    for (const units of pallets) {
      const placed = placePallet(slots, letters, candidate.sku, units, hasAccessible);
      if (!placed) {
        pullFirst.push({
          sku: candidate.sku,
          units,
          total: candidate.totalQty,
          from,
          reason: 'no-space',
        });
        continue;
      }
      if (placed.accessibility === 'accessible') hasAccessible = true;
    }

    if (leftover > 0) {
      pullFirst.push({
        sku: candidate.sku,
        units: leftover,
        total: candidate.totalQty,
        from,
        reason: 'partition-remainder',
      });
    }
  }

  return { planVersion: PLAN_VERSION, blockId: block.id, slots, pullFirst };
}

/** Total units a block can hold given its configuration — `3n − 3` cells when the last position is reserved. */
export function blockCapacity(block: BlockConfig): { cells: number; units: number } {
  const perRow = block.positionsPerRow - (block.reserveLastPosition ? 1 : 0);
  const cells = perRow * block.rows.length;
  return { cells, units: cells * DS_PALLET_MAX };
}

/** A bike offered to the blocks, before it belongs to either of them. */
export interface PoolCandidate {
  sku: string;
  totalQty: number;
  /** Orders in the last 12 months. Absent counts as unknown, never as zero. */
  ordersCompleted?: number;
  /** Where its units sit today. A cell inside a block both anchors and assigns it. */
  currentPlacements?: CurrentPlacement[];
  /** Set when someone put this SKU on a block's list by hand; that decision wins. */
  pinnedBlockId?: string;
}

/**
 * How apt a candidate is, expressed as the band the operator prefers.
 *
 * These are ranking inputs, not gates. Measured against production, "0 orders
 * and >= 21 units" describes five bikes for 54 cells — as a filter it empties
 * the blocks. Inside the band goes first; outside still gets placed.
 */
export interface AptitudeCriteria {
  /** Orders at or below which a bike is preferred. */
  maxOrders: number;
  /** Units at or above which a bike is preferred. Not a floor. */
  minStock: number;
}

export const APTITUDE_DEFAULTS: AptitudeCriteria = { maxOrders: 0, minStock: 21 };

/** Inside the preferred band: quiet enough and deep enough to be a first choice. */
function isPreferred(c: PoolCandidate, criteria: AptitudeCriteria): boolean {
  return (
    (c.ordersCompleted ?? Number.POSITIVE_INFINITY) <= criteria.maxOrders &&
    c.totalQty >= criteria.minStock
  );
}

/**
 * Merit order: the band first, then the quietest, then the deepest stock.
 *
 * Ties break on SKU so the result never depends on which block was
 * recalculated, and an unknown order count sorts last rather than passing for
 * zero — a bike we know nothing about is not a first choice.
 */
export function rankCandidates<T extends PoolCandidate>(
  pool: T[],
  criteria: AptitudeCriteria = APTITUDE_DEFAULTS
): T[] {
  return [...pool].sort((a, b) => {
    const band = Number(isPreferred(b, criteria)) - Number(isPreferred(a, criteria));
    if (band !== 0) return band;

    const orders =
      (a.ordersCompleted ?? Number.POSITIVE_INFINITY) -
      (b.ordersCompleted ?? Number.POSITIVE_INFINITY);
    if (orders !== 0) return orders;

    return b.totalQty - a.totalQty || a.sku.localeCompare(b.sku);
  });
}

/**
 * Hands every candidate to a block, filling both to capacity.
 *
 * The blocks are meant to end up full: an empty sublocation is wasted floor,
 * and curating two lists by hand to achieve that is work nobody should do. So
 * assignment is automatic, and only two things override it — a SKU pinned to a
 * block by hand, and a SKU already standing in a block's rows, which keeps its
 * cell (RF-012).
 *
 * The rest goes in merit order (see rankCandidates), each to whichever block
 * has the most cells still to fill. Ranking decides who gets offered a cell
 * first; capacity still decides whether they fit.
 */
export function assignCandidates(
  pool: PoolCandidate[],
  blocks: BlockConfig[],
  minUnits: number = DS_PALLET_MIN_DEFAULT,
  criteria: AptitudeCriteria = APTITUDE_DEFAULTS
): Map<string, NoMoverCandidate[]> {
  const assigned = new Map<string, NoMoverCandidate[]>(blocks.map((b) => [b.id, []]));
  const remaining = new Map<string, number>(blocks.map((b) => [b.id, blockCapacity(b).cells]));

  const rowOwner = new Map<string, string>();
  for (const block of blocks) {
    for (const row of block.rows) rowOwner.set(row, block.id);
  }

  const take = (blockId: string, candidate: PoolCandidate) => {
    assigned.get(blockId)?.push({
      sku: candidate.sku,
      totalQty: candidate.totalQty,
      blockId,
      currentPlacements: candidate.currentPlacements,
    });
    const cells = splitIntoPallets(candidate.totalQty, minUnits).pallets.length;
    remaining.set(blockId, (remaining.get(blockId) ?? 0) - cells);
  };

  const ordered = rankCandidates(pool, criteria);

  const leftovers: PoolCandidate[] = [];
  for (const candidate of ordered) {
    const home =
      candidate.pinnedBlockId ??
      candidate.currentPlacements?.map((p) => rowOwner.get(p.row)).find(Boolean);

    if (home && assigned.has(home)) take(home, candidate);
    else leftovers.push(candidate);
  }

  // Then fill, always feeding the emptiest block so neither is left short.
  //
  // A candidate is taken whole or not at all. Handing a SKU fewer cells than
  // its pallets need strands the rest as "no space" — a Pull First row for
  // stock that never had anywhere to go, which is noise, not a trip. The
  // surplus is simply discarded, and a smaller candidate can still claim the
  // tail the big one could not use, so the block still ends up full.
  for (const candidate of leftovers) {
    const needed = splitIntoPallets(candidate.totalQty, minUnits).pallets.length;
    if (needed === 0) continue;

    const target = blocks
      .map((b) => b.id)
      .filter((id) => (remaining.get(id) ?? 0) >= needed)
      .sort((a, b) => (remaining.get(b) ?? 0) - (remaining.get(a) ?? 0) || a.localeCompare(b))[0];

    if (!target) continue;
    take(target, candidate);
  }

  return assigned;
}

/** Cells a block's assignment actually claims. */
function cellsUsed(assigned: NoMoverCandidate[], minUnits: number): number {
  return assigned.reduce(
    (sum, c) => sum + splitIntoPallets(c.totalQty, minUnits).pallets.length,
    0
  );
}

export interface FilledAssignment {
  byBlock: Map<string, NoMoverCandidate[]>;
  minUnits: number;
  /** False when no minimum down to 1 fills every block. */
  fills: boolean;
}

/**
 * Assigns at the highest minimum that actually fills the blocks.
 *
 * fitMinimum answers a weaker question: whether enough pallets *exist*. It
 * cannot see whether they pack. Since a candidate is taken whole or not at all,
 * a pool with 54 pallets can still leave cells standing — the tail needs three
 * cells and two are free. Ranking made that visible: with merit order the big
 * multi-pallet SKUs no longer happen to go first and tidy the packing up.
 *
 * So the fit is verified against the assignment itself, stepping the minimum
 * down only as far as it takes to leave nothing empty.
 */
export function assignToFill(
  pool: PoolCandidate[],
  blocks: BlockConfig[],
  preferredMin: number = DS_PALLET_MIN_DEFAULT,
  criteria: AptitudeCriteria = APTITUDE_DEFAULTS
): FilledAssignment {
  const full = (byBlock: Map<string, NoMoverCandidate[]>, minUnits: number) =>
    blocks.every((b) => cellsUsed(byBlock.get(b.id) ?? [], minUnits) >= blockCapacity(b).cells);

  for (let min = preferredMin; min >= 1; min--) {
    const byBlock = assignCandidates(pool, blocks, min, criteria);
    if (full(byBlock, min)) return { byBlock, minUnits: min, fills: true };
  }

  // Nothing fills: keep the preferred minimum so the shortfall stays visible
  // rather than being buried under one-unit pallets.
  return {
    byBlock: assignCandidates(pool, blocks, preferredMin, criteria),
    minUnits: preferredMin,
    fills: false,
  };
}

/** How many pallets a set of candidates yields at a given minimum. */
export function palletsAt(candidates: { totalQty: number }[], minUnits: number): number {
  return candidates.reduce(
    (sum, c) => sum + splitIntoPallets(c.totalQty, minUnits).pallets.length,
    0
  );
}

export interface MinimumFit {
  /** The minimum to plan with. */
  minUnits: number;
  /** Pallets it yields. Below `cells` when even a minimum of 1 cannot fill the block. */
  pallets: number;
  cells: number;
  /** False when the candidate list cannot fill the block at any minimum. */
  fills: boolean;
}

/**
 * The largest minimum that still fills every assignable cell.
 *
 * Lowering the minimum only ever adds pallets — it lets a remainder that would
 * have gone to Pull First claim a cell of its own — so the fullest possible
 * pallets come from the *highest* minimum that still reaches capacity, not the
 * lowest. Going lower than that trades units per pallet for nothing.
 *
 * When no minimum fills the block the preferred one is returned untouched:
 * a half-empty block is a signal to widen the list, and quietly planning
 * three-unit pallets would hide it.
 */
export function fitMinimum(
  candidates: { totalQty: number }[],
  blocks: BlockConfig | BlockConfig[],
  preferred: number = DS_PALLET_MIN_DEFAULT
): MinimumFit {
  // Fitting is global when both blocks are filled from one pool: lowering the
  // minimum for A while B stays short would leave the floor half empty and
  // call it a fit.
  const cells = (Array.isArray(blocks) ? blocks : [blocks]).reduce(
    (sum, b) => sum + blockCapacity(b).cells,
    0
  );

  const atPreferred = palletsAt(candidates, preferred);
  if (atPreferred >= cells) {
    return { minUnits: preferred, pallets: atPreferred, cells, fills: true };
  }

  for (let min = preferred - 1; min >= 1; min--) {
    const pallets = palletsAt(candidates, min);
    if (pallets >= cells) return { minUnits: min, pallets, cells, fills: true };
  }

  return { minUnits: preferred, pallets: atPreferred, cells, fills: false };
}
