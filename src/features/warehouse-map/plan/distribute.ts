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
import { PALLET_UNITS, SQUARE_MAX, squaresFor, type ZoneStock } from '../stock/rowStock';
import {
  cellKey,
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

  // Each line once, as the plan leaves it: the units it still has and the
  // squares it still holds. A line with a planned move is not immune — its
  // remainder has to fit too (Rafael, 31 Aug 2026: the 69 belonged to a line
  // that already had a move, so nothing ever looked at it again). A line
  // whose squares the plan empties has no remainder and drops out, which is
  // what makes running this twice a no-op.
  const lines = new Map<number, Line>();
  for (const cell of stock.cells.values()) {
    for (const e of cell.entries) {
      const left = state.remainingAt(cell.key, e.rowId);
      if (left === 0) continue;
      const line = lines.get(e.rowId) ?? {
        inventoryId: e.rowId,
        sku: e.sku,
        qty: 0,
        itemName: e.itemName,
        warehouse: e.warehouse,
        location: locationOfKey(cell.key),
        rowNum: cell.rowNumber,
        letters: [],
        sublocation: null,
      };
      line.qty += left;
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
    origin: 'auto',
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
 * The plan's own moves, kept honest: no square over the cap, and no unit in
 * the aisle while a square stands empty. Three passes, each a settled step —
 * the first one with something to say returns, and the next render sees the
 * result, so no two passes ever edit the same square at once.
 *
 *  A. A landing too big for the squares it names. The hand carries a whole
 *     pallet, so dropping it planned 240 units into one square. Re-planned
 *     over the squares it needs at the 30 norm: the row it aims at first,
 *     then the nearest rows, then MAS.
 *  B. A square over the cap because SEVERAL lines share it — neither too big
 *     on its own, which is why looking line by line never saw it (Rafael,
 *     31 Aug 2026: `31-C = 30 + 30`). The smallest ones are sent elsewhere
 *     until the square fits.
 *  C. The space comes first: units parked in MAS while squares are free come
 *     back into them, small lines sharing one.
 *
 * Everything is a ghost in the draft; nothing moves until PLAN COMPLETED.
 */
export function repairOverCap(model: LayoutModel, state: PlannedState, moves: PlanMove[]): Repair {
  const a = bigLandings(model, state, moves);
  if (a.drafts.length > 0) return a;
  const b = sharedSquares(model, state);
  if (b.drafts.length > 0) return b;
  return parkedInMas(model, state, moves);
}

/**
 * One landing, over the squares it needs at the 30 norm: the free squares of
 * the row it aims at first (the row the hand pointed at), then the nearest
 * rows, then MAS. Returns the drafts that replace it — one per row it reaches.
 * The squares it takes leave the pool.
 */
function spreadOne(pool: Map<string, Square>, d: MoveDraft): MoveDraft[] | null {
  const need = squaresFor(d.qty);
  if (d.toLetters.length === 0 || need <= d.toLetters.length) return null;
  const rowNum = rowOf(d.toLocation);
  if (!Number.isFinite(rowNum)) return null;

  const own = [...pool.values()]
    .filter((s) => s.rowNum === rowNum)
    .sort((a, b) => Number(a.isFast) - Number(b.isFast) || a.d - b.d)
    .slice(0, need - d.toLetters.length);
  for (const s of own) pool.delete(s.key);

  const letters = sortLetters([...d.toLetters, ...own.map((s) => s.letter)]);
  const here = Math.min(d.qty, PALLET_UNITS * letters.length);
  let left = d.qty - here;
  const out: MoveDraft[] = [{ ...d, qty: here, toLetters: letters }];
  while (left > 0) {
    const taken = nearestFree(pool, rowNum, squaresFor(left));
    if (taken.length === 0) break;
    for (const s of taken) pool.delete(s.key);
    const units = Math.min(left, PALLET_UNITS * taken.length);
    const toLocation = `ROW ${taken[0].rowNum}`;
    out.push({
      ...d,
      qty: units,
      toLocation,
      toLetters: sortLetters(taken.map((s) => s.letter)),
      kind: sameLocation(d.fromLocation, toLocation) ? 'relabel' : 'move',
    });
    left -= units;
  }
  if (left > 0) {
    out.push({ ...d, qty: left, toLocation: OVERFLOW_LOCATION, toLetters: [], kind: 'move' });
  }
  // Nothing was gained: no square anywhere and no hall split to make.
  if (out.length === 1 && out[0].toLetters.length === d.toLetters.length) return null;
  return out;
}

/**
 * A hand drop settles in one gesture. A pallet that needs more than one
 * square fans out at the drop — the row he pointed at first — because after
 * the drop it is locked, and nothing re-computes it later. That is Tetris's
 * lock delay: while the piece falls it can still be nudged; once it locks it
 * is part of the field.
 */
export function spreadDrop(
  model: LayoutModel,
  state: PlannedState,
  drafts: MoveDraft[]
): MoveDraft[] {
  const pool = freeSquares(model, state);
  // Its own landings are not free floor for the rest of the gesture.
  for (const d of drafts) for (const l of d.toLetters) pool.delete(cellKey(d.toLocation, l));
  return drafts.flatMap((d) => spreadOne(pool, d) ?? [d]);
}

/** Pass A — a landing of the plan's own that needs more squares than it names. */
function bigLandings(model: LayoutModel, state: PlannedState, moves: PlanMove[]): Repair {
  const pool = freeSquares(model, state);
  const drafts: MoveDraft[] = [];
  const removals: number[] = [];

  for (const m of moves) {
    if (m.status !== 'planned' || m.origin !== 'auto') continue;
    const spread = spreadOne(pool, asDraft(m));
    if (!spread) continue;
    removals.push(m.id);
    drafts.push(...spread);
  }

  return { drafts, removals };
}

/**
 * Pass B — a square over the cap because several lines share it. Nobody is
 * too big alone, so the fix is to send the smallest ones somewhere else: a
 * landing is re-aimed, a live line swaps its letter for a free square in its
 * own row, or moves to the nearest free square elsewhere.
 */
function sharedSquares(model: LayoutModel, state: PlannedState): Repair {
  const pool = freeSquares(model, state);
  const drafts: MoveDraft[] = [];
  const removals: number[] = [];

  for (const cell of model.validCells) {
    const key = slotKey(cell);
    let units = state.unitsAt(key);
    if (units <= SQUARE_MAX) continue;
    const rowNum = Number(cell.row.num);
    // The smallest first: the least disruption that brings the square down.
    const here = [...state.occupancy(key)].sort((a, b) => a.qtyHere - b.qtyHere);
    if (here.length < 2) continue; // one line alone is pass A's or DISTRIBUTE's

    for (const o of here) {
      if (units <= SQUARE_MAX) break;
      // A landing the operator made is fixed: the plan works around it.
      if (o.ghost && (o.ghost.origin !== 'auto' || removals.includes(o.ghost.id))) continue;
      // A free square for it: its own row first, so the gesture keeps its place.
      const own = [...pool.values()]
        .filter((s) => s.rowNum === rowNum)
        .sort((a, b) => Number(a.isFast) - Number(b.isFast) || a.d - b.d);
      const target = own[0] ?? nearestFree(pool, rowNum, 1)[0];
      if (!target) break;
      pool.delete(target.key);

      if (o.ghost) {
        // Re-aim the landing: drop the offending square, take the free one.
        const m = o.ghost;
        const rest = m.toLetters.filter((l) => l !== cell.letter);
        removals.push(m.id);
        if (rest.length > 0) {
          drafts.push({ ...asDraft(m), qty: m.qty - o.qtyHere, toLetters: rest });
        }
        const toLocation = `ROW ${target.rowNum}`;
        drafts.push({
          ...asDraft(m),
          qty: o.qtyHere,
          toLocation,
          toLetters: [target.letter],
          kind: sameLocation(m.fromLocation, toLocation) ? 'relabel' : 'move',
        });
      } else {
        // A live line: it swaps this square for the free one.
        const toLocation = `ROW ${target.rowNum}`;
        drafts.push({
          origin: 'auto',
          inventoryId: o.inventoryId,
          sku: o.sku,
          qty: o.qtyHere,
          itemName: o.itemName,
          warehouse: o.warehouse,
          fromLocation: o.location,
          fromSublocation: [cell.letter],
          toLocation,
          toLetters: [target.letter],
          kind: sameLocation(o.location, toLocation) ? 'relabel' : 'move',
        });
      }
      units -= o.qtyHere;
    }
  }

  return { drafts, removals };
}

/** Pass C — units parked in MAS while the drawing still has room. */
function parkedInMas(model: LayoutModel, state: PlannedState, moves: PlanMove[]): Repair {
  const pool = freeSquares(model, state);
  const drafts: MoveDraft[] = [];
  const removals: number[] = [];
  // What is parked in MAS while squares are free comes back into them
  // (Rafael, 31 Aug 2026: "el algoritmo debería priorizar llenar el espacio
  // primero"). Small lines share a square, as DISTRIBUTE does.
  const parked = moves.filter(
    (m) =>
      m.status === 'planned' &&
      m.origin === 'auto' &&
      m.toLetters.length === 0 &&
      sameLocation(m.toLocation, OVERFLOW_LOCATION)
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
  origin: m.origin,
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
