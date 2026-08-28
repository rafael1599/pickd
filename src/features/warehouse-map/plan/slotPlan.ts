// A plan is a list of moves over live stock. This file is the rules, pure:
// what a drop does (move / swap / join), what the planned state of a zone
// looks like (ghosts on targets, origins vacated), and whether a move still
// applies when it is about to be executed. Nothing here touches the DB.
//
// A move sends a line to one or more squares (`toLetters`): one when a hand
// puts it down, several when DISTRIBUTE spreads it at a pallet per square.
// PRD docs/prds/warehouse-map-plan-and-live.md, "ok todo" 2026-08-28.

import {
  allocate,
  parseRowLocation,
  type StockEntry,
  type StockRow,
  type ZoneStock,
} from '../stock/rowStock';

export type MoveKind = 'relabel' | 'move';
export type MoveStatus = 'planned' | 'done' | 'skipped' | 'failed';

export interface PlanMove {
  id: number;
  planId: string;
  position: number;
  inventoryId: number;
  sku: string;
  /** Units this move takes: the whole line by hand, part of it when spread. */
  qty: number;
  itemName: string | null;
  warehouse: string;
  /** Where the line lived when it was planned — execution checks it is still there. */
  fromLocation: string;
  fromSublocation: string[] | null;
  toLocation: string;
  toLetters: string[];
  kind: MoveKind;
  status: MoveStatus;
  error: string | null;
}

export type MoveDraft = Omit<PlanMove, 'id' | 'planId' | 'position' | 'status' | 'error'>;

/** A line in hand: picked from a slot, from a ghost, or from the unplaced list. */
export interface Held {
  inventoryId: number;
  sku: string;
  qty: number;
  itemName: string | null;
  warehouse: string;
  /** Live position. */
  location: string;
  sublocation: string[] | null;
  /** The drawn cell its live position is in, or null (letter K, no letter, ROW 20B). */
  liveKey: string | null;
}

/** Someone in a cell of the planned state: a live line, or a ghost of a planned move. */
export interface Occupant {
  inventoryId: number;
  sku: string;
  qty: number;
  itemName: string | null;
  warehouse: string;
  location: string;
  sublocation: string[] | null;
  ghost: PlanMove | null;
  /** The drawn cell of its live position, or null. */
  liveKey: string | null;
}

/** A planned move as it lands in one square. */
export interface GhostSlot {
  move: PlanMove;
  qtyHere: number;
}

export interface PlannedState {
  /** Planned moves by the square they land in, with the units landing there. */
  ghosts: Map<string, GhostSlot[]>;
  /** Inventory ids with a planned move: their live cell shows them leaving. */
  vacated: Set<number>;
  /** Who is in a cell once the plan is applied. */
  occupancy: (key: string) => Occupant[];
  /** The drawn cell a line lives in today, or null. */
  liveKeyOf: (inventoryId: number) => string | null;
}

const norm = (s: string) => s.trim().toUpperCase();
export const sameLocation = (a: string, b: string) => norm(a) === norm(b);

/** `ROW 33` + `C` → `33-C`, the key the drawing uses. */
export function cellKey(location: string, letter: string): string {
  const p = parseRowLocation(location);
  return `${p?.number ?? '?'}-${letter}`;
}

/** Every square a move lands in. */
export function targetKeys(m: { toLocation: string; toLetters: string[] }): string[] {
  return m.toLetters.map((l) => cellKey(m.toLocation, l));
}

/** `33-C` → `ROW 33`. */
export function locationOfKey(key: string): string {
  return `ROW ${key.slice(0, key.lastIndexOf('-'))}`;
}

export function letterOfKey(key: string): string {
  return key.slice(key.lastIndexOf('-') + 1);
}

export function plannedState(stock: ZoneStock | null, moves: PlanMove[]): PlannedState {
  const planned = moves.filter((m) => m.status === 'planned');
  const ghosts = new Map<string, GhostSlot[]>();
  const vacated = new Set<number>();
  for (const m of planned) {
    const shares = allocate(m.qty, m.toLetters.length);
    targetKeys(m).forEach((k, i) => {
      ghosts.set(k, [...(ghosts.get(k) ?? []), { move: m, qtyHere: shares[i] }]);
    });
    // A partial move leaves the rest of the line where it is.
    if (m.kind === 'relabel' || !isPartial(m, stock)) vacated.add(m.inventoryId);
  }
  const liveKeys = new Map<number, string>();
  if (stock) {
    for (const [key, cell] of stock.cells) {
      for (const e of cell.entries) if (!liveKeys.has(e.rowId)) liveKeys.set(e.rowId, key);
    }
  }
  const liveKeyOf = (id: number) => liveKeys.get(id) ?? null;
  const occupancy = (key: string): Occupant[] => {
    const out: Occupant[] = [];
    const cell = stock?.cells.get(key);
    for (const e of cell?.entries ?? []) {
      if (vacated.has(e.rowId)) continue;
      out.push({
        inventoryId: e.rowId,
        sku: e.sku,
        qty: e.qty,
        itemName: e.itemName,
        warehouse: e.warehouse,
        location: locationOfKey(key),
        sublocation: [cell!.letter],
        ghost: null,
        liveKey: key,
      });
    }
    for (const g of ghosts.get(key) ?? []) {
      const m = g.move;
      out.push({
        inventoryId: m.inventoryId,
        sku: m.sku,
        qty: m.qty,
        itemName: m.itemName,
        warehouse: m.warehouse,
        location: m.fromLocation,
        sublocation: m.fromSublocation,
        ghost: m,
        liveKey: liveKeyOf(m.inventoryId),
      });
    }
    return out;
  };
  return { ghosts, vacated, occupancy, liveKeyOf };
}

/** A move that takes fewer units than the line has. */
function isPartial(m: PlanMove, stock: ZoneStock | null): boolean {
  if (!stock) return false;
  for (const cell of stock.cells.values()) {
    const e = cell.entries.find((x) => x.rowId === m.inventoryId);
    if (e) return m.qty < e.qty;
  }
  return false;
}

export function holdEntry(entry: StockEntry, cellKey: string): Held {
  return {
    inventoryId: entry.rowId,
    sku: entry.sku,
    qty: entry.qty,
    itemName: entry.itemName,
    warehouse: entry.warehouse,
    location: locationOfKey(cellKey),
    sublocation: null,
    liveKey: cellKey,
  };
}

export function holdRow(row: StockRow): Held {
  return {
    inventoryId: row.id,
    sku: row.sku,
    qty: row.quantity,
    itemName: row.itemName,
    warehouse: row.warehouse,
    location: row.location,
    sublocation: row.sublocation,
    liveKey: null,
  };
}

export function holdOccupant(o: Occupant): Held {
  return {
    inventoryId: o.inventoryId,
    sku: o.sku,
    qty: o.qty,
    itemName: o.itemName,
    warehouse: o.warehouse,
    location: o.location,
    sublocation: o.sublocation,
    liveKey: o.liveKey,
  };
}

/** Where a line sits in the planned state: its ghost's first square if planned, else its live cell. */
export function plannedPosition(inventoryId: number, liveKey: string | null, moves: PlanMove[]) {
  const m = moves.find((x) => x.inventoryId === inventoryId && x.status === 'planned');
  return m ? targetKeys(m)[0] : liveKey;
}

export interface DropTarget {
  rowNum: string;
  letter: string;
}

export type DropResult =
  | { rule: 'move' | 'swap' | 'join'; drafts: MoveDraft[]; removals: number[] }
  | { rule: 'noop'; reason: string };

function draftFor(line: Held | Occupant, to: DropTarget): MoveDraft {
  const toLocation = `ROW ${to.rowNum}`;
  return {
    inventoryId: line.inventoryId,
    sku: line.sku,
    qty: line.qty,
    itemName: line.itemName,
    warehouse: line.warehouse,
    fromLocation: line.location,
    fromSublocation: line.sublocation,
    toLocation,
    toLetters: [to.letter],
    kind: sameLocation(line.location, toLocation) ? 'relabel' : 'move',
  };
}

/**
 * The four rules. Empty → the line goes there. One line → they swap (the
 * occupant takes the held line's planned square). Several → the line joins
 * them. A line sent back to where it lives loses its move instead of
 * gaining one.
 */
export function planDrop(
  held: Held,
  to: DropTarget,
  state: PlannedState,
  moves: PlanMove[]
): DropResult {
  const key = `${to.rowNum}-${to.letter}`;
  const origin = plannedPosition(held.inventoryId, held.liveKey, moves);
  if (key === origin) return { rule: 'noop', reason: 'already there' };

  const drafts: MoveDraft[] = [];
  const removals: number[] = [];
  const heldMove = moves.find((m) => m.inventoryId === held.inventoryId && m.status === 'planned');

  const send = (line: Held | Occupant, target: DropTarget, existing: PlanMove | null) => {
    const tKey = `${target.rowNum}-${target.letter}`;
    if (line.liveKey === tKey) {
      // Back home: the planned move is undone, nothing new is planned.
      if (existing) removals.push(existing.id);
      return;
    }
    drafts.push(draftFor(line, target));
  };

  send(held, to, heldMove ?? null);

  const occupants = state.occupancy(key).filter((o) => o.inventoryId !== held.inventoryId);
  if (occupants.length === 0) return { rule: 'move', drafts, removals };
  if (occupants.length === 1 && origin !== null) {
    const o = occupants[0];
    send(
      o,
      { rowNum: origin.slice(0, origin.lastIndexOf('-')), letter: letterOfKey(origin) },
      o.ghost
    );
    return { rule: 'swap', drafts, removals };
  }
  return { rule: 'join', drafts, removals };
}

/** The inventory row as it is right now — the fields the check needs, as the schema types them. */
export interface FreshLine {
  id: number;
  is_active?: boolean | null;
  quantity?: number | null;
  location?: string | null;
  sublocation?: string[] | null;
}

export type Validation = { ok: true } | { ok: false; reason: string };

/** Does a planned move still apply to the line as it is right now? */
export function validateMove(move: PlanMove, fresh: FreshLine | null): Validation {
  if (!fresh || fresh.is_active === false || (fresh.quantity ?? 0) <= 0) {
    return { ok: false, reason: 'line no longer in stock' };
  }
  if (!sameLocation(fresh.location ?? '', move.fromLocation)) {
    return { ok: false, reason: `line no longer in ${norm(move.fromLocation)}` };
  }
  if (move.kind === 'move' && (fresh.quantity ?? 0) < move.qty) {
    return { ok: false, reason: `changed since planned · ${fresh.quantity} u left` };
  }
  if (
    move.kind === 'relabel' &&
    fresh.sublocation &&
    fresh.sublocation.length === move.toLetters.length &&
    fresh.sublocation.every((l, i) => l === move.toLetters[i])
  ) {
    return { ok: false, reason: 'already there' };
  }
  return { ok: true };
}

export function summarizeMoves(moves: PlanMove[]) {
  const planned = moves.filter((m) => m.status === 'planned');
  const rows = new Set(planned.flatMap((m) => [norm(m.fromLocation), norm(m.toLocation)]));
  return {
    count: planned.length,
    units: planned.reduce((s, m) => s + m.qty, 0),
    rows: rows.size,
  };
}

/** `ROW 33 A → ROW 33 C·D·E` — the move as the sheet lists it. */
export function describeMove(m: {
  fromLocation: string;
  fromSublocation: string[] | null;
  toLocation: string;
  toLetters: string[];
}): string {
  const from = `${norm(m.fromLocation)}${m.fromSublocation?.length ? ' ' + m.fromSublocation.join('') : ''}`;
  return `${from} → ${norm(m.toLocation)} ${m.toLetters.join('·')}`;
}
