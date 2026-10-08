// Un solo motor elige el par (fila, cuadro) — 8 oct 2026, Rafael: «priorizar
// rows con acceso a pasillo y menor cantidad». Los dos casos reales de la orden
// #881852 van tal cual, con la geometría de `row_squares` leída de la misma
// migración que siembra la base (la que `squareAccess.test.ts` compara con el
// motor del mapa).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buriedUnitsAt,
  byPickPreference,
  planPickAcrossLocations,
  toPickingOrderMap,
  type PickSplit,
  type SquareGroup,
} from '../pickLocation';
import { linePalletSteps, squarePlanKey } from '../linePickPlan';
import { rebaseToActualStock, type StaleInventoryRow } from '../../hooks/useStaleLocationCheck';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');

function seededRowSquares(): { location: string; letter: string; is_fast: boolean }[] {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse()
    .find((f) =>
      readFileSync(join(MIGRATIONS, f), 'utf8').includes('INSERT INTO public.row_squares')
    );
  const sql = readFileSync(join(MIGRATIONS, file!), 'utf8');
  return [...sql.matchAll(/\('(ROW \d+)','([A-Z])',(true|false)\)/g)].map((m) => ({
    location: m[1],
    letter: m[2],
    is_fast: m[3] === 'true',
  }));
}

const order = toPickingOrderMap(
  [
    {
      warehouse: 'LUDLOW',
      location: 'CANCELLED PALLET',
      picking_order: 420,
      pick_priority: 'first',
    },
    { warehouse: 'LUDLOW', location: 'RETURN TO STOCK', picking_order: 294, pick_priority: 'last' },
  ],
  seededRowSquares()
);

type Group = SquareGroup & { type: string; count: number; units_each: number };
const g = (type: string, count: number, units_each: number, square?: string): Group => ({
  type,
  count,
  units_each,
  ...(square ? { square } : {}),
});

interface Row extends StaleInventoryRow {
  distribution: Group[];
}
const inv = (
  location: string,
  quantity: number,
  distribution: Group[] = [],
  warehouse = 'LUDLOW',
  sku = '03-4038BL'
): Row => ({
  sku,
  warehouse,
  location,
  quantity,
  is_active: true,
  sublocation: null,
  distribution,
});

// 03-4038BL en LUDLOW, como estaba en prod el 8 oct 2026.
const r4038 = [
  inv('ROW 30', 7, [g('LINE_PALLET', 1, 7, 'E')]),
  inv('ROW 31', 60, [
    g('BASE', 1, 18, 'D'),
    g('TOP', 2, 12, 'D'),
    g('BASE', 1, 18, 'E'),
    g('TOP', 1, 12, 'E'),
  ]),
  inv('ROW 32', 60, [
    g('BASE', 1, 18, 'D'),
    g('TOP', 1, 12, 'D'),
    g('BASE', 1, 18, 'E'),
    g('TOP', 1, 12, 'E'),
  ]),
  inv('ROW 33', 30, [g('BASE', 1, 18, 'D'), g('TOP', 1, 12, 'D')]),
];

// 03-3740BK en LUDLOW.
const r3740 = [
  inv('ROW 27', 30, [g('BASE', 1, 18, 'A'), g('TOP', 1, 12, 'A')], 'LUDLOW', '03-3740BK'),
  inv('ROW 26', 5, [g('LINE_PALLET', 1, 5, 'A')], 'LUDLOW', '03-3740BK'),
];

/** An order line as the planner sees it. */
interface Line {
  sku: string;
  location: string | null;
  warehouse: string;
  pickingQty: number;
  sublocation?: string[] | null;
  picked?: boolean;
  pickSplit?: PickSplit | null;
}
const line = (
  location: string | null,
  pickingQty = 1,
  extra: Partial<Line> = {},
  sku = '03-4038BL'
): Line => ({ sku, location, warehouse: 'LUDLOW', pickingQty, ...extra });

const legs = (rows: Row[], qty: number, frozen?: string) =>
  planPickAcrossLocations(rows, qty, order, frozen).legs.map((l) => [
    l.location,
    l.sublocation,
    l.qty,
  ]);

describe('#881852 — the two cases the picker changed by hand', () => {
  it('03-4038BL: ROW 30 E (a line pallet of 7, accessible) beats ROW 31/32 (D and E buried) and ROW 33', () => {
    expect(legs(r4038, 1)).toEqual([['ROW 30', ['E'], 1]]);
    expect(legs(r4038, 7)).toEqual([['ROW 30', ['E'], 7]]);
    expect([...r4038].sort(byPickPreference(order))[0].location).toBe('ROW 30');
  });

  it('03-3740BK: ROW 26 A (5) beats ROW 27 A (30), both accessible — fewer units', () => {
    expect(legs(r3740, 1)).toEqual([['ROW 26', ['A'], 1]]);
    expect([...r3740].sort(byPickPreference(order))[0].location).toBe('ROW 26');
  });

  it('a fresh line (no address) is planned onto ROW 30 E', () => {
    const { items } = rebaseToActualStock([line(null, 1)], r4038, order, {
      claimReturnsFloor: true,
    });
    expect(items.map((i) => [i.location, i.sublocation, i.pickingQty])).toEqual([
      ['ROW 30', ['E'], 1],
    ]);
  });
});

describe('accessible first, buried only for what is left', () => {
  // The ❓ of 8 Oct, default approved: the accessible squares go first even
  // when the buried row alone could cover the whole pick.
  it('splits into two stops: ROW 30 E, then the rest from a buried square of ROW 32', () => {
    const rows = [r4038[0], r4038[2]];
    expect(legs(rows, 10)).toEqual([
      ['ROW 30', ['E'], 7],
      ['ROW 32', ['E'], 3],
    ]);
    const { items } = rebaseToActualStock([line(null, 10)], rows, order);
    expect(
      items.map((i) => [i.location, i.pickingQty, i.pickSplit?.part, i.pickSplit?.of])
    ).toEqual([
      ['ROW 30', 7, 1, 2],
      ['ROW 32', 3, 2, 2],
    ]);
  });

  it('takes a buried square only when no accessible one is left', () => {
    // Only buried squares left: the fewest units among them. ROW 31 counts 72
    // in its groups but holds 60, so 12 are already gone from its first square
    // (E, 30 → 18), which then beats ROW 32 E (30).
    expect(legs([r4038[1], r4038[2]], 1)).toEqual([['ROW 31', ['E'], 1]]);
    expect(buriedUnitsAt(r4038, 'LUDLOW', 'ROW 32', 1, order)).toBe(1);
    expect(buriedUnitsAt(r4038, 'LUDLOW', 'ROW 30', 1, order)).toBe(0);
  });

  it('one stop when an accessible address covers the whole pick', () => {
    // ROW 30 E (7) cannot take 20; ROW 33 D (30) can, from an accessible square.
    expect(legs(r4038, 20)).toEqual([['ROW 33', ['D'], 20]]);
  });
});

describe('the tiers that were already there', () => {
  it('CANCELLED PALLET still goes first', () => {
    const rows = [...r4038, inv('CANCELLED PALLET', 1)];
    expect(legs(rows, 2)).toEqual([
      ['CANCELLED PALLET', null, 1],
      ['ROW 30', ['E'], 1],
    ]);
  });

  it("pick_priority 'last' goes at the very end, after buried squares, though it is accessible", () => {
    const rows = [inv('RETURN TO STOCK', 1), r4038[2]];
    expect(legs(rows, 1)).toEqual([['ROW 32', ['E'], 1]]);
    expect(planPickAcrossLocations(rows, 61, order).legs.map((l) => [l.location, l.qty])).toEqual([
      ['ROW 32', 60],
      ['RETURN TO STOCK', 1],
    ]);
  });
});

describe('rows the map does not draw, and groups without a square', () => {
  it('a row with no row_squares counts as accessible, and competes on its units', () => {
    const rows = [inv('ROW 45', 4, [g('LINE_PALLET', 1, 4, 'F')]), r4038[0]];
    expect(legs(rows, 1)).toEqual([['ROW 45', ['F'], 1]]);
  });

  // Inside an undrawn row the database picks from A first ('A first'); the
  // line names the square that will really be deducted.
  it('inside an undrawn row, A first — as plan_square_picks does', () => {
    const rows = [inv('ROW 45', 14, [g('LINE_PALLET', 1, 10, 'A'), g('LINE_PALLET', 1, 4, 'F')])];
    expect(legs(rows, 1)).toEqual([['ROW 45', ['A'], 1]]);
  });

  it('a row whose groups have no square is accessible, behind those that have one, with the row quantity', () => {
    const noSquare = { ...inv('ROW 33', 3, [g('LINE_PALLET', 1, 3)]), sublocation: ['B'] };
    expect(legs([noSquare, r4038[0]], 1)).toEqual([['ROW 30', ['E'], 1]]);
    // …but ahead of a buried square.
    expect(legs([noSquare, r4038[2]], 1)).toEqual([['ROW 33', ['B'], 1]]);
  });
});

describe('the key is (warehouse, location)', () => {
  // The map draws LUDLOW only: ATS's ROW 31 is not LUDLOW's ROW 31.
  it("ATS's ROW 31 D is accessible where LUDLOW's ROW 31 D is buried", () => {
    const rows = [
      inv('ROW 31', 2, [g('LINE_PALLET', 1, 2, 'D')], 'LUDLOW'),
      inv('ROW 31', 5, [g('LINE_PALLET', 1, 5, 'D')], 'ATS'),
    ];
    const plan = planPickAcrossLocations(rows, 6, order);
    expect(plan.legs.map((l) => [l.location, l.qty, l.available])).toEqual([
      ['ROW 31', 5, 5],
      ['ROW 31', 1, 2],
    ]);
    expect([...rows].sort(byPickPreference(order))[0].warehouse).toBe('ATS');
  });

  it('a plan for one warehouse never reads the other', () => {
    expect(squarePlanKey('03-4038BL', 'LUDLOW', 'ROW 31')).not.toBe(
      squarePlanKey('03-4038BL', 'ATS', 'ROW 31')
    );
    expect(squarePlanKey('03-4038BL', null, 'row 31')).toBe(
      squarePlanKey('03-4038BL', 'LUDLOW', 'ROW 31')
    );
  });
});

describe('a planned line on a buried square is redirected', () => {
  it('frozenLocation does not hold a buried address while an accessible one exists', () => {
    expect(legs(r4038, 1, 'ROW 32')).toEqual([['ROW 30', ['E'], 1]]);
  });

  it('the guard moves an unpicked line off ROW 32 although ROW 32 covers it', () => {
    const { items, moves } = rebaseToActualStock(
      [line('ROW 32', 1, { sublocation: ['D', 'E'] })],
      r4038,
      order,
      { claimReturnsFloor: false }
    );
    expect(moves).toHaveLength(1);
    expect(items.map((i) => [i.location, i.sublocation])).toEqual([['ROW 30', ['E']]]);
  });

  it('…but never a line already picked', () => {
    const picked = line('ROW 32', 1, { picked: true });
    expect(rebaseToActualStock([picked], r4038, order).items[0]).toBe(picked);
  });

  // Staying put on an accessible address that covers is not churned for a
  // smaller one: the rule decides a new plan, it does not chase every change.
  it('leaves a line on an accessible address that covers it', () => {
    const { moves } = rebaseToActualStock([line('ROW 27', 1, {}, '03-3740BK')], r3740, order);
    expect(moves).toHaveLength(0);
  });
});

describe('the pallet icon and figure follow the line’s current address', () => {
  // #881852: moved by hand to ROW 30, the card said TOP 12 — ROW 32 E's top.
  const rows = r4038.map((r) => ({ ...r, distribution: r.distribution }));

  it('ROW 30 E shows its line pallet of 7, not a top of 12', () => {
    expect(
      linePalletSteps({
        rows,
        warehouse: 'LUDLOW',
        location: 'ROW 30',
        qty: 1,
        squarePlan: [{ square: 'E', take: 1 }],
      })
    ).toEqual([{ type: 'LINE_PALLET', units: 1, units_each: 7 }]);
    // Without a plan yet (still loading), still only this address.
    expect(linePalletSteps({ rows, warehouse: 'LUDLOW', location: 'ROW 30', qty: 1 })).toEqual([
      { type: 'LINE_PALLET', units: 1, units_each: 7 },
    ]);
  });

  it('ROW 32 with its plan on E shows E’s top of 12', () => {
    expect(
      linePalletSteps({
        rows,
        warehouse: 'LUDLOW',
        location: 'ROW 32',
        qty: 1,
        squarePlan: [{ square: 'E', take: 1 }],
      })
    ).toEqual([{ type: 'TOP', units: 1, units_each: 12 }]);
  });

  it('an address the SKU is not in shows nothing, never another row’s pallet', () => {
    expect(linePalletSteps({ rows, warehouse: 'LUDLOW', location: 'ROW 9', qty: 1 })).toEqual([]);
    expect(linePalletSteps({ rows, warehouse: 'ATS', location: 'ROW 30', qty: 1 })).toEqual([]);
  });
});
