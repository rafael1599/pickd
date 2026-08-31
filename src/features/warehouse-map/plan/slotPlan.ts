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

/**
 * A line in hand. The hand holds ONE SQUARE's pallet, not the whole line: a
 * line spread over squares moves one square at a time (Rafael, 31 Aug 2026:
 * picking the same SKU a second time must not redirect the first move —
 * "que se sepa cuál clickeo y ese sea el cuadro que se deja libre").
 */
export interface Held {
  inventoryId: number;
  sku: string;
  /** Units in hand: the picked square's share, or the whole line off the list. */
  qty: number;
  itemName: string | null;
  warehouse: string;
  /** Live position. */
  location: string;
  sublocation: string[] | null;
  /** The drawn cell its live position is in, or null (no letter, ROW 20B). */
  liveKey: string | null;
  /** The square it was picked from — live or ghost — or null (the unplaced list). */
  fromKey: string | null;
  /** When picked from a ghost: the planned move being redirected. */
  ghostId: number | null;
}

/** Someone in a cell of the planned state: a live line, or a ghost of a planned move. */
export interface Occupant {
  inventoryId: number;
  sku: string;
  qty: number;
  /** The units in THIS square: the line's share here, or the ghost's landing. */
  qtyHere: number;
  itemName: string | null;
  warehouse: string;
  location: string;
  sublocation: string[] | null;
  ghost: PlanMove | null;
  /** The drawn cell of its live position, or null. */
  liveKey: string | null;
  /** The square this occupant entry sits in. */
  atKey: string;
}

/** A planned move as it lands in one square. */
export interface GhostSlot {
  move: PlanMove;
  qtyHere: number;
}

export interface PlannedState {
  /** Planned moves by the square they land in, with the units landing there. */
  ghosts: Map<string, GhostSlot[]>;
  /** Inventory ids whose WHOLE line leaves (full move or relabel). */
  vacated: Set<number>;
  /** Inventory ids with any planned move at all — DISTRIBUTE leaves them alone. */
  hasMove: Set<number>;
  /** Is this line's share gone from this square once the plan runs? */
  gone: (inventoryId: number, letter: string) => boolean;
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
  // `id|letter` — squares a partial move empties (the hand took that square's
  // whole share). A tail smaller than the share (units to the hall) leaves
  // the line where it is.
  const partialGone = new Set<string>();
  for (const m of planned) {
    const shares = allocate(m.qty, m.toLetters.length);
    targetKeys(m).forEach((k, i) => {
      ghosts.set(k, [...(ghosts.get(k) ?? []), { move: m, qtyHere: shares[i] }]);
    });
    if (!isPartial(m, stock)) {
      vacated.add(m.inventoryId);
    } else {
      for (const l of m.fromSublocation ?? []) {
        // A relabel re-letters what it names, so its source squares empty; a
        // partial MOVE empties its square only when it takes the whole share.
        if (m.kind === 'relabel') {
          partialGone.add(`${m.inventoryId}|${l}`);
          continue;
        }
        const entry = stock?.cells
          .get(cellKey(m.fromLocation, l))
          ?.entries.find((e) => e.rowId === m.inventoryId);
        if (entry && m.qty >= entry.qtyHere) partialGone.add(`${m.inventoryId}|${l}`);
      }
    }
  }
  const hasMove = new Set(planned.map((m) => m.inventoryId));
  const gone = (inventoryId: number, letter: string) =>
    vacated.has(inventoryId) || partialGone.has(`${inventoryId}|${letter}`);
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
      if (gone(e.rowId, cell!.letter)) continue;
      out.push({
        inventoryId: e.rowId,
        sku: e.sku,
        qty: e.qty,
        qtyHere: e.qtyHere,
        itemName: e.itemName,
        warehouse: e.warehouse,
        location: locationOfKey(key),
        sublocation: [cell!.letter],
        ghost: null,
        liveKey: key,
        atKey: key,
      });
    }
    for (const g of ghosts.get(key) ?? []) {
      const m = g.move;
      out.push({
        inventoryId: m.inventoryId,
        sku: m.sku,
        qty: m.qty,
        qtyHere: g.qtyHere,
        itemName: m.itemName,
        warehouse: m.warehouse,
        location: m.fromLocation,
        sublocation: m.fromSublocation,
        ghost: m,
        liveKey: liveKeyOf(m.inventoryId),
        atKey: key,
      });
    }
    return out;
  };
  return { ghosts, vacated, hasMove, gone, occupancy, liveKeyOf };
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

export function holdEntry(entry: StockEntry, key: string): Held {
  return {
    inventoryId: entry.rowId,
    sku: entry.sku,
    qty: entry.qtyHere,
    itemName: entry.itemName,
    warehouse: entry.warehouse,
    location: locationOfKey(key),
    sublocation: [letterOfKey(key)],
    liveKey: key,
    fromKey: key,
    ghostId: null,
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
    fromKey: null,
    ghostId: null,
  };
}

export function holdOccupant(o: Occupant): Held {
  return {
    inventoryId: o.inventoryId,
    sku: o.sku,
    // A live pick takes the square's share; a ghost pick takes its whole move.
    qty: o.ghost ? o.qty : o.qtyHere,
    itemName: o.itemName,
    warehouse: o.warehouse,
    location: o.location,
    sublocation: o.sublocation,
    liveKey: o.liveKey,
    fromKey: o.atKey,
    ghostId: o.ghost?.id ?? null,
  };
}

export interface DropTarget {
  rowNum: string;
  letter: string;
}

export type DropResult =
  | { rule: 'move' | 'swap' | 'join'; drafts: MoveDraft[]; removals: number[] }
  | { rule: 'noop'; reason: string };

function draftFor(line: Held | Occupant, to: DropTarget, qty: number): MoveDraft {
  const toLocation = `ROW ${to.rowNum}`;
  return {
    inventoryId: line.inventoryId,
    sku: line.sku,
    qty,
    itemName: line.itemName,
    warehouse: line.warehouse,
    fromLocation: line.location,
    fromSublocation: line.sublocation,
    toLocation,
    toLetters: [to.letter],
    kind: sameLocation(line.location, toLocation) ? 'relabel' : 'move',
  };
}

/** The square a planned move was picked from, if it names one. */
const sourceKeyOf = (m: PlanMove): string | null =>
  m.fromSublocation?.length ? cellKey(m.fromLocation, m.fromSublocation[0]) : null;

/**
 * The four rules. Empty → the pallet goes there. One line → they swap (the
 * occupant takes the square the hand freed). Several → the pallet joins
 * them. A pallet sent back to where it came from loses its move instead of
 * gaining one. The hand carries ONE SQUARE's pallet and, when it re-picks a
 * ghost, that ghost's move id — so a second move of the same SKU never
 * redirects the first (Rafael, 31 Aug 2026).
 */
export function planDrop(
  held: Held,
  to: DropTarget,
  state: PlannedState,
  moves: PlanMove[]
): DropResult {
  const key = `${to.rowNum}-${to.letter}`;
  const origin = held.fromKey;
  if (key === origin) return { rule: 'noop', reason: 'already there' };

  const drafts: MoveDraft[] = [];
  const removals: number[] = [];
  const heldMove =
    held.ghostId === null
      ? null
      : (moves.find((m) => m.id === held.ghostId && m.status === 'planned') ?? null);

  const send = (
    line: Held | Occupant,
    target: DropTarget,
    existing: PlanMove | null,
    qty: number
  ) => {
    const tKey = `${target.rowNum}-${target.letter}`;
    if (existing) {
      // Redirecting a ghost: its move goes; back to its own source square or
      // its live home, nothing replaces it.
      removals.push(existing.id);
      if (tKey === sourceKeyOf(existing) || tKey === line.liveKey) return;
    } else if (tKey === line.liveKey) {
      return;
    }
    drafts.push(draftFor(line, target, qty));
  };

  send(held, to, heldMove, held.qty);

  const occupants = state.occupancy(key).filter((o) => o.inventoryId !== held.inventoryId);
  if (occupants.length === 0) return { rule: 'move', drafts, removals };
  if (occupants.length === 1 && origin !== null) {
    const o = occupants[0];
    send(
      o,
      { rowNum: origin.slice(0, origin.lastIndexOf('-')), letter: letterOfKey(origin) },
      o.ghost,
      o.ghost ? o.qty : o.qtyHere
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

/**
 * `ROW 33 A → ROW 33 C·D·E` — the move as the sheet lists it. A destination
 * with no letters (`MAIN HALL`, a place the drawing has no squares for) is
 * named alone.
 */
export function describeMove(m: {
  fromLocation: string;
  fromSublocation: string[] | null;
  toLocation: string;
  toLetters: string[];
}): string {
  const from = `${norm(m.fromLocation)}${m.fromSublocation?.length ? ' ' + m.fromSublocation.join('') : ''}`;
  const to = `${norm(m.toLocation)}${m.toLetters.length ? ' ' + m.toLetters.join('·') : ''}`;
  return `${from} → ${to}`;
}
