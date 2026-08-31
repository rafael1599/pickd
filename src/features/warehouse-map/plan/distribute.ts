// DISTRIBUTE: a square holds one double-stacked pallet, 30 units, no more
// (Rafael, 28 Aug 2026: "reparte, los que no caben en las locations actuales
// ponlas en el espacio disponible buried"). For every line in the zone with
// more units than its squares hold, plan the squares it needs: first the
// free squares of its own row (a relabel to a wider span), then, for what
// still does not fit, free buried squares in the nearest rows (a move of just
// those units); fast squares only when no buried square is left, and the
// result says how many landed there. What finds no square at all goes to the
// MAIN HALL, on the floor in front of its block (Rafael, 31 Aug 2026: "lo que
// sobre se pone en el main hall sur, delante de su bloque correspondiente") —
// never a second SKU squeezed into an occupied square. Lines with no letter
// at all get a square too — small ones share one. A letter the drawing does
// not have is a place, not a gap: those lines stay put and the map keeps
// listing them as not drawn. (K stopped being one on 31 Aug 2026: rows 30–33
// draw it as the 11th square — `extraSlotRows` — so its lines place and its
// squares deal.)

import type { LayoutModel } from '../engine';
import { slotKey } from '../engine';
import { PALLET_UNITS, squaresFor, type ZoneStock } from '../stock/rowStock';
import { locationOfKey, type MoveDraft, type PlannedState } from './slotPlan';

export interface Distribution {
  drafts: MoveDraft[];
  /** Lines that already fit and were left alone. */
  untouched: number;
  /** Moves that had to use a fast square because no buried one was left. */
  onFast: number;
  /** Moves whose units found no square at all: to the MAIN HALL, in front of their block. */
  toHall: number;
}

interface Square {
  key: string;
  rowNum: number;
  letter: string;
  isFast: boolean;
  /** Depth index: 0 is slot A on the hall. */
  d: number;
}

interface Line {
  inventoryId: number;
  sku: string;
  qty: number;
  itemName: string | null;
  warehouse: string;
  location: string;
  rowNum: number;
  /** The drawn squares it lives in today; empty for a line the drawing had no square for. */
  letters: string[];
  /** What the DB says (nothing, for a line with no letter). */
  sublocation: string[] | null;
}

const sortLetters = (letters: string[]) => [...new Set(letters)].sort();
const rowOf = (location: string) => Number(/\d+/.exec(location)?.[0] ?? NaN);

export function distribute(
  stock: ZoneStock,
  model: LayoutModel,
  state: PlannedState,
  /** Plan only these lines; the rest still hold their squares. The automatic
      over-the-cap spread uses it to touch just the offenders. */
  lineFilter: (line: { inventoryId: number }) => boolean = () => true
): Distribution {
  // The squares that can take something: drawn, no live line, no ghost.
  const squares = new Map<string, Square>();
  for (const c of model.validCells) {
    const key = slotKey(c);
    if (stock.cells.has(key) || (state.ghosts.get(key)?.length ?? 0) > 0) continue;
    squares.set(key, {
      key,
      rowNum: Number(c.row.num),
      letter: c.letter,
      isFast: c.isFast,
      d: c.d,
    });
  }
  const drawnRows = new Set(model.validCells.map((c) => Number(c.row.num)));

  // Each line once, with the squares it lives in.
  const lines = new Map<number, Line>();
  for (const cell of stock.cells.values()) {
    for (const e of cell.entries) {
      if (state.hasMove.has(e.rowId)) continue;
      const line = lines.get(e.rowId) ?? {
        inventoryId: e.rowId,
        sku: e.sku,
        qty: e.qty,
        itemName: e.itemName,
        warehouse: e.warehouse,
        location: locationOfKey(cell.key),
        rowNum: cell.rowNumber,
        letters: [],
        sublocation: null,
      };
      line.letters.push(cell.letter);
      lines.set(e.rowId, line);
    }
  }
  // Lines with no letter at all. A letter the drawing does not have (K) is left alone.
  for (const u of stock.unplaced) {
    if (u.reason !== 'no-letter') continue;
    if (lines.has(u.row.id) || state.hasMove.has(u.row.id)) continue;
    const rowNum = rowOf(u.row.location);
    if (!drawnRows.has(rowNum)) continue;
    lines.set(u.row.id, {
      inventoryId: u.row.id,
      sku: u.row.sku,
      qty: u.row.quantity,
      itemName: u.row.itemName,
      warehouse: u.row.warehouse,
      location: u.row.location,
      rowNum,
      letters: [],
      sublocation: u.row.sublocation,
    });
  }

  const drafts: MoveDraft[] = [];
  let untouched = 0;
  let onFast = 0;
  let toHall = 0;
  const take = (sq: Square) => squares.delete(sq.key);
  /** Squares this pass started with a small line, with room to spare, by row. */
  const shared = new Map<number, { key: string; letter: string; left: number }[]>();

  const depthOf = (rowNum: number, letter: string) =>
    model.validCells.find((c) => slotKey(c) === `${rowNum}-${letter}`)?.d ?? -1;

  /** Free squares of a row, deeper than `afterD` first, then the rest by depth. */
  const ownRowSquares = (rowNum: number, afterD: number) =>
    [...squares.values()]
      .filter((s) => s.rowNum === rowNum)
      .sort((a, b) => Number(a.d <= afterD) - Number(b.d <= afterD) || a.d - b.d);

  /** Free squares elsewhere for `units`: buried in the nearest row, fast only when none is left. */
  const elsewhere = (rowNum: number, units: number): { taken: Square[]; fast: boolean } | null => {
    const pool = [...squares.values()].filter((s) => !s.isFast);
    const fast = pool.length === 0;
    const candidates = fast ? [...squares.values()] : pool;
    if (candidates.length === 0) return null;
    const byRow = new Map<number, Square[]>();
    for (const s of candidates) byRow.set(s.rowNum, [...(byRow.get(s.rowNum) ?? []), s]);
    const rows = [...byRow.keys()].sort(
      (a, b) => Math.abs(a - rowNum) - Math.abs(b - rowNum) || a - b
    );
    const here = byRow.get(rows[0])!.sort((a, b) => a.d - b.d);
    return { taken: here.slice(0, squaresFor(units)), fast };
  };

  const draft = (line: Line, toLocation: string, toLetters: string[], qty: number): MoveDraft => ({
    inventoryId: line.inventoryId,
    sku: line.sku,
    qty,
    itemName: line.itemName,
    warehouse: line.warehouse,
    fromLocation: line.location,
    fromSublocation: line.letters.length ? line.letters : line.sublocation,
    toLocation,
    toLetters: sortLetters(toLetters),
    kind:
      toLocation.trim().toUpperCase() === line.location.trim().toUpperCase() ? 'relabel' : 'move',
  });

  // Biggest lines first: they have the fewest places to go.
  const ordered = [...lines.values()].filter(lineFilter).sort((a, b) => b.qty - a.qty);
  for (const line of ordered) {
    const need = squaresFor(line.qty);
    if (line.letters.length > 0 && need <= line.letters.length) {
      untouched++;
      continue;
    }

    // A small line with no square can share one another small line started.
    if (line.letters.length === 0 && line.qty <= PALLET_UNITS) {
      const room = (shared.get(line.rowNum) ?? []).find((s) => s.left >= line.qty);
      if (room) {
        room.left -= line.qty;
        drafts.push(draft(line, line.location, [room.letter], line.qty));
        continue;
      }
    }

    let missing = need - line.letters.length;

    // 1. Its own row: the free squares deeper than its last letter first, then any.
    const lastD = line.letters.length
      ? Math.max(...line.letters.map((l) => depthOf(line.rowNum, l)))
      : -1;
    const extended: string[] = [];
    for (const sq of ownRowSquares(line.rowNum, lastD)) {
      if (missing === 0) break;
      extended.push(sq.letter);
      take(sq);
      missing--;
    }
    const span = [...line.letters, ...extended];
    if (extended.length > 0) {
      drafts.push(draft(line, line.location, span, line.qty));
      if (line.letters.length === 0 && line.qty < PALLET_UNITS) {
        shared.set(line.rowNum, [
          ...(shared.get(line.rowNum) ?? []),
          {
            key: `${line.rowNum}-${extended[0]}`,
            letter: extended[0],
            left: PALLET_UNITS - line.qty,
          },
        ]);
      }
    }
    if (missing === 0) continue;

    // 2. What still does not fit goes elsewhere: buried squares in the nearest rows,
    //    fast squares only when no buried one is left.
    let overflow = line.qty - PALLET_UNITS * span.length;
    while (overflow > 0) {
      const found = elsewhere(line.rowNum, overflow);
      if (!found || found.taken.length === 0) break;
      for (const sq of found.taken) take(sq);
      const units = Math.min(overflow, PALLET_UNITS * found.taken.length);
      drafts.push(
        draft(
          line,
          `ROW ${found.taken[0].rowNum}`,
          found.taken.map((s) => s.letter),
          units
        )
      );
      if (found.fast) onFast++;
      overflow -= units;
    }
    // No square anywhere: the floor of the MAIN HALL, in front of its block.
    if (overflow > 0) {
      drafts.push(draft(line, 'MAIN HALL', [], overflow));
      toHall++;
    }
  }

  return { drafts, untouched, onFast, toHall };
}
