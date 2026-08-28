// DISTRIBUTE: a square holds one double-stacked pallet, 30 units, no more
// (Rafael, 28 Aug 2026: "reparte, los que no caben en las locations actuales
// ponlas en el espacio disponible buried"). For every line in the zone with
// more units than its squares hold, plan the squares it needs: first the
// free squares of its own row (a relabel to a wider span), then, for what
// still does not fit, free buried squares in the nearest rows (a move of just
// those units). Fast squares are for picking; overflow goes buried.

import type { LayoutModel } from '../engine';
import { slotKey } from '../engine';
import { PALLET_UNITS, squaresFor, type ZoneStock } from '../stock/rowStock';
import { letterOfKey, locationOfKey, type MoveDraft, type PlannedState } from './slotPlan';

export interface Leftover {
  sku: string;
  location: string;
  /** Units that found no free buried square. */
  qty: number;
}

export interface Distribution {
  drafts: MoveDraft[];
  leftovers: Leftover[];
  /** Lines that already fit and were left alone. */
  untouched: number;
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
  letters: string[];
}

export function distribute(
  stock: ZoneStock,
  model: LayoutModel,
  state: PlannedState
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

  // Each line once, with the squares it lives in.
  const lines = new Map<number, Line>();
  for (const cell of stock.cells.values()) {
    for (const e of cell.entries) {
      if (state.vacated.has(e.rowId)) continue;
      const line = lines.get(e.rowId) ?? {
        inventoryId: e.rowId,
        sku: e.sku,
        qty: e.qty,
        itemName: e.itemName,
        warehouse: e.warehouse,
        location: locationOfKey(cell.key),
        rowNum: cell.rowNumber,
        letters: [],
      };
      line.letters.push(cell.letter);
      lines.set(e.rowId, line);
    }
  }

  const drafts: MoveDraft[] = [];
  const leftovers: Leftover[] = [];
  let untouched = 0;
  const take = (sq: Square) => squares.delete(sq.key);

  // Biggest lines first: they have the fewest places to go.
  const ordered = [...lines.values()].sort((a, b) => b.qty - a.qty);
  for (const line of ordered) {
    const need = squaresFor(line.qty);
    if (need <= line.letters.length) {
      untouched++;
      continue;
    }
    let missing = need - line.letters.length;

    // 1. Its own row: the free squares deeper than its last letter first, then any.
    const lastD = Math.max(
      ...line.letters.map(
        (l) => model.validCells.find((c) => slotKey(c) === `${line.rowNum}-${l}`)?.d ?? -1
      )
    );
    const ownRow = [...squares.values()]
      .filter((s) => s.rowNum === line.rowNum)
      .sort((a, b) => Number(a.d <= lastD) - Number(b.d <= lastD) || a.d - b.d);
    const extended: string[] = [];
    for (const sq of ownRow) {
      if (missing === 0) break;
      extended.push(sq.letter);
      take(sq);
      missing--;
    }
    const span = [...line.letters, ...extended];
    if (extended.length > 0) {
      drafts.push({
        inventoryId: line.inventoryId,
        sku: line.sku,
        qty: line.qty,
        itemName: line.itemName,
        warehouse: line.warehouse,
        fromLocation: line.location,
        fromSublocation: line.letters,
        toLocation: line.location,
        toLetters: sortLetters(span),
        kind: 'relabel',
      });
    }
    if (missing === 0) continue;

    // 2. What still does not fit goes to free buried squares, nearest rows first,
    //    as many together in one row as that row can give.
    let overflow = line.qty - PALLET_UNITS * span.length;
    while (overflow > 0) {
      const buried = [...squares.values()].filter((s) => !s.isFast);
      if (buried.length === 0) break;
      const byRow = new Map<number, Square[]>();
      for (const s of buried) byRow.set(s.rowNum, [...(byRow.get(s.rowNum) ?? []), s]);
      const rows = [...byRow.keys()].sort(
        (a, b) => Math.abs(a - line.rowNum) - Math.abs(b - line.rowNum) || a - b
      );
      const rowNum = rows[0];
      const here = byRow.get(rowNum)!.sort((a, b) => a.d - b.d);
      const wanted = squaresFor(overflow);
      const taken = here.slice(0, wanted);
      for (const sq of taken) take(sq);
      const units = Math.min(overflow, PALLET_UNITS * taken.length);
      drafts.push({
        inventoryId: line.inventoryId,
        sku: line.sku,
        qty: units,
        itemName: line.itemName,
        warehouse: line.warehouse,
        fromLocation: line.location,
        fromSublocation: line.letters,
        toLocation: `ROW ${rowNum}`,
        toLetters: sortLetters(taken.map((s) => s.letter)),
        kind: 'move',
      });
      overflow -= units;
    }
    if (overflow > 0) leftovers.push({ sku: line.sku, location: line.location, qty: overflow });
  }

  return { drafts, leftovers, untouched };
}

const sortLetters = (letters: string[]) => [...new Set(letters)].sort();

export { letterOfKey };
