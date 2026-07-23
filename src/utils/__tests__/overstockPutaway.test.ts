import { describe, expect, it } from 'vitest';
import {
  buildBlockLayout,
  planOverstockPutaway,
  splitQty,
  orderForPlacement,
  computeOverstockPlan,
  rankByWeightedScore,
  MAX_LINES_PER_SUBLOCATION,
  FORCED_TOWER_SLOT_IDS,
} from '../overstockPutaway';

describe('buildBlockLayout', () => {
  it('has 30 sublocations, only row 32 B-H landlocked', () => {
    const slots = buildBlockLayout();
    expect(slots).toHaveLength(30);

    const landlocked = slots.filter((s) => s.accessibility === 'landlocked');
    expect(landlocked.map((s) => s.id).sort()).toEqual(
      ['32-B', '32-C', '32-D', '32-E', '32-F', '32-G', '32-H', '32-I'].sort()
    );
  });

  it('reserves J in all three rows', () => {
    const slots = buildBlockLayout();
    const jSlots = slots.filter((s) => s.letter === 'J');
    expect(jSlots).toHaveLength(3);
    expect(jSlots.every((s) => s.usage.kind === 'reserved')).toBe(true);
  });
});

describe('splitQty', () => {
  it.each([
    [0, { fullTowers: 0, extraTowerUnits: 0, lineUnits: [] }],
    [8, { fullTowers: 0, extraTowerUnits: 0, lineUnits: [5, 3] }],
    [17, { fullTowers: 0, extraTowerUnits: 0, lineUnits: [5, 5, 5, 2] }],
    [18, { fullTowers: 0, extraTowerUnits: 18, lineUnits: [] }], // boundary rounds up
    [30, { fullTowers: 1, extraTowerUnits: 0, lineUnits: [] }],
    [55, { fullTowers: 1, extraTowerUnits: 25, lineUnits: [] }],
    [90, { fullTowers: 3, extraTowerUnits: 0, lineUnits: [] }],
  ])('qty %i -> %o', (qty, expected) => {
    expect(splitQty(qty)).toEqual(expected);
  });
});

describe('planOverstockPutaway', () => {
  it("places a SKU's first unit only in an accessible sublocation", () => {
    const { slots, unplaced } = planOverstockPutaway([{ sku: 'A', totalQty: 30 }]);
    expect(unplaced).toHaveLength(0);
    const placed = slots.find((s) => s.usage.kind === 'tower' && s.usage.sku === 'A');
    expect(placed?.accessibility).toBe('accessible');
  });

  it('sends extra towers of an already-placed SKU into the landlocked zone first', () => {
    const { slots, unplaced } = planOverstockPutaway([{ sku: 'A', totalQty: 90 }]); // 3 towers
    expect(unplaced).toHaveLength(0);
    const towers = slots.filter((s) => s.usage.kind === 'tower' && s.usage.sku === 'A');
    expect(towers).toHaveLength(3);
    // At least one of the extra towers should land landlocked (only 1 accessible slot required).
    expect(towers.some((s) => s.accessibility === 'landlocked')).toBe(true);
    expect(towers.some((s) => s.accessibility === 'accessible')).toBe(true);
  });

  it('splits a small quantity into multiple lines within the same accessible sublocation', () => {
    const { slots, unplaced } = planOverstockPutaway([{ sku: 'B', totalQty: 8 }]);
    expect(unplaced).toHaveLength(0);
    const lineSlot = slots.find((s) => s.usage.kind === 'lines');
    expect(lineSlot?.accessibility).toBe('accessible');
    expect(lineSlot?.usage.kind).toBe('lines');
    if (lineSlot?.usage.kind === 'lines') {
      expect(lineSlot.usage.entries.map((e) => e.units)).toEqual([5, 3]);
      expect(lineSlot.usage.entries.every((e) => e.sku === 'B')).toBe(true);
    }
  });

  it('never places two line-sublocations next to each other in the same row', () => {
    // 7 different SKUs each needing exactly 1 line forces multiple line-sublocations to open.
    const candidates = Array.from({ length: 7 }, (_, i) => ({ sku: `S${i}`, totalQty: 3 }));
    const { slots, unplaced } = planOverstockPutaway(candidates);
    expect(unplaced).toHaveLength(0);

    for (const row of ['31', '32', '33'] as const) {
      const rowSlots = slots
        .filter((s) => s.row === row)
        .sort((a, b) => a.letter.localeCompare(b.letter));
      for (let i = 0; i < rowSlots.length - 1; i++) {
        const bothLines =
          rowSlots[i].usage.kind === 'lines' && rowSlots[i + 1].usage.kind === 'lines';
        expect(bothLines).toBe(false);
      }
    }
  });

  it('never exceeds max lines per sublocation', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({ sku: `S${i}`, totalQty: 2 }));
    const { slots } = planOverstockPutaway(candidates);
    for (const s of slots) {
      if (s.usage.kind === 'lines') {
        expect(s.usage.entries.length).toBeLessThanOrEqual(MAX_LINES_PER_SUBLOCATION);
      }
    }
  });

  it('never assigns anything to J, no matter how full the block gets', () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({ sku: `S${i}`, totalQty: 30 }));
    const { slots } = planOverstockPutaway(candidates);
    const jSlots = slots.filter((s) => s.letter === 'J');
    expect(jSlots.every((s) => s.usage.kind === 'reserved')).toBe(true);
  });

  it('never puts lines on the forced-tower slots (31-A, 33-A)', () => {
    // Many single-line SKUs to pressure-test every accessible slot getting used.
    const candidates = Array.from({ length: 15 }, (_, i) => ({ sku: `S${i}`, totalQty: 3 }));
    const { slots } = planOverstockPutaway(candidates);
    for (const id of FORCED_TOWER_SLOT_IDS) {
      const slot = slots.find((s) => s.id === id);
      expect(slot?.usage.kind).not.toBe('lines');
    }
  });

  it('places the first candidate (highest placement priority) closest to J', () => {
    // Caller is responsible for ordering; first item = highest priority (e.g. least-moved).
    const candidates = [
      { sku: 'least-moved', totalQty: 3 },
      { sku: 'second', totalQty: 3 },
    ];
    const { slots } = planOverstockPutaway(candidates);
    const firstSlot = slots.find(
      (s) => s.usage.kind === 'lines' && s.usage.entries.some((e) => e.sku === 'least-moved')
    );
    // Closest non-reserved letter to J is I.
    expect(firstSlot?.letter).toBe('I');
  });

  it('regression: many single-tower SKUs can exhaust every accessible anchor before a multi-tower SKU gets a turn', () => {
    // 19 accessible sublocations exist. 20 single-tower SKUs (qty=30, one
    // accessible anchor each) processed first — as a naive least-moved sort
    // could easily rank them, tied or ahead of a slow-moving big SKU — use up
    // every accessible anchor. The big SKU (needs 3 towers) then has none
    // left for its required first accessible placement, so it can't reach
    // the landlocked zone at all, even though that zone sits fully empty.
    const singleTower = Array.from({ length: 20 }, (_, i) => ({
      sku: `single-${i}`,
      totalQty: 30,
    }));
    const big = { sku: 'big', totalQty: 90 };
    const rawOrder = [...singleTower, big];

    const naive = planOverstockPutaway(rawOrder);
    const bigPlacedNaive = naive.slots.some(
      (s) => s.usage.kind === 'tower' && s.usage.sku === 'big'
    );
    expect(bigPlacedNaive).toBe(false); // demonstrates the starvation this test guards against
    const landlockedUsedNaive = naive.slots.some(
      (s) =>
        s.accessibility === 'landlocked' && s.usage.kind !== 'empty' && s.usage.kind !== 'reserved'
    );
    expect(landlockedUsedNaive).toBe(false); // the empty-center symptom

    const reordered = orderForPlacement(rawOrder);
    const fixed = planOverstockPutaway(reordered);
    const bigTowers = fixed.slots.filter((s) => s.usage.kind === 'tower' && s.usage.sku === 'big');
    expect(bigTowers).toHaveLength(3);
    expect(bigTowers.some((s) => s.accessibility === 'landlocked')).toBe(true);
  });
});

describe('rankByWeightedScore', () => {
  const pool = [
    { sku: 'high-qty-some-orders', totalQty: 100, ordersCompleted: 6 },
    { sku: 'low-qty-never-moved', totalQty: 5, ordersCompleted: 0 },
  ];

  it('qty-only weighting ranks the biggest SKU first', () => {
    const ranked = rankByWeightedScore(pool, { qty: 1, moved: 0 });
    expect(ranked[0].sku).toBe('high-qty-some-orders');
  });

  it('movement-only weighting ranks the never-moved SKU first', () => {
    const ranked = rankByWeightedScore(pool, { qty: 0, moved: 1 });
    expect(ranked[0].sku).toBe('low-qty-never-moved');
  });
});

describe('computeOverstockPlan', () => {
  it('ranking weights change which SKU wins the accessible anchor when space is scarce', () => {
    // Both need exactly 1 tower — only one can land on an accessible slot's
    // sibling contest here since we only check who's placed first via order.
    const pool = [
      { sku: 'big-mover', totalQty: 90, ordersCompleted: 6 },
      { sku: 'tiny-never-moved', totalQty: 3, ordersCompleted: 0 },
    ];

    const qtyFirst = computeOverstockPlan(
      pool,
      new Set(),
      { maxOrders: 12, minQty: 3 },
      { qty: 3, moved: 0 }
    );
    const bigTowersQtyFirst = qtyFirst.plan.slots.filter(
      (s) => s.usage.kind === 'tower' && s.usage.sku === 'big-mover'
    );
    expect(bigTowersQtyFirst.length).toBeGreaterThan(0);

    const movedFirst = computeOverstockPlan(
      pool,
      new Set(),
      { maxOrders: 12, minQty: 3 },
      { qty: 0, moved: 3 }
    );
    // With movement weighted and qty ignored, the never-moved tiny SKU should
    // still land closest to J even though it's not the one needing towers.
    const tinySlot = movedFirst.plan.slots.find(
      (s) => s.usage.kind === 'lines' && s.usage.entries.some((e) => e.sku === 'tiny-never-moved')
    );
    expect(tinySlot?.letter).toBe('I');
  });

  it('filters out excluded SKUs before placing', () => {
    const pool = [
      { sku: 'keep', totalQty: 10, ordersCompleted: 0 },
      { sku: 'excluded', totalQty: 10, ordersCompleted: 0 },
    ];
    const { plan, candidates } = computeOverstockPlan(pool, new Set(['excluded']), {
      maxOrders: 12,
      minQty: 3,
    });
    expect(candidates.map((c) => c.sku)).toEqual(['keep']);
    const skusInPlan = new Set(
      plan.slots.flatMap((s) =>
        s.usage.kind === 'tower'
          ? [s.usage.sku]
          : s.usage.kind === 'lines'
            ? s.usage.entries.map((e) => e.sku)
            : []
      )
    );
    expect(skusInPlan.has('excluded')).toBe(false);
  });

  it('pinned SKUs get placed before everything else, regardless of weights', () => {
    // 20 SKUs that would otherwise dominate the ranking under qty-weighting.
    const crowd = Array.from({ length: 20 }, (_, i) => ({
      sku: `big-${i}`,
      totalQty: 90,
      ordersCompleted: 0,
    }));
    const pinned = { sku: 'must-place-this', totalQty: 3, ordersCompleted: 12 };
    const pool = [...crowd, pinned];

    const { plan } = computeOverstockPlan(
      pool,
      new Set(),
      { maxOrders: 12, minQty: 3 },
      { qty: 3, moved: 0 }, // qty-only weighting would normally bury the pinned SKU
      new Set(['must-place-this'])
    );
    const pinnedSlot = plan.slots.find(
      (s) => s.usage.kind === 'lines' && s.usage.entries.some((e) => e.sku === 'must-place-this')
    );
    expect(pinnedSlot).toBeDefined();
    // Pinned goes first, so it wins the slot closest to J.
    expect(pinnedSlot?.letter).toBe('I');
  });

  it('pinned SKUs are still capped by real capacity — reported unplaced if the block is genuinely full', () => {
    const hugePinnedList = Array.from({ length: 40 }, (_, i) => ({
      sku: `pin-${i}`,
      totalQty: 30,
      ordersCompleted: 0,
    }));
    const pinnedSkus = new Set(hugePinnedList.map((c) => c.sku));
    const { plan } = computeOverstockPlan(
      hugePinnedList,
      new Set(),
      { maxOrders: 12, minQty: 3 },
      undefined,
      pinnedSkus
    );
    expect(plan.unplaced.length).toBeGreaterThan(0);
  });

  it('reports effective thresholds only as far as it had to reach', () => {
    const pool = [{ sku: 'exact-baseline', totalQty: 10, ordersCompleted: 5 }];
    const { effectiveMaxOrders, effectiveMinQty } = computeOverstockPlan(pool, new Set(), {
      maxOrders: 12,
      minQty: 3,
    });
    expect(effectiveMaxOrders).toBe(12); // never had to loosen past the baseline
    expect(effectiveMinQty).toBe(3);
  });
});
