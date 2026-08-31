// The numbers each zone printed on 28 Aug 2026 — the ones on the floor plans'
// index page and in the Bay 3 proposal — are the spec. If a change here moves
// them, it changes a count somebody has already been shown. One deliberate
// move since: 31 Aug 2026, every Bay 3 North row (18–33) gained the K square
// (`extraSlotRows` — born on 30–33, extended to 18 the same day), so every
// bay3_north count is one pallet per drawn row up from the printed plans.

import { describe, it, expect } from 'vitest';
import {
  calculateLayout,
  defaultEngineState,
  rowLabelSequence,
  slotKey,
  HALL_MIN,
  BIKES_PER_PALLET,
} from '../palletEngine';
import { ZONES, ZONE_IDS, isZoneId } from '../zones';
import type { EngineState, LayoutModel, ZoneId } from '../types';

function layout(id: ZoneId, overrides: Partial<EngineState> = {}): LayoutModel {
  const m = calculateLayout(ZONES[id], defaultEngineState(overrides));
  if (!m) throw new Error(`${id} produced no layout`);
  return m;
}

const rowsOf = (m: LayoutModel) =>
  m.strip.filter((s) => s.type === 'block').map((b) => b.rows.map((r) => r.num));

const hallsOf = (m: LayoutModel) =>
  m.strip.flatMap((s) => (s.type === 'hall' && !s.isExtraOnly ? [+s.w.toFixed(2)] : []));

describe('V1 — Bay 3 North, rows N–S, west hall kept, pallet 60 × 62', () => {
  const m = layout('bay3_north');

  it('152 pallets, 4,560 bikes, 98 fast, 2 posts in slots', () => {
    expect(m.pallets).toBe(152);
    expect(m.gross).toBe(154);
    expect(m.totalBikes).toBe(4560);
    expect(m.accessible).toBe(98);
    expect(m.hits).toHaveLength(2);
    expect(m.lost).toHaveLength(2);
  });

  it('every row holds a K past J, over the north strip; J behind it stops being fast', () => {
    const ks = m.validCells.filter((c) => c.letter === 'K');
    expect(ks).toHaveLength(14); // one per drawn row, 20–33
    const clearance = ZONES.bay3_north.obstacles!.find((o) => o.id === 'north_clearance')!;
    for (const k of ks) {
      expect(k.isFast).toBe(true);
      expect(k.cy).toBeLessThan(clearance.h); // it sticks into the strip
      expect(k.cy + k.ch).toBeCloseTo(clearance.h, 6); // and ends where J begins
    }
    // The far face of every row is K now: J is fast only on a block's edge rows.
    for (const j of m.validCells.filter((c) => c.letter === 'J')) {
      expect(j.isFast).toBe(j.row.idx === 0 || j.row.idx === j.row.of - 1);
    }
  });

  it('four blocks of 3 and 4, ten deep, halls of 78"', () => {
    expect(m.blocks).toEqual([3, 3, 4, 4]);
    expect(m.nRows).toBe(14);
    expect(m.deep).toBe(10);
    expect(m.hall).toBeCloseTo(78.33, 2);
    // Block 0 slides 6" east so its post lands in the hall; that hall gives the inches up.
    expect(hallsOf(m)).toEqual([72.33, 78.33, 78.33]);
    expect(m.lines).toBe(0);
  });

  it('rows 20 to 33, numbered from the east wall', () => {
    expect(rowsOf(m)).toEqual([
      ['20', '21', '22'],
      ['23', '24', '25'],
      ['26', '27', '28', '29'],
      ['30', '31', '32', '33'],
    ]);
  });

  it('slot A of every row sits on the main hall, to the south', () => {
    const mainHall = ZONES.bay3_north.obstacles!.find((o) => o.id === 'main_hall')!;
    for (const cell of m.validCells.filter((c) => c.letter === 'A')) {
      expect(cell.cy + cell.ch).toBeCloseTo(mainHall.y, 6);
      expect(cell.isFast).toBe(true);
    }
    expect(m.validCells.map((c) => c.letter).filter((l) => l === 'J')).toHaveLength(14);
  });

  it('the two hits are P2 and P1, one slot each', () => {
    expect(m.hits.map((h) => h.source.note).sort()).toEqual(['P1', 'P2']);
    for (const h of m.hits) expect(h.cells).toHaveLength(1);
  });
});

describe('V2 — Bay 3 North with the west strip reclaimed', () => {
  const m = layout('bay3_north', { toggles: { west: false } });

  it('173 pallets, 5,190 bikes, 119 fast, 3 hits; halls narrow to 67"', () => {
    expect(m.pallets).toBe(173);
    expect(m.gross).toBe(176);
    expect(m.totalBikes).toBe(5190);
    expect(m.accessible).toBe(119);
    expect(m.hits).toHaveLength(3);
    expect(m.hall).toBeCloseTo(66.75, 2);
    expect(hallsOf(m)).toEqual([66.75, 66.75, 66.75, 66.75]);
  });

  it('a fifth block of two rows appears at the west wall: rows 18 and 19', () => {
    expect(m.blocks).toEqual([2, 3, 3, 4, 4]);
    expect(m.nRows).toBe(16);
    expect(rowsOf(m)[0]).toEqual(['18', '19']);
    expect(m.margins.left).toBe(0);
    expect(m.obstacles.find((o) => o.id === 'west_hall')).toBeUndefined();
  });
});

describe('V3 — Bay 3 South/East', () => {
  const m = layout('bay3_se');

  it('29 pallets of 30, 870 bikes, one post in a slot', () => {
    expect(m.pallets).toBe(29);
    expect(m.gross).toBe(30);
    expect(m.totalBikes).toBe(870);
    expect(m.accessible).toBe(25);
    expect(m.hits).toHaveLength(1);
    expect(m.blocks).toEqual([3, 2]);
    expect(m.deep).toBe(6);
    expect(m.hall).toBe(87);
  });

  it('rows 34 to 38 from the east, and the south hall is 114"', () => {
    expect(rowsOf(m)).toEqual([
      ['38', '37', '36'],
      ['35', '34'],
    ]);
    const southHall = m.obstacles.find((o) => o.id === 'south_hall');
    expect(southHall?.h).toBe(114);
  });
});

describe('V4 — Bay 2 North', () => {
  const m = layout('bay2_north');

  it('94 of 96 pallets, 3,108 bikes, and every pallet is fast', () => {
    expect(m.pallets).toBe(94);
    expect(m.gross).toBe(96);
    expect(m.palletBikes).toBe(2820);
    expect(m.bikes).toBe(288);
    expect(m.totalBikes).toBe(3108);
    expect(m.accessible).toBe(94);
    expect(m.hits).toHaveLength(2);
  });

  it('six pairs of rows, eight deep, four bike lines at the front', () => {
    expect(m.blocks).toEqual([2, 2, 2, 2, 2, 2]);
    expect(m.deep).toBe(8);
    expect(m.lines).toBe(4);
    expect(m.hall).toBeCloseTo(54.8, 2);
  });

  it('numbers rows 10 down to 1 from the east — and keeps counting to 0 and −1', () => {
    // The plan fits twelve rows where the DB names ten: the two on the west
    // wall have no `ROW n` yet. That is a fact about the floor, not the engine.
    expect(rowsOf(m)).toEqual([
      ['-1', '0'],
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
      ['7', '8'],
      ['9', '10'],
    ]);
  });
});

describe('V9 — the sliders move the counts, not the names', () => {
  it('a 65" deep pallet loses a tier in Bay 3 North and gains a bike line', () => {
    const m = layout('bay3_north', { pd: 65 });
    expect(m.pallets).toBe(138);
    expect(m.gross).toBe(140);
    expect(m.deep).toBe(9);
    expect(m.lines).toBe(1);
    expect(m.totalBikes).toBe(4140 + 84);
    expect(m.accessible).toBe(90);
    expect(rowsOf(m)).toEqual(rowsOf(layout('bay3_north')));
  });

  it('a 57" wide pallet fits the same 14 rows in Bay 3 North but redraws the blocks', () => {
    const m = layout('bay3_north', { pw: 57 });
    expect(m.blocks).toEqual([2, 2, 2, 4, 4]);
    expect(m.pallets).toBe(153);
    expect(m.hits).toHaveLength(1);
  });
});

describe("today's numbers, every zone, default state", () => {
  const expected: Record<
    ZoneId,
    { blocks: number[]; pallets: number; gross: number; bikes: number; fast: number; hits: number }
  > = {
    bay3_north: { blocks: [3, 3, 4, 4], pallets: 152, gross: 154, bikes: 4560, fast: 98, hits: 2 },
    bay3_se: { blocks: [3, 2], pallets: 29, gross: 30, bikes: 870, fast: 25, hits: 1 },
    bay2_north: {
      blocks: [2, 2, 2, 2, 2, 2],
      pallets: 94,
      gross: 96,
      bikes: 3108,
      fast: 94,
      hits: 2,
    },
    bay2_south: { blocks: [2, 2, 2], pallets: 47, gross: 48, bikes: 1590, fast: 47, hits: 1 },
    bay1_north: {
      blocks: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      pallets: 171,
      gross: 176,
      bikes: 5394,
      fast: 171,
      hits: 5,
    },
    bay1_office_gap: {
      blocks: [2, 2, 2, 2],
      pallets: 16,
      gross: 16,
      bikes: 720,
      fast: 16,
      hits: 0,
    },
  };

  for (const id of ZONE_IDS) {
    it(id, () => {
      const m = layout(id);
      const e = expected[id];
      expect(m.blocks).toEqual(e.blocks);
      expect(m.pallets).toBe(e.pallets);
      expect(m.gross).toBe(e.gross);
      expect(m.totalBikes).toBe(e.bikes);
      expect(m.accessible).toBe(e.fast);
      expect(m.hits).toHaveLength(e.hits);
      expect(m.palletBikes).toBe(m.pallets * BIKES_PER_PALLET);
    });
  }
});

describe('the toggles the pages offer', () => {
  it('Bay 2 South: each wall hall given back adds rows', () => {
    expect(layout('bay2_south').pallets).toBe(47);
    expect(layout('bay2_south', { toggles: { west: false, east: true } }).pallets).toBe(54);
    expect(layout('bay2_south', { toggles: { west: true, east: false } }).pallets).toBe(48);
    expect(layout('bay2_south', { toggles: { west: false, east: false } }).pallets).toBe(55);
  });

  it('Bay 2 North E–W: three pairs of long rows, all fast, no post hit', () => {
    const m = layout('bay2_north', { isEW: true });
    expect(m.blocks).toEqual([2, 2, 2]);
    expect(m.pallets).toBe(84);
    expect(m.accessible).toBe(84);
    expect(m.hits).toHaveLength(0);
    // Rows parallel to the main hall need a cross hall to reach it.
    expect(m.obstacles.find((o) => o.id === 'dynamic_cross_hall')?.w).toBe(120);
  });

  it('Bay 3 North E–W has no layout: its two mandatory 4-row blocks were written for N–S', () => {
    // With rows E–W the only sequence with two 4s puts a post mid-hall with
    // no 54" clear on either side. The page shows the empty result; nobody
    // has asked for the constraint to bend.
    expect(calculateLayout(ZONES.bay3_north, defaultEngineState({ isEW: true }))).toBeNull();
  });

  it('one centre hall: two big blocks, the leftover all in the middle', () => {
    const m = layout('bay3_north', { layoutPreset: 'center_hall' });
    expect(m.blocks).toEqual([8, 8]);
    expect(m.pallets).toBe(174);
    expect(m.accessible).toBe(68);
    expect(hallsOf(m)).toEqual([111]);
    expect(rowsOf(m)[0]).toEqual(['18', '19', '20', '21', '22', '23', '24', '25']);
  });

  it('solid: one mass block, no halls, most pallets and fewest fast', () => {
    const m = layout('bay3_north', { layoutPreset: 'solid' });
    expect(m.blocks).toEqual([17]);
    expect(m.nHalls).toBe(0);
    expect(m.pallets).toBe(182);
    expect(m.accessible).toBe(51);
  });

  it('a forced hall width takes its inches from the others', () => {
    expect(hallsOf(layout('bay1_office_gap'))).toEqual([87.17, 87.17, 87.17]);
    const m = layout('bay1_office_gap', { hallOverrides: { 0: 60 } });
    expect(hallsOf(m)).toEqual([60, 100.75, 100.75]);
    expect(m.pallets).toBe(16);
  });

  it('a forced width the leftover cannot pay for is not a layout', () => {
    // Bay 2 South has 3" to spare; asking hall 0 for six more is refused, and
    // the search settles for whatever arrangement can afford it.
    const m = layout('bay2_south', { hallOverrides: { 0: 60 } });
    expect(m.blocks).not.toEqual([2, 2, 2]);
    expect(hallsOf(m)[0]).toBe(60);
  });
});

describe('what a slot is', () => {
  it('every surviving slot has a unique `ROW n · letter` name', () => {
    for (const id of ZONE_IDS) {
      const keys = layout(id).validCells.map(slotKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('letters run A to the depth, A being the slot on the hall', () => {
    const m = layout('bay2_south');
    const letters = new Set(m.validCells.map((c) => c.letter));
    expect([...letters].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    // Bay 2 South's hall is to the north: slot A is the northernmost pallet,
    // right behind the five loose bike lines that take the leftover depth.
    const row11 = m.validCells.filter((c) => c.row.num === '11');
    const a = row11.find((c) => c.letter === 'A')!;
    for (const c of row11) expect(c.cy).toBeGreaterThanOrEqual(a.cy);
    expect(m.lines).toBe(5);
    expect(m.gapW).toBe(50);
    expect(a.cy).toBe(m.margins.top + m.gapW);
  });

  it('a slot is fast on the edge row of its block or at either end of the row', () => {
    const m = layout('bay3_north');
    const block4 = m.strip.find((s) => s.type === 'block' && s.size === 4)!;
    if (block4.type !== 'block') throw new Error('unreachable');
    const inner = block4.rows[1];
    const cells = m.validCells.filter((c) => c.row === inner);
    expect(cells.filter((c) => c.isFast).map((c) => c.letter)).toEqual(['A', 'K']);
    const edge = block4.rows[0];
    expect(m.validCells.filter((c) => c.row === edge).every((c) => c.isFast)).toBe(true);
  });

  it('a drawn obstacle kills the slots under it and is reported as a hit', () => {
    const base = layout('bay2_south');
    const m = layout('bay2_south', {
      customObstacles: [
        { id: 'shelf', x: 60, y: 120, w: 62, h: 60, type: 'non_bike_rack', label: 'PARTS SHELF' },
      ],
    });
    expect(m.gross).toBe(base.gross);
    expect(m.pallets).toBe(base.pallets - 1);
    expect(m.hits.map((h) => h.source.note)).toContain('PARTS SHELF');
    expect(m.obstacles.map((o) => o.id)).toContain('shelf');
  });
});

describe('the engine itself', () => {
  it('is deterministic', () => {
    const a = layout('bay1_north', { pw: 59 });
    const b = layout('bay1_north', { pw: 59 });
    expect(a).toEqual(b);
  });

  it('returns null when not one pallet fits', () => {
    expect(calculateLayout(ZONES.bay1_office_gap, defaultEngineState({ pd: 200 }))).toBeNull();
  });

  it('never draws a hall narrower than HALL_MIN', () => {
    for (const id of ZONE_IDS) {
      for (const preset of ['standard', 'center_hall'] as const) {
        const m = calculateLayout(ZONES[id], defaultEngineState({ layoutPreset: preset }));
        if (!m) continue;
        for (const seg of m.strip) {
          if (seg.type === 'hall' && !seg.isExtraOnly) {
            expect(seg.w).toBeGreaterThanOrEqual(HALL_MIN - 1e-9);
          }
        }
      }
    }
  });

  it('labels rows from `start` toward `end` and keeps going', () => {
    expect(rowLabelSequence(ZONES.bay3_north).slice(0, 3)).toEqual(['33', '32', '31']);
    expect(rowLabelSequence(ZONES.bay2_south).slice(0, 3)).toEqual(['11', '12', '13']);
    expect(rowLabelSequence(ZONES.bay2_south)).toHaveLength(150);
  });

  it('knows its zone ids', () => {
    expect(isZoneId('bay3_north')).toBe(true);
    expect(isZoneId('bay4')).toBe(false);
    expect(isZoneId(null)).toBe(false);
  });
});
