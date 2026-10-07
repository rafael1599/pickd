/**
 * Moving stock with exact numbers per square (idea-255,
 * docs/prds/relocate-stock-redesign.md). Rafael, 7 Oct 2026: «darles la
 * herramienta para que los usuarios en el piso hagan los movimientos con los
 * números exactos por sublocation».
 *
 * The pure half of the Move sheet: what each square of a row holds, what a
 * load takes out of one square (whole pallets, or a number in pick order),
 * where it lands (each tapped square filled to 30) and the groups both rows
 * end with. `move_stock_squares` writes exactly what this builds.
 */
import type { DistributionItem } from '../../../schemas/inventory.schema';
import { byShowOrder, groupUnits, squaredGroups } from '../../../utils/boxSquares';
import { DS_UNITS, palletsFor } from '../../../utils/distributionCalculator';
import { isRowLocation } from './registerItem';

/** What one square of a row holds of one SKU: its groups and the units no box covers. */
export interface SquareStock {
  /** Null outside a ROW, or in a ROW nobody gave letters. */
  square: string | null;
  groups: DistributionItem[];
  loose: number;
}

export interface RowLike {
  quantity: number;
  location: string | null;
  distribution: DistributionItem[] | null | undefined;
  sublocation: string[] | null | undefined;
}

export interface RowStock {
  squares: SquareStock[];
  /** Several letters and groups without a square: how many in each must be asked. */
  needsSplit: string[] | null;
}

const isLetter = (l: unknown): l is string => typeof l === 'string' && /^[A-Z]$/.test(l);

export const stockUnits = (s: SquareStock): number =>
  s.groups.reduce((n, g) => n + groupUnits(g), 0) + s.loose;

/** The order a pick takes groups in (`deduct_from_groups`): top first. */
const PICK_ORDER = ['TOP', 'BASE', 'LINE_PALLET', 'LINE', 'TOWER'];

const clean = (d: DistributionItem): DistributionItem => {
  const out: DistributionItem = {
    type: d.type,
    count: Math.trunc(Number(d.count)),
    units_each: Math.trunc(Number(d.units_each)),
  };
  if (d.label) out.label = d.label;
  if (isLetter(d.square)) out.square = d.square;
  return out;
};

/** Equal groups merged, shown in the card's order; squares kept. */
function merged(groups: DistributionItem[], letter: string | null): DistributionItem[] {
  const stamped = groups
    .filter((g) => groupUnits(g) > 0)
    .map((g) => (letter ? { ...g, square: letter } : { ...clean(g), square: undefined }));
  const out = squaredGroups(stamped, letter ? [letter] : []);
  if (letter) return out;
  return out.map((g) => {
    const c = { ...g };
    delete c.square;
    return c;
  });
}

/**
 * What each square of a row holds. One letter: everything is in it. Several,
 * and every group says its square: as they say. Several and some don't: the
 * split (`{B: 28, C: 30}`) decides — the unsquared boxes fill each square in
 * turn up to its number; without a split the row `needsSplit`.
 */
export function rowStock(row: RowLike, split?: Record<string, number> | null): RowStock {
  const groups = (row.distribution ?? []).filter((g) => groupUnits(g) > 0).map(clean);
  const boxes = groups.reduce((n, g) => n + groupUnits(g), 0);
  const loose = Math.max(0, row.quantity - boxes);
  const letters = isRowLocation(row.location)
    ? [
        ...new Set([
          ...(row.sublocation ?? []).filter(isLetter),
          ...groups.map((g) => g.square).filter(isLetter),
        ]),
      ].sort()
    : [];

  if (letters.length === 0) {
    return { squares: [{ square: null, groups: merged(groups, null), loose }], needsSplit: null };
  }
  if (letters.length === 1) {
    return {
      squares: [{ square: letters[0], groups: merged(groups, letters[0]), loose }],
      needsSplit: null,
    };
  }

  const bySquare = new Map<string, DistributionItem[]>(letters.map((l) => [l, []]));
  const unsquared: DistributionItem[] = [];
  for (const g of groups) (g.square ? bySquare.get(g.square)! : unsquared).push(g);

  if (unsquared.length === 0 && groups.length > 0) {
    // Every group says its square; units no box covers stand in the first
    // square that has no box (else the first).
    const bare = letters.find((l) => bySquare.get(l)!.length === 0) ?? letters[0];
    return {
      squares: letters.map((l) => ({
        square: l,
        groups: merged(bySquare.get(l)!, l),
        loose: l === bare ? loose : 0,
      })),
      needsSplit: null,
    };
  }
  // Several letters and no box says where its units stand (or no box at all):
  // how many in each must be asked.
  if (!split) {
    return {
      squares: letters.map((l, i) => ({
        square: l,
        groups: merged(i === 0 ? [...bySquare.get(l)!, ...unsquared] : bySquare.get(l)!, l),
        loose: i === 0 ? loose : 0,
      })),
      needsSplit: letters,
    };
  }

  // Fill each square up to its number with whole boxes, biggest first.
  const pool = [...unsquared].sort((a, b) => b.units_each - a.units_each);
  const squares = letters.map((l) => {
    const target = Math.max(0, Math.trunc(split[l] ?? 0));
    const mine = [...bySquare.get(l)!];
    let need = target - mine.reduce((n, g) => n + groupUnits(g), 0);
    for (const g of pool) {
      if (need <= 0 || g.count <= 0) continue;
      const k = Math.min(g.count, Math.floor(need / g.units_each));
      if (k <= 0) continue;
      mine.push({ ...g, count: k });
      g.count -= k;
      need -= k * g.units_each;
    }
    return { square: l, groups: mine, target };
  });
  // Boxes no number had room for stay in the last square.
  const left = pool.filter((g) => g.count > 0);
  squares[squares.length - 1].groups.push(...left);
  return {
    squares: squares.map(({ square, groups: gs, target }) => {
      const units = gs.reduce((n, g) => n + groupUnits(g), 0);
      return { square, groups: merged(gs, square), loose: Math.max(0, target - units) };
    }),
    needsSplit: null,
  };
}

/** The groups a row is written with: every group with its square (when it has one). */
export const toDistribution = (squares: SquareStock[]): DistributionItem[] =>
  squares.flatMap((s) => s.groups.map((g) => (s.square ? { ...g, square: s.square } : clean(g))));

// ── The load ───────────────────────────────────────────────────────────────

export interface Load {
  square: string | null;
  /** What leaves, as groups (whole or the part of one), and the loose units. */
  groups: DistributionItem[];
  loose: number;
  units: number;
  /** Units that come off a top (🪜), and the top before → after. */
  fromTop: number;
  topBefore: number;
  topAfter: number;
}

export interface Take {
  load: Load;
  /** The square as it stays. */
  after: SquareStock;
}

const topUnits = (groups: DistributionItem[]) =>
  groups.filter((g) => g.type === 'TOP').reduce((n, g) => n + groupUnits(g), 0);

function loadOf(
  before: SquareStock,
  after: SquareStock,
  groups: DistributionItem[],
  loose: number
) {
  const topBefore = topUnits(before.groups);
  const topAfter = topUnits(after.groups);
  return {
    square: before.square,
    groups,
    loose,
    units: groups.reduce((n, g) => n + groupUnits(g), 0) + loose,
    fromTop: topBefore - topAfter,
    topBefore,
    topAfter,
  };
}

/**
 * Whole pallets lifted by tapping: the indexes of `stock.groups`, and
 * `'loose'` for the units no box covers.
 */
export function takePallets(stock: SquareStock, picks: ReadonlySet<number | 'loose'>): Take {
  const taken = stock.groups.filter((_, i) => picks.has(i));
  const kept = stock.groups.filter((_, i) => !picks.has(i));
  const loose = picks.has('loose') ? stock.loose : 0;
  const after = { ...stock, groups: kept, loose: stock.loose - loose };
  return { load: loadOf(stock, after, taken, loose), after };
}

/**
 * A typed number: out in pick order — top, base, line pallet, then the old
 * kinds, smallest box first — and the loose units last. One rule for picks
 * and moves.
 */
export function takeCount(stock: SquareStock, n: number): Take {
  let pending = Math.max(0, Math.min(Math.trunc(n), stockUnits(stock)));
  const rank = (g: DistributionItem) => {
    const i = PICK_ORDER.indexOf(g.type);
    return i < 0 ? PICK_ORDER.length : i;
  };
  const order = stock.groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.g.units_each - b.g.units_each);
  const kept = new Map<number, DistributionItem[]>();
  const taken: DistributionItem[] = [];
  for (const { g, i } of order) {
    let count = g.count;
    const out: DistributionItem[] = [];
    if (pending > 0) {
      const whole = Math.min(count, Math.floor(pending / g.units_each));
      if (whole > 0) taken.push({ ...g, count: whole });
      count -= whole;
      pending -= whole * g.units_each;
      if (pending > 0 && count > 0) {
        count -= 1;
        taken.push({ ...g, count: 1, units_each: pending });
        out.push({ ...g, count: 1, units_each: g.units_each - pending });
        pending = 0;
      }
    }
    if (count > 0) out.unshift({ ...g, count });
    kept.set(i, out);
  }
  const loose = Math.min(pending, stock.loose);
  const groups = stock.groups.flatMap((_, i) => kept.get(i) ?? []);
  const after = { ...stock, groups: merged(groups, stock.square), loose: stock.loose - loose };
  return { load: loadOf(stock, after, taken, loose), after };
}

// ── Where it lands ─────────────────────────────────────────────────────────

export interface Landing {
  square: string;
  units: number;
}

/**
 * The load over the tapped squares, in the order tapped: each filled up to 30
 * with what is already there (any SKU); what no square has room for stays in
 * the last one — a warning, never a gate.
 */
export function allocate(
  units: number,
  squares: readonly string[],
  occupied: ReadonlyMap<string, number>
): { land: Landing[]; left: number } {
  const land: Landing[] = [];
  let rest = units;
  for (const s of squares) {
    if (rest <= 0) break;
    const room = Math.max(0, DS_UNITS - (occupied.get(s) ?? 0));
    const n = Math.min(rest, room);
    if (n > 0) land.push({ square: s, units: n });
    rest -= n;
  }
  const left = squares.length > 0 && rest > 0 ? rest : 0;
  if (left > 0) {
    const last = squares[squares.length - 1];
    const hit = land.find((l) => l.square === last);
    if (hit) hit.units += left;
    else land.push({ square: last, units: left });
  }
  return { land, left };
}

/**
 * The destination's groups after the landing. An adult bike's square is
 * rebuilt from all its units with the DS rule (9 + 4 = base 13); a kids
 * bike's never is — whole pallets land as they are, a number lands as one
 * group of the kind it came from. A destination still waiting for its split
 * keeps its groups untouched and gets the new ones beside them.
 */
export function landInRow(
  dest: RowStock | null,
  destRaw: DistributionItem[],
  load: Load,
  land: readonly Landing[],
  isKid: boolean
): DistributionItem[] {
  const squares = new Map<string, SquareStock>();
  const exact = dest && !dest.needsSplit;
  if (exact) for (const s of dest.squares) if (s.square) squares.set(s.square, s);
  const touched = new Set(land.map((l) => l.square));
  const out: DistributionItem[] = exact
    ? toDistribution(dest.squares.filter((s) => !s.square || !touched.has(s.square)))
    : destRaw.map(clean);

  const kind = load.groups[0]?.type ?? 'LINE_PALLET';
  const whole = land.length === 1 && land[0].units === load.units;
  for (const l of land) {
    const here = squares.get(l.square);
    if (isKid) {
      if (here) out.push(...here.groups.map((g) => ({ ...g, square: l.square })));
      if (whole) {
        out.push(...load.groups.map((g) => ({ ...g, square: l.square })));
        if (load.loose > 0)
          out.push({ type: kind, count: 1, units_each: load.loose, square: l.square });
      } else {
        out.push({ type: kind, count: 1, units_each: l.units, square: l.square });
      }
    } else {
      const total = (here ? stockUnits(here) : 0) + l.units;
      out.push(...palletsFor(total).map((g) => ({ ...g, square: l.square })));
    }
  }
  return mergeKeepingSquares(out);
}

/** Equal groups (square, type, units each) merged; a group without a square keeps none. */
function mergeKeepingSquares(groups: DistributionItem[]): DistributionItem[] {
  const byKey = new Map<string, DistributionItem>();
  for (const g of groups) {
    if (groupUnits(g) === 0) continue;
    const key = `${g.square ?? ''}:${g.type}:${g.units_each}`;
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...prev, count: prev.count + g.count } : { ...g });
  }
  return [...byKey.values()].sort(byShowOrder);
}

// ── The destination's squares ──────────────────────────────────────────────

export interface RowLine extends RowLike {
  sku: string;
}

export interface SquareFill {
  units: number;
  /** Units of this SKU. */
  mine: number;
  /** Other SKUs standing there. */
  others: number;
}

/** What each square of a row holds, every SKU counted; a line not split yet is spread evenly. */
export function rowOccupancy(lines: readonly RowLine[], sku: string): Map<string, SquareFill> {
  const out = new Map<string, SquareFill>();
  const others = new Map<string, Set<string>>();
  const add = (l: string, n: number, lineSku: string) => {
    const f = out.get(l) ?? { units: 0, mine: 0, others: 0 };
    f.units += n;
    if (lineSku === sku) f.mine += n;
    else {
      const set = others.get(l) ?? new Set();
      set.add(lineSku);
      others.set(l, set);
      f.others = set.size;
    }
    out.set(l, f);
  };
  for (const line of lines) {
    if (!(line.quantity > 0)) continue;
    const rs = rowStock(line);
    if (rs.needsSplit) {
      const share = line.quantity / rs.needsSplit.length;
      for (const l of rs.needsSplit) add(l, share, line.sku);
    } else {
      for (const s of rs.squares) if (s.square) add(s.square, stockUnits(s), line.sku);
    }
  }
  for (const f of out.values()) {
    f.units = Math.round(f.units);
    f.mine = Math.round(f.mine);
  }
  return out;
}

// ── What gets typed or scanned ─────────────────────────────────────────────

/** `30`, `ROW 30`, `r30` → ROW 30; `30F`, `30 F`, `ROW 30-F` → ROW 30 and F. Anything else as typed. */
export function parseDestination(text: string): { location: string; square: string | null } | null {
  const t = text.trim().toUpperCase();
  if (!t) return null;
  const m = t.match(/^(?:ROW\s*|R\s*)?(\d{1,2})(?:\s*[-·.]?\s*([A-Z]))?$/);
  if (m) return { location: `ROW ${Number(m[1])}`, square: m[2] ?? null };
  return { location: t, square: null };
}
