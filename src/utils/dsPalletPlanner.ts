// DS-Pallet put-away planner with Unified 4-Row Support, Dynamic Per-SKU Capacity & Accessibility.
//
// Rules are documented in docs/prds/warehouse-ds-pallet-blocks.md and unified 4-row layout.
// Pure calculation — never writes directly to `inventory`.

export const DS_PALLET_MAX = 30;
export const DS_PALLET_MIN_DEFAULT = 20;

/** Bumped whenever the persisted plan shape changes; older plans are discarded, not migrated (RNF-004). */
export const PLAN_VERSION = 6;

export type Accessibility = 'accessible' | 'landlocked';

export interface BlockConfig {
  id: string;
  label: string;
  /** Left-to-right, as they sit on the floor. The middle ones may be landlocked. */
  rows: string[];
  positionsPerRow: number;
  reserveLastPosition: boolean;
  sobranteLetter?: string; // e.g. 'A'
  startLetter?: string; // e.g. 'B'
}

export const UNIFIED_FOUR_ROW_BLOCK: BlockConfig = {
  id: 'MAIN_4ROW',
  label: 'ROW 33/32/31/30',
  rows: ['33', '32', '31', '30'],
  positionsPerRow: 9,
  reserveLastPosition: false,
  startLetter: 'B',
};

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

export const BLOCKS: BlockConfig[] = [UNIFIED_FOUR_ROW_BLOCK];

export type SlotUsage =
  | { kind: 'empty' }
  | { kind: 'reserved' }
  | { kind: 'sobrante'; sku: string; units: number }
  | {
      kind: 'pallet';
      sku: string;
      units: number;
      capacity?: number;
      anchored: boolean;
      pinned?: boolean;
    };

export interface PalletSlot {
  id: string;
  row: string;
  letter: string;
  accessibility: Accessibility;
  usage: SlotUsage;
}

export interface CurrentPlacement {
  row: string;
  letter: string;
  units: number;
}

export interface NoMoverCandidate {
  sku: string;
  totalQty: number;
  blockId: string;
  currentPlacements?: CurrentPlacement[];
  daysInactive?: number;
  ordersCompleted12m?: number;
}

export type PullFirstReason = 'below-min' | 'partition-remainder' | 'no-space';

export interface PullFirstEntry {
  sku: string;
  units: number;
  total?: number;
  from?: string;
  reason: PullFirstReason;
}

export interface BlockPlan {
  planVersion: number;
  blockId: string;
  slots: PalletSlot[];
  pullFirst: PullFirstEntry[];
}

export interface ManualPin {
  sku: string;
  row: string;
  letter: string;
}

export interface PlannerOptions {
  minUnits?: number;
  skuCapacityOverrides?: Record<string, number>;
  manualPins?: ManualPin[];
}

export function positionLetters(count: number, startLetter = 'A'): string[] {
  const startIndex = startLetter.charCodeAt(0) - 65;
  const letters: string[] = [];
  for (let i = 0; i < count; i++) {
    let n = startIndex + i;
    let label = '';
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    letters.push(label);
  }
  return letters;
}

export function accessibilityFor(
  block: BlockConfig,
  rowIndex: number,
  letterIndex: number
): Accessibility {
  if (block.id === 'MAIN_4ROW' || block.rows.length === 4) {
    const isMiddleRow = rowIndex === 1 || rowIndex === 2;
    if (!isMiddleRow) return 'accessible';
    const isEnd = letterIndex === 0 || letterIndex === block.positionsPerRow - 1;
    return isEnd ? 'accessible' : 'landlocked';
  }

  const isMiddleRow = rowIndex === Math.floor(block.rows.length / 2) && block.rows.length === 3;
  if (!isMiddleRow) return 'accessible';
  const isEnd = letterIndex === 0 || letterIndex === block.positionsPerRow - 1;
  return isEnd ? 'accessible' : 'landlocked';
}

export function buildBlockLayout(block: BlockConfig): PalletSlot[] {
  const letters = positionLetters(block.positionsPerRow, block.startLetter ?? 'A');
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

export function splitIntoPallets(
  qty: number,
  minUnits: number = DS_PALLET_MIN_DEFAULT,
  maxUnits: number = DS_PALLET_MAX
): { pallets: number[]; leftover: number } {
  if (!Number.isFinite(qty) || qty <= 0) return { pallets: [], leftover: 0 };

  const fullPallets = Math.floor(qty / maxUnits);
  const remainder = qty % maxUnits;
  const pallets = Array(fullPallets).fill(maxUnits) as number[];

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

function proximityRank(slot: PalletSlot, letters: string[]): number {
  return letters.length - 1 - letters.indexOf(slot.letter);
}

function placePallet(
  slots: PalletSlot[],
  letters: string[],
  sku: string,
  units: number,
  preferLandlocked: boolean,
  capacity: number = DS_PALLET_MAX
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

  const usage: Extract<PalletSlot['usage'], { kind: 'pallet' }> = {
    kind: 'pallet',
    sku,
    units,
    anchored: false,
  };
  if (capacity !== DS_PALLET_MAX) usage.capacity = capacity;
  target.usage = usage;
  return target;
}

export function orderForPlacement<T extends NoMoverCandidate>(
  candidates: T[],
  minUnits: number = DS_PALLET_MIN_DEFAULT,
  overrides: Record<string, number> = {}
): T[] {
  const multi: T[] = [];
  const rest: T[] = [];
  for (const c of candidates) {
    const cap = overrides[c.sku] ?? DS_PALLET_MAX;
    const { pallets } = splitIntoPallets(c.totalQty, minUnits, cap);
    (pallets.length >= 2 ? multi : rest).push(c);
  }
  return [...multi, ...rest];
}

interface ResolvedAnchor {
  candidate: NoMoverCandidate;
  slot: PalletSlot;
  placement: CurrentPlacement;
}

function resolveAnchors(
  candidates: NoMoverCandidate[],
  block: BlockConfig,
  slots: PalletSlot[]
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
    const [winner] = sorted;

    const existing = winners.get(winner.candidate.sku);
    if (existing && existing.placement.units >= winner.placement.units) continue;
    if (existing) winners.delete(existing.slot.id);

    winners.set(winner.candidate.sku, winner);
  }

  return winners;
}

export function planBlock(
  block: BlockConfig,
  candidates: NoMoverCandidate[],
  options: PlannerOptions = {}
): BlockPlan {
  const minUnits = options.minUnits ?? DS_PALLET_MIN_DEFAULT;
  const overrides = options.skuCapacityOverrides ?? {};
  const pins = options.manualPins ?? [];
  const letters = positionLetters(block.positionsPerRow, block.startLetter ?? 'A');
  const slots = buildBlockLayout(block);
  const pullFirst: PullFirstEntry[] = [];

  const mine = candidates.filter((c) => c.blockId === block.id);
  const extraPool = candidates.filter((c) => c.blockId !== block.id);
  const orderedCandidates = [...mine, ...extraPool];

  // If block uses designated sobranteLetter (e.g. 'A' in UNIFIED_FOUR_ROW_BLOCK)
  const sobranteLetter = block.sobranteLetter;

  if (sobranteLetter) {
    for (const candidate of orderedCandidates) {
      const capacity = overrides[candidate.sku] ?? DS_PALLET_MAX;
      const fullPalletsCount = Math.floor(candidate.totalQty / capacity);
      const sobranteUnits = candidate.totalQty % capacity;

      const freePalletSlots = slots.filter(
        (s) => s.letter !== sobranteLetter && s.usage.kind === 'empty'
      );

      if (fullPalletsCount === 0 && freePalletSlots.length === 0 && sobranteUnits === 0) {
        pullFirst.push({
          sku: candidate.sku,
          units: candidate.totalQty,
          total: candidate.totalQty,
          reason: 'no-space',
        });
        continue;
      }

      const palletsToPlace = Math.min(fullPalletsCount, freePalletSlots.length);
      const unplacedPallets = fullPalletsCount - palletsToPlace;

      const assignedPallets: PalletSlot[] = [];
      const isMulti = fullPalletsCount >= 2;

      for (let p = 0; p < palletsToPlace; p++) {
        const currentFree = slots.filter(
          (s) => s.letter !== sobranteLetter && s.usage.kind === 'empty'
        );
        if (currentFree.length === 0) break;

        const preferLandlocked = isMulti && assignedPallets.length > 0;

        const pool = (acc: Accessibility) =>
          currentFree
            .filter((s) => s.accessibility === acc)
            .sort((a, b) => proximityRank(a, letters) - proximityRank(b, letters));

        const primary = pool(preferLandlocked ? 'landlocked' : 'accessible');
        const fallback = pool(preferLandlocked ? 'accessible' : 'landlocked');

        const target = primary[0] ?? fallback[0];
        if (!target) break;

        target.usage = {
          kind: 'pallet',
          sku: candidate.sku,
          units: capacity,
          capacity,
          anchored: false,
        };
        assignedPallets.push(target);
      }

      if (unplacedPallets > 0) {
        pullFirst.push({
          sku: candidate.sku,
          units: unplacedPallets * capacity,
          total: candidate.totalQty,
          reason: 'no-space',
        });
      }

      if (sobranteUnits > 0) {
        const preferredRow = assignedPallets[0]?.row;
        const freeSobranteSlots = slots.filter(
          (s) => s.letter === sobranteLetter && s.usage.kind === 'empty'
        );

        const targetSobrante =
          freeSobranteSlots.find((s) => s.row === preferredRow) ?? freeSobranteSlots[0];
        if (targetSobrante) {
          targetSobrante.usage = {
            kind: 'sobrante',
            sku: candidate.sku,
            units: sobranteUnits,
          };
        } else {
          pullFirst.push({
            sku: candidate.sku,
            units: sobranteUnits,
            total: candidate.totalQty,
            reason: 'partition-remainder',
          });
        }
      }
    }
    return { planVersion: PLAN_VERSION, blockId: block.id, slots, pullFirst };
  }

  // Classic Block Placement for BLOCK_A / BLOCK_B
  const poolToUse = block.id === 'MAIN_4ROW' ? [...mine, ...extraPool] : mine;
  const eligible: NoMoverCandidate[] = [];
  for (const candidate of poolToUse) {
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

  // ── Phase 0: Manual Pins ──────────────────────────────────────────────
  // Pins are placed first and marked as pinned so the normal placement
  // phases (anchors → orderForPlacement) skip them.  Only one pallet of a
  // SKU is pinned; the rest of the SKU's pallets are placed normally.
  const pinnedSkuUnits = new Map<string, number>();
  for (const pin of pins) {
    const slot = slots.find((s) => s.row === pin.row && s.letter === pin.letter);
    if (!slot || slot.usage.kind === 'reserved') continue;

    const candidate = eligible.find((c) => c.sku === pin.sku);
    if (!candidate) continue; // stale pin — SKU no longer in pool

    const cap = overrides[pin.sku] ?? DS_PALLET_MAX;
    const units = Math.min(candidate.totalQty - (pinnedSkuUnits.get(pin.sku) ?? 0), cap);
    if (units <= 0) continue;

    const usage: Extract<PalletSlot['usage'], { kind: 'pallet' }> = {
      kind: 'pallet',
      sku: pin.sku,
      units,
      anchored: false,
      pinned: true,
    };
    if (cap !== DS_PALLET_MAX) usage.capacity = cap;
    slot.usage = usage;
    pinnedSkuUnits.set(pin.sku, (pinnedSkuUnits.get(pin.sku) ?? 0) + units);
  }

  const anchors =
    block.id === 'MAIN_4ROW'
      ? new Map<string, ResolvedAnchor>()
      : resolveAnchors(eligible, block, slots);

  const remainingUnits = new Map<string, number>();
  for (const candidate of eligible) {
    const cap = overrides[candidate.sku] ?? DS_PALLET_MAX;
    // Subtract units already consumed by manual pins.
    const startQty = candidate.totalQty - (pinnedSkuUnits.get(candidate.sku) ?? 0);
    const anchor = anchors.get(candidate.sku);
    if (!anchor) {
      remainingUnits.set(candidate.sku, startQty);
      continue;
    }
    const units = Math.min(startQty, cap);
    if (units <= 0) {
      remainingUnits.set(candidate.sku, 0);
      continue;
    }
    const usage: Extract<PalletSlot['usage'], { kind: 'pallet' }> = {
      kind: 'pallet',
      sku: candidate.sku,
      units,
      anchored: true,
    };
    if (cap !== DS_PALLET_MAX) usage.capacity = cap;
    anchor.slot.usage = usage;
    remainingUnits.set(candidate.sku, startQty - units);
  }

  for (const candidate of orderForPlacement(eligible, minUnits, overrides)) {
    const cap = overrides[candidate.sku] ?? DS_PALLET_MAX;
    const left = remainingUnits.get(candidate.sku) ?? 0;
    if (left <= 0) continue;

    const { pallets, leftover } = splitIntoPallets(left, minUnits, cap);
    const origin = (candidate.currentPlacements ?? [])[0];
    const from = origin ? formatOrigin(origin.row, origin.letter) : undefined;

    let hasAccessible = anchors.has(candidate.sku);
    for (const units of pallets) {
      const placed = placePallet(slots, letters, candidate.sku, units, hasAccessible, cap);
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

export function blockCapacity(block: BlockConfig): { cells: number; units: number } {
  const reserved = block.reserveLastPosition ? 1 : 0;
  const sobrante = block.sobranteLetter ? 1 : 0;
  const perRow = block.positionsPerRow - reserved - sobrante;
  const cells = perRow * block.rows.length;
  return { cells, units: cells * DS_PALLET_MAX };
}

export interface PoolCandidate {
  sku: string;
  totalQty: number;
  ordersCompleted?: number;
  currentPlacements?: CurrentPlacement[];
  pinnedBlockId?: string;
  daysInactive?: number;
}

export interface AptitudeCriteria {
  maxOrders: number;
  minStock: number;
}

export const APTITUDE_DEFAULTS: AptitudeCriteria = { maxOrders: 50, minStock: 21 };

function isPreferred(c: PoolCandidate, criteria: AptitudeCriteria): boolean {
  return (
    (c.ordersCompleted ?? Number.POSITIVE_INFINITY) <= criteria.maxOrders &&
    c.totalQty >= criteria.minStock
  );
}

export function rankCandidates<T extends PoolCandidate>(
  pool: T[],
  criteria: AptitudeCriteria = APTITUDE_DEFAULTS
): T[] {
  return [...pool].sort((a, b) => {
    // Primary: total inventory descending — biggest stock piles fill the block
    // first.  The overstock block exists to organise the largest warehouse
    // piles into pallets; a SKU with 272 units is a higher palletisation
    // priority than one with 25 units, regardless of how many orders it has.
    if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;

    // Secondary: preferred band wins ties among equal quantities.
    const band = Number(isPreferred(b, criteria)) - Number(isPreferred(a, criteria));
    if (band !== 0) return band;

    // Tertiary: most inactive first.
    const daysA = a.daysInactive ?? 9999;
    const daysB = b.daysInactive ?? 9999;
    if (daysB !== daysA) return daysB - daysA;

    // Quaternary: fewest orders first.
    const orders =
      (a.ordersCompleted ?? Number.POSITIVE_INFINITY) -
      (b.ordersCompleted ?? Number.POSITIVE_INFINITY);
    if (orders !== 0) return orders;

    return a.sku.localeCompare(b.sku);
  });
}

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
      daysInactive: candidate.daysInactive,
      ordersCompleted12m: candidate.ordersCompleted,
    });
    const cells = splitIntoPallets(candidate.totalQty, minUnits).pallets.length;
    remaining.set(blockId, (remaining.get(blockId) ?? 0) - cells);
  };

  const ordered = rankCandidates(pool, criteria);

  const leftovers: PoolCandidate[] = [];
  for (const candidate of ordered) {
    const home =
      candidate.pinnedBlockId ??
      (blocks.length > 1
        ? candidate.currentPlacements?.map((p) => rowOwner.get(p.row)).find(Boolean)
        : undefined);

    if (home && assigned.has(home)) take(home, candidate);
    else leftovers.push(candidate);
  }

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

  // Pass 2: For single-block layouts, fill any remaining empty slots with the next candidates
  if (blocks.length === 1) {
    for (const candidate of leftovers) {
      const assignedSkus = new Set(
        [...assigned.values()].flatMap((list) => list.map((c) => c.sku))
      );
      if (assignedSkus.has(candidate.sku)) continue;

      const needed = splitIntoPallets(candidate.totalQty, minUnits).pallets.length;
      if (needed === 0) continue;

      const target = blocks
        .map((b) => b)
        .filter((b) => {
          const fullPalletsPlaced = (assigned.get(b.id) ?? []).reduce(
            (sum, c) => sum + Math.floor(c.totalQty / DS_PALLET_MAX),
            0
          );
          return fullPalletsPlaced < blockCapacity(b).cells;
        })[0]?.id;

      if (!target) continue;
      assigned.get(target)?.push({
        sku: candidate.sku,
        totalQty: candidate.totalQty,
        blockId: target,
        currentPlacements: candidate.currentPlacements,
        daysInactive: candidate.daysInactive,
        ordersCompleted12m: candidate.ordersCompleted,
      });
    }
  }

  return assigned;
}

function cellsUsed(assigned: NoMoverCandidate[], minUnits: number): number {
  return assigned.reduce(
    (sum, c) => sum + splitIntoPallets(c.totalQty, minUnits).pallets.length,
    0
  );
}

export interface FilledAssignment {
  byBlock: Map<string, NoMoverCandidate[]>;
  minUnits: number;
  fills: boolean;
}

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

  return {
    byBlock: assignCandidates(pool, blocks, preferredMin, criteria),
    minUnits: preferredMin,
    fills: false,
  };
}

export function palletsAt(candidates: { totalQty: number }[], minUnits: number): number {
  return candidates.reduce(
    (sum, c) => sum + splitIntoPallets(c.totalQty, minUnits).pallets.length,
    0
  );
}

export interface MinimumFit {
  minUnits: number;
  pallets: number;
  cells: number;
  fills: boolean;
}

export function fitMinimum(
  candidates: { totalQty: number }[],
  blocks: BlockConfig | BlockConfig[],
  preferred: number = DS_PALLET_MIN_DEFAULT
): MinimumFit {
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
