// DISTRIBUTE: a square holds one double-stacked pallet, 30 units, no more
// (Rafael, 28 Aug 2026: "reparte, los que no caben en las locations actuales
// ponlas en el espacio disponible buried"). For every line in the zone with
// more units than its squares hold, plan the squares it needs: first the
// free squares of its own row (a relabel to a wider span), then, for what
// still does not fit, free buried squares in the nearest rows (a move of just
// those units); fast squares only when no buried square is left, and the
// result says how many landed there. What finds no square at all goes to
// MAS, the floor of the south main hall in front of its block (Rafael, 31 Aug
// 2026: "lo que sobre se pone en el main hall sur, delante de su bloque
// correspondiente… el algoritmo debería priorizar llenar el espacio primero")
// — never a second SKU squeezed into an occupied square, and never MAS while
// a square is free. Lines with no letter
// at all get a square too — small ones share one. A letter the drawing does
// not have is a place, not a gap: those lines stay put and the map keeps
// listing them as not drawn. (K stopped being one on 31 Aug 2026: rows 30–33
// draw it as the 11th square — `extraSlotRows` — so its lines place and its
// squares deal.)

import type { LayoutModel } from '../engine';
import { slotKey } from '../engine';
import { PALLET_UNITS, squaresFor, type ZoneStock } from '../stock/rowStock';
import {
  locationOfKey,
  OVERFLOW_LOCATION,
  sameLocation,
  type MoveDraft,
  type PlanMove,
  type PlannedState,
} from './slotPlan';

export interface Distribution {
  drafts: MoveDraft[];
  /** Lines that already fit and were left alone. */
  untouched: number;
  /** Moves that had to use a fast square because no buried one was left. */
  onFast: number;
  /** Moves whose units found no square at all: to MAS, in front of their block. */
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

/** The squares that can take something: drawn, and empty once the plan runs. */
function freeSquares(model: LayoutModel, state: PlannedState): Map<string, Square> {
  const squares = new Map<string, Square>();
  for (const c of model.validCells) {
    const key = slotKey(c);
    if (state.unitsAt(key) > 0) continue;
    squares.set(key, {
      key,
      rowNum: Number(c.row.num),
      letter: c.letter,
      isFast: c.isFast,
      d: c.d,
    });
  }
  return squares;
}

export function distribute(
  stock: ZoneStock,
  model: LayoutModel,
  state: PlannedState,
  /** Plan only these lines; the rest still hold their squares. The automatic
      over-the-cap spread uses it to touch just the offenders. */
  lineFilter: (line: { inventoryId: number }) => boolean = () => true
): Distribution {
  const squares = freeSquares(model, state);
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
    // No square anywhere: the floor of the south main hall, in front of its block.
    if (overflow > 0) {
      drafts.push(draft(line, OVERFLOW_LOCATION, [], overflow));
      toHall++;
    }
  }

  return { drafts, untouched, onFast, toHall };
}

export interface Repair {
  drafts: MoveDraft[];
  removals: number[];
}

/**
 * The plan's own moves, kept honest. Two passes, both as ghosts in the draft:
 *
 *  A. No square over the cap, whatever put it there. DISTRIBUTE spreads live
 *     lines; this spreads the PLAN'S OWN landings — a hand drop carries a
 *     whole pallet into one square, so a move of 240 units landed 240 in one
 *     (Rafael, 31 Aug 2026: "todavía tengo algunos con 69 y 90 unidades").
 *     The move is re-planned over the squares it needs at the 30 norm: the
 *     free squares of the row it aims at first, then the nearest rows.
 *  B. The space comes first. Units parked in MAS while squares are still free
 *     come back into them, small lines sharing a square.
 *
 * MAS is what is left over after both — never a choice made while a square
 * was free.
 */
export function repairOverCap(model: LayoutModel, state: PlannedState, moves: PlanMove[]): Repair {
  const pool = freeSquares(model, state);
  const drafts: MoveDraft[] = [];
  const removals: number[] = [];

  for (const m of moves) {
    if (m.status !== 'planned' || m.toLetters.length === 0) continue;
    const need = squaresFor(m.qty);
    if (need <= m.toLetters.length) continue; // its shares already fit
    const rowNum = rowOf(m.toLocation);
    if (!Number.isFinite(rowNum)) continue;

    // Its own row first: it is the row the hand pointed at.
    const own = [...pool.values()]
      .filter((s) => s.rowNum === rowNum)
      .sort((a, b) => Number(a.isFast) - Number(b.isFast) || a.d - b.d)
      .slice(0, need - m.toLetters.length);
    for (const s of own) pool.delete(s.key);

    const letters = sortLetters([...m.toLetters, ...own.map((s) => s.letter)]);
    const here = Math.min(m.qty, PALLET_UNITS * letters.length);
    let left = m.qty - here;
    const chunks: { rowNum: number; letters: string[]; units: number }[] = [];
    while (left > 0) {
      const taken = nearestFree(pool, rowNum, squaresFor(left));
      if (taken.length === 0) break;
      for (const s of taken) pool.delete(s.key);
      const units = Math.min(left, PALLET_UNITS * taken.length);
      chunks.push({ rowNum: taken[0].rowNum, letters: taken.map((s) => s.letter), units });
      left -= units;
    }
    // Nothing to gain: no square anywhere, and no hall split to make.
    if (letters.length === m.toLetters.length && chunks.length === 0 && left === m.qty) continue;

    removals.push(m.id);
    drafts.push({ ...asDraft(m), qty: here, toLetters: letters });
    for (const c of chunks) {
      drafts.push({
        ...asDraft(m),
        qty: c.units,
        toLocation: `ROW ${c.rowNum}`,
        toLetters: sortLetters(c.letters),
        kind: sameLocation(m.fromLocation, `ROW ${c.rowNum}`) ? 'relabel' : 'move',
      });
    }
    if (left > 0) {
      drafts.push({
        ...asDraft(m),
        qty: left,
        toLocation: OVERFLOW_LOCATION,
        toLetters: [],
        kind: 'move',
      });
    }
  }

  // Pass B — the space comes first: what is parked in MAS while squares are
  // free comes back into them (Rafael, 31 Aug 2026: "el algoritmo debería
  // priorizar llenar el espacio primero, y cuando no haya espacio el extra va
  // en MAS"). Small lines share a square, as DISTRIBUTE does.
  const parked = moves.filter(
    (m) =>
      m.status === 'planned' &&
      m.toLetters.length === 0 &&
      sameLocation(m.toLocation, OVERFLOW_LOCATION) &&
      !removals.includes(m.id)
  );
  /** The square this pass opened last, with the room it has left. */
  let open: { rowNum: number; letter: string; room: number } | null = null;
  for (const m of [...parked].sort((a, b) => b.qty - a.qty)) {
    const near = rowOf(m.fromLocation);
    const chunks: { rowNum: number; letters: string[]; units: number }[] = [];
    let left = m.qty;
    while (left > 0) {
      if (!open || open.room === 0) {
        const taken = nearestFree(pool, Number.isFinite(near) ? near : 0, 1);
        if (taken.length === 0) break;
        pool.delete(taken[0].key);
        open = { rowNum: taken[0].rowNum, letter: taken[0].letter, room: PALLET_UNITS };
      }
      const units = Math.min(left, open.room);
      chunks.push({ rowNum: open.rowNum, letters: [open.letter], units });
      open.room -= units;
      left -= units;
    }
    if (chunks.length === 0) continue; // nowhere to go: MAS is the right place
    removals.push(m.id);
    for (const c of chunks) {
      const toLocation = `ROW ${c.rowNum}`;
      drafts.push({
        ...asDraft(m),
        qty: c.units,
        toLocation,
        toLetters: c.letters,
        kind: sameLocation(m.fromLocation, toLocation) ? 'relabel' : 'move',
      });
    }
    if (left > 0) drafts.push({ ...asDraft(m), qty: left, toLetters: [] });
  }

  return { drafts, removals };
}

/** Free squares for a landing: buried in the nearest row, fast only when no buried one is left. */
function nearestFree(pool: Map<string, Square>, rowNum: number, need: number): Square[] {
  const buried = [...pool.values()].filter((s) => !s.isFast);
  const candidates = buried.length > 0 ? buried : [...pool.values()];
  if (candidates.length === 0) return [];
  const rows = [...new Set(candidates.map((s) => s.rowNum))].sort(
    (a, b) => Math.abs(a - rowNum) - Math.abs(b - rowNum) || a - b
  );
  return candidates
    .filter((s) => s.rowNum === rows[0])
    .sort((a, b) => a.d - b.d)
    .slice(0, need);
}

const asDraft = (m: PlanMove): MoveDraft => ({
  inventoryId: m.inventoryId,
  sku: m.sku,
  qty: m.qty,
  itemName: m.itemName,
  warehouse: m.warehouse,
  fromLocation: m.fromLocation,
  fromSublocation: m.fromSublocation,
  toLocation: m.toLocation,
  toLetters: m.toLetters,
  kind: m.kind,
});
