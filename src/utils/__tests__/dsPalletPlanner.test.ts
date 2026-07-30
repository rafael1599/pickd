import { describe, it, expect } from 'vitest';
import {
  BLOCK_A,
  BLOCK_B,
  DS_PALLET_MAX,
  PLAN_VERSION,
  blockCapacity,
  buildBlockLayout,
  assignCandidates,
  fitMinimum,
  palletsAt,
  planBlock,
  positionLetters,
  splitIntoPallets,
  type BlockConfig,
  type NoMoverCandidate,
  type PalletSlot,
} from '../dsPalletPlanner';

/** Cells actually holding a pallet, for terser assertions. */
function pallets(slots: PalletSlot[]) {
  return slots
    .filter((s) => s.usage.kind === 'pallet')
    .map((s) => ({
      id: s.id,
      sku: s.usage.kind === 'pallet' ? s.usage.sku : '',
      units: s.usage.kind === 'pallet' ? s.usage.units : 0,
      anchored: s.usage.kind === 'pallet' ? s.usage.anchored : false,
    }));
}

function slotAt(slots: PalletSlot[], id: string): PalletSlot {
  const slot = slots.find((s) => s.id === id);
  if (!slot) throw new Error(`slot ${id} not found`);
  return slot;
}

describe('positionLetters', () => {
  it('generates A..J for 10 positions', () => {
    expect(positionLetters(10)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  });

  it('doubles cleanly to 12 positions when the floor is re-labelled', () => {
    expect(positionLetters(12)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'K',
      'L',
    ]);
  });

  it('rolls over past Z', () => {
    const letters = positionLetters(28);
    expect(letters[25]).toBe('Z');
    expect(letters[26]).toBe('AA');
    expect(letters[27]).toBe('AB');
  });
});

describe('splitIntoPallets', () => {
  it('splits 60 into two full pallets and sends the remainder to Pull First', () => {
    expect(splitIntoPallets(60)).toEqual({ pallets: [25, 25], leftover: 10 });
  });

  it('gives the remainder its own pallet when it reaches the minimum', () => {
    expect(splitIntoPallets(45)).toEqual({ pallets: [25, 20], leftover: 0 });
  });

  it('drops a remainder below the minimum', () => {
    expect(splitIntoPallets(38)).toEqual({ pallets: [25], leftover: 13 });
  });

  it('sends a whole sub-minimum quantity to Pull First', () => {
    expect(splitIntoPallets(18)).toEqual({ pallets: [], leftover: 18 });
  });

  it('leaves nothing over on exact multiples', () => {
    expect(splitIntoPallets(50)).toEqual({ pallets: [25, 25], leftover: 0 });
  });

  it('treats the minimum itself as a valid pallet', () => {
    expect(splitIntoPallets(20)).toEqual({ pallets: [20], leftover: 0 });
    expect(splitIntoPallets(19)).toEqual({ pallets: [], leftover: 19 });
  });

  it('honours a user-adjusted minimum', () => {
    expect(splitIntoPallets(38, 10)).toEqual({ pallets: [25, 13], leftover: 0 });
    expect(splitIntoPallets(19, 15)).toEqual({ pallets: [19], leftover: 0 });
  });

  it('ignores nonsense quantities', () => {
    expect(splitIntoPallets(0)).toEqual({ pallets: [], leftover: 0 });
    expect(splitIntoPallets(-5)).toEqual({ pallets: [], leftover: 0 });
    expect(splitIntoPallets(Number.NaN)).toEqual({ pallets: [], leftover: 0 });
  });
});

describe('buildBlockLayout', () => {
  it('reserves the last position of every row', () => {
    const slots = buildBlockLayout(BLOCK_A);
    for (const row of BLOCK_A.rows) {
      expect(slotAt(slots, `${row}-J`).usage).toEqual({ kind: 'reserved' });
    }
  });

  it('marks the middle row landlocked except at its two ends', () => {
    const slots = buildBlockLayout(BLOCK_A);
    expect(slotAt(slots, '32-A').accessibility).toBe('accessible');
    expect(slotAt(slots, '32-J').accessibility).toBe('accessible');
    expect(slotAt(slots, '32-E').accessibility).toBe('landlocked');
    expect(slotAt(slots, '31-E').accessibility).toBe('accessible');
    expect(slotAt(slots, '33-E').accessibility).toBe('accessible');
  });

  it('follows the configured position count instead of a constant', () => {
    const wide: BlockConfig = { ...BLOCK_A, positionsPerRow: 12 };
    const slots = buildBlockLayout(wide);
    expect(slots).toHaveLength(36);
    expect(slotAt(slots, '31-L').usage).toEqual({ kind: 'reserved' });
    expect(slotAt(slots, '31-J').usage).toEqual({ kind: 'empty' });
  });

  it('mirrors block B onto its own rows', () => {
    const slots = buildBlockLayout(BLOCK_B);
    expect(slots.map((s) => s.row)).toContain('28');
    expect(slotAt(slots, '29-E').accessibility).toBe('landlocked');
  });
});

describe('blockCapacity', () => {
  it('discounts the reserved position of each row', () => {
    expect(blockCapacity(BLOCK_A)).toEqual({ cells: 27, units: 27 * DS_PALLET_MAX });
  });

  it('scales with the configured position count', () => {
    expect(blockCapacity({ ...BLOCK_A, positionsPerRow: 12 })).toEqual({
      cells: 33,
      units: 33 * DS_PALLET_MAX,
    });
  });
});

describe('planBlock — acceptance criteria', () => {
  it('places a 60-unit newcomer in two pallets and sends 10 units to Pull First', () => {
    const candidates: NoMoverCandidate[] = [{ sku: '03-4065BL', totalQty: 60, blockId: 'A' }];
    const plan = planBlock(BLOCK_A, candidates);

    const placed = pallets(plan.slots);
    expect(placed).toHaveLength(2);
    expect(placed.every((p) => p.sku === '03-4065BL' && p.units === 25)).toBe(true);
    expect(plan.pullFirst).toEqual([
      { sku: '03-4065BL', units: 10, total: 60, from: undefined, reason: 'partition-remainder' },
    ]);
  });

  it('keeps an anchored SKU in its exact cell', () => {
    const candidates: NoMoverCandidate[] = [
      {
        sku: '06-4638BK',
        totalQty: 30,
        blockId: 'A',
        currentPlacements: [{ row: '32', letter: 'C', units: 30 }],
      },
    ];
    const plan = planBlock(BLOCK_A, candidates);

    expect(slotAt(plan.slots, '32-C').usage).toEqual({
      kind: 'pallet',
      sku: '06-4638BK',
      units: 25,
      anchored: true,
    });
    expect(plan.pullFirst).toEqual([
      { sku: '06-4638BK', units: 5, total: 30, from: 'ROW 32 · C', reason: 'partition-remainder' },
    ]);
  });

  it('frees the cell of an anchored SKU that falls below the minimum', () => {
    const candidates: NoMoverCandidate[] = [
      {
        sku: '03-4266BK',
        totalQty: 12,
        blockId: 'A',
        currentPlacements: [{ row: '33', letter: 'B', units: 12 }],
      },
    ];
    const plan = planBlock(BLOCK_A, candidates);

    expect(slotAt(plan.slots, '33-B').usage).toEqual({ kind: 'empty' });
    expect(plan.pullFirst).toEqual([
      { sku: '03-4266BK', units: 12, total: 12, from: 'ROW 33 · B', reason: 'below-min' },
    ]);
  });

  it('ignores SKUs assigned to the other block', () => {
    const candidates: NoMoverCandidate[] = [
      { sku: '03-4065BL', totalQty: 50, blockId: 'A' },
      { sku: '06-4588BL', totalQty: 45, blockId: 'B' },
    ];
    const planA = planBlock(BLOCK_A, candidates);
    const planB = planBlock(BLOCK_B, candidates);

    expect(pallets(planA.slots).every((p) => p.sku === '03-4065BL')).toBe(true);
    expect(pallets(planB.slots).every((p) => p.sku === '06-4588BL')).toBe(true);
    expect(planA.pullFirst).toEqual([]);
  });

  it('treats a cell held by a discarded mover as free', () => {
    // The mover simply isn't in the candidate list — the floor clears it (RF-014).
    const candidates: NoMoverCandidate[] = [{ sku: '03-4065BL', totalQty: 25, blockId: 'A' }];
    const plan = planBlock(BLOCK_A, candidates);

    expect(pallets(plan.slots)).toHaveLength(1);
    expect(plan.slots.filter((s) => s.usage.kind === 'empty')).toHaveLength(26);
  });

  it('stamps the plan version so stale saved plans get discarded', () => {
    expect(planBlock(BLOCK_A, []).planVersion).toBe(PLAN_VERSION);
  });
});

describe('planBlock — conflict rules', () => {
  it('gives a contested cell to the SKU with more units in it', () => {
    const candidates: NoMoverCandidate[] = [
      {
        sku: 'SMALL',
        totalQty: 25,
        blockId: 'A',
        currentPlacements: [{ row: '31', letter: 'B', units: 8 }],
      },
      {
        sku: 'BIG',
        totalQty: 25,
        blockId: 'A',
        currentPlacements: [{ row: '31', letter: 'B', units: 20 }],
      },
    ];
    const plan = planBlock(BLOCK_A, candidates);

    expect(slotAt(plan.slots, '31-B').usage).toMatchObject({ sku: 'BIG', anchored: true });

    // The loser keeps its pallet, just somewhere else.
    const small = pallets(plan.slots).find((p) => p.sku === 'SMALL');
    expect(small).toBeDefined();
    expect(small?.anchored).toBe(false);
    expect(small?.id).not.toBe('31-B');
  });

  it('sends units to Pull First when the block runs out of cells', () => {
    const tiny: BlockConfig = { ...BLOCK_A, positionsPerRow: 2 }; // 1 usable cell per row
    const candidates: NoMoverCandidate[] = Array.from({ length: 4 }, (_, i) => ({
      sku: `SKU-${i}`,
      totalQty: 25,
      blockId: 'A',
    }));
    const plan = planBlock(tiny, candidates);

    expect(pallets(plan.slots)).toHaveLength(3);
    expect(plan.pullFirst).toHaveLength(1);
    expect(plan.pullFirst[0]).toMatchObject({ units: 25, reason: 'no-space' });
  });

  it('only anchors a SKU to its fullest cell when it is spread across several', () => {
    const candidates: NoMoverCandidate[] = [
      {
        sku: 'SPREAD',
        totalQty: 50,
        blockId: 'A',
        currentPlacements: [
          { row: '31', letter: 'B', units: 10 },
          { row: '31', letter: 'D', units: 40 },
        ],
      },
    ];
    const plan = planBlock(BLOCK_A, candidates);

    expect(slotAt(plan.slots, '31-D').usage).toMatchObject({ sku: 'SPREAD', anchored: true });
    expect(slotAt(plan.slots, '31-B').usage).toEqual({ kind: 'empty' });
    expect(pallets(plan.slots)).toHaveLength(2);
  });

  it('ignores placements that sit outside the block', () => {
    const candidates: NoMoverCandidate[] = [
      {
        sku: '06-4516KW',
        totalQty: 32,
        blockId: 'A',
        currentPlacements: [{ row: '24', letter: 'B', units: 32 }],
      },
    ];
    const plan = planBlock(BLOCK_A, candidates);

    const placed = pallets(plan.slots);
    expect(placed).toHaveLength(1);
    expect(placed[0].anchored).toBe(false);
    expect(plan.pullFirst).toEqual([
      { sku: '06-4516KW', units: 7, total: 32, from: 'ROW 24 · B', reason: 'partition-remainder' },
    ]);
  });

  it('never assigns a reserved cell', () => {
    const candidates: NoMoverCandidate[] = Array.from({ length: 30 }, (_, i) => ({
      sku: `SKU-${i}`,
      totalQty: 25,
      blockId: 'A',
    }));
    const plan = planBlock(BLOCK_A, candidates);

    for (const row of BLOCK_A.rows) {
      expect(slotAt(plan.slots, `${row}-J`).usage).toEqual({ kind: 'reserved' });
    }
    expect(pallets(plan.slots)).toHaveLength(27);
  });

  it('respects a user-lowered minimum', () => {
    const candidates: NoMoverCandidate[] = [{ sku: 'SHORT', totalQty: 12, blockId: 'A' }];

    expect(planBlock(BLOCK_A, candidates).pullFirst[0].reason).toBe('below-min');

    const relaxed = planBlock(BLOCK_A, candidates, { minUnits: 10 });
    expect(pallets(relaxed.slots)).toEqual([
      { id: expect.any(String), sku: 'SHORT', units: 12, anchored: false },
    ]);
    expect(relaxed.pullFirst).toEqual([]);
  });
});

describe('planBlock — placement priority', () => {
  it('fills accessible cells before landlocked ones for a single-pallet SKU', () => {
    const plan = planBlock(BLOCK_A, [{ sku: 'ONE', totalQty: 25, blockId: 'A' }]);
    const [placed] = pallets(plan.slots);
    expect(slotAt(plan.slots, placed.id).accessibility).toBe('accessible');
  });

  it('lets a multi-pallet SKU absorb the landlocked reserve once it has an accessible cell', () => {
    const plan = planBlock(BLOCK_A, [{ sku: 'BULK', totalQty: 125, blockId: 'A' }]);
    const placed = pallets(plan.slots);
    expect(placed).toHaveLength(5);

    const accessibility = placed.map((p) => slotAt(plan.slots, p.id).accessibility);
    expect(accessibility).toContain('accessible');
    expect(accessibility).toContain('landlocked');
  });
});

describe('fitMinimum', () => {
  // BLOCK_A: 10 positions, last reserved → 9 × 3 = 27 assignable cells.
  const many = (count: number, qty: number): NoMoverCandidate[] =>
    Array.from({ length: count }, (_, i) => ({ sku: `S${i}`, totalQty: qty, blockId: 'A' }));

  it('keeps the preferred minimum when the list already fills the block', () => {
    const fit = fitMinimum(many(27, 25), BLOCK_A, 20);

    expect(fit).toEqual({ minUnits: 20, pallets: 27, cells: 27, fills: true });
  });

  it('takes the highest minimum that fills, not the lowest', () => {
    // 27 SKUs of 18u: nothing forms at 20 or 19, everything forms at 18. A
    // lower minimum would fill too, and waste units per pallet doing it.
    const fit = fitMinimum(many(27, 18), BLOCK_A, 20);

    expect(fit.minUnits).toBe(18);
    expect(fit.fills).toBe(true);
    expect(fit.pallets).toBe(27);
  });

  it('stops as soon as capacity is reached, ignoring the surplus below', () => {
    // 20 SKUs of 25u (20 pallets) plus 20 of 12u. The 12s only count from 12
    // down, and 20 + 20 = 40 clears the 27 cells.
    const fit = fitMinimum([...many(20, 25), ...many(20, 12)], BLOCK_A, 20);

    expect(fit.minUnits).toBe(12);
    expect(fit.pallets).toBe(40);
  });

  it('reports the shortfall rather than planning three-unit pallets', () => {
    // Five SKUs cannot fill 27 cells at any minimum, so the preferred one
    // stands and `fills` says the list is too short.
    const fit = fitMinimum(many(5, 4), BLOCK_A, 20);

    expect(fit).toEqual({ minUnits: 20, pallets: 0, cells: 27, fills: false });
  });

  it('counts full pallets that a lower minimum cannot change', () => {
    // 100u is four full pallets whatever the minimum; only the remainder moves.
    expect(palletsAt([{ totalQty: 100 }], 20)).toBe(4);
    expect(palletsAt([{ totalQty: 110 }], 20)).toBe(4);
    expect(palletsAt([{ totalQty: 110 }], 10)).toBe(5);
  });
});

describe('assignCandidates', () => {
  const pool = (count: number, qty: number, prefix = 'S') =>
    Array.from({ length: count }, (_, i) => ({ sku: `${prefix}${i}`, totalQty: qty }));

  const counts = (m: Map<string, { sku: string }[]>) => ({
    A: m.get('A')?.length ?? 0,
    B: m.get('B')?.length ?? 0,
  });

  it('fills both blocks instead of loading up the first', () => {
    const assigned = assignCandidates(pool(54, 25), [BLOCK_A, BLOCK_B], 20);

    expect(counts(assigned)).toEqual({ A: 27, B: 27 });
  });

  it('sends a SKU to the block it already stands in', () => {
    const assigned = assignCandidates(
      [{ sku: 'HOME', totalQty: 25, currentPlacements: [{ row: '29', letter: 'C', units: 25 }] }],
      [BLOCK_A, BLOCK_B],
      20
    );

    expect(counts(assigned)).toEqual({ A: 0, B: 1 });
    expect(assigned.get('B')?.[0].currentPlacements).toEqual([
      { row: '29', letter: 'C', units: 25 },
    ]);
  });

  it('lets a hand-pinned block beat where the stock happens to sit', () => {
    const assigned = assignCandidates(
      [
        {
          sku: 'PINNED',
          totalQty: 25,
          pinnedBlockId: 'A',
          currentPlacements: [{ row: '29', letter: 'C', units: 25 }],
        },
      ],
      [BLOCK_A, BLOCK_B],
      20
    );

    expect(counts(assigned)).toEqual({ A: 1, B: 0 });
  });

  it('charges a multi-pallet SKU every cell it will occupy', () => {
    // 100u = 4 pallets. Seven of them exactly fill the 27 cells of one block,
    // so the eighth has to open the other.
    const assigned = assignCandidates(pool(8, 100), [BLOCK_A, BLOCK_B], 20);

    expect(counts(assigned).A + counts(assigned).B).toBe(8);
    expect(counts(assigned).A).toBeLessThanOrEqual(7);
    expect(counts(assigned).B).toBeLessThanOrEqual(7);
  });

  it('stops once both blocks are full rather than assigning the whole warehouse', () => {
    const assigned = assignCandidates(pool(200, 25), [BLOCK_A, BLOCK_B], 20);

    expect(counts(assigned).A + counts(assigned).B).toBe(54);
  });

  it('discards a SKU that cannot fit whole rather than stranding its tail', () => {
    // 100u is four cells, so six fill a block and leave three standing. The
    // seventh has nowhere to go whole in either block and is dropped, instead
    // of taking three cells and reporting its fourth pallet as "no space".
    const assigned = assignCandidates(pool(20, 100), [BLOCK_A, BLOCK_B], 20);
    const all = [...(assigned.get('A') ?? []), ...(assigned.get('B') ?? [])];

    expect(all).toHaveLength(12);
    expect(assigned.get('A')).toHaveLength(6);
    expect(assigned.get('B')).toHaveLength(6);
  });

  it('lets smaller candidates claim the tail the big ones could not use', () => {
    // Six 100u SKUs per block leave three cells each. Singles must still find
    // them, or discarding the surplus would cost the block its last cells.
    const assigned = assignCandidates(
      [...pool(20, 100, 'BIG'), ...pool(10, 25, 'SMALL')],
      [BLOCK_A, BLOCK_B],
      20
    );
    const all = [...(assigned.get('A') ?? []), ...(assigned.get('B') ?? [])];

    expect(all.filter((c) => c.sku.startsWith('SMALL'))).toHaveLength(6);
  });

  it('never assigns a block more pallets than it has cells', () => {
    const assigned = assignCandidates(pool(200, 100), [BLOCK_A, BLOCK_B], 20);

    for (const block of [BLOCK_A, BLOCK_B]) {
      const cells = (assigned.get(block.id) ?? []).reduce(
        (sum, c) => sum + splitIntoPallets(c.totalQty, 20).pallets.length,
        0
      );
      expect(cells).toBeLessThanOrEqual(blockCapacity(block).cells);
    }
  });

  it('does not depend on which block was recalculated', () => {
    const first = assignCandidates(pool(40, 25), [BLOCK_A, BLOCK_B], 20);
    const second = assignCandidates(pool(40, 25), [BLOCK_B, BLOCK_A], 20);

    expect(
      first
        .get('A')
        ?.map((c) => c.sku)
        .sort()
    ).toEqual(
      second
        .get('A')
        ?.map((c) => c.sku)
        .sort()
    );
  });
});
