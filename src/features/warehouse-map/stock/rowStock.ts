// What the database says is in each drawn slot. A slot is `ROW n · letter`;
// `inventory.location` is `ROW n` and `inventory.sublocation` holds the
// letters — so the join is a name, not a lookup. Whatever the drawing has no
// place for (a letter the row is not deep enough for, `ROW 20B`, a line with
// no letter) is listed beside the row, never squeezed into a slot and never
// hidden: hiding it would make the map lie (PRD Q5, Rafael 28 Aug 2026).

import type { LayoutModel, ZoneConfig } from '../engine';

export interface StockRow {
  id: number;
  sku: string;
  itemName: string | null;
  location: string;
  warehouse: string;
  sublocation: string[] | null;
  quantity: number;
}

export interface ParsedRowLocation {
  /** The row number, or null for a `ROW` location with no number (`ROW X EP`). */
  number: number | null;
  /** Whatever follows the number: `B` in `ROW 20B`, `BURIED` in `ROW 42 BURIED`. */
  suffix: string;
}

const ROW_RE = /^ROW\s*(\d+)?\s*(.*)$/;

/** `ROW 33` → 33 · `row 20b` → 20 + `B` · `ROW X EP` → no number. Not a ROW → null. */
export function parseRowLocation(location: string | null | undefined): ParsedRowLocation | null {
  const text = (location ?? '').trim().toUpperCase();
  const m = ROW_RE.exec(text);
  if (!m) return null;
  const number = m[1] !== undefined ? parseInt(m[1], 10) : null;
  const suffix = m[2].trim();
  if (number === null && suffix === '') return null;
  return { number, suffix };
}

/** The DB row numbers a zone answers for: its `rowRange`, both ends inclusive. */
export function zoneOwnsRow(config: ZoneConfig, rowNumber: number): boolean {
  const r = config.rowRange;
  if (!r || r.unnamed) return false;
  return rowNumber >= Math.min(r.start, r.end) && rowNumber <= Math.max(r.start, r.end);
}

/** A square holds one double-stacked pallet: 30 units, no more (Rafael, 28 Aug 2026). */
export const PALLET_UNITS = 30;

/** Squares a quantity needs at PALLET_UNITS per square. */
export const squaresFor = (qty: number) => Math.max(1, Math.ceil(qty / PALLET_UNITS));

/**
 * How a line's units sit across its squares: a pallet's worth in each,
 * whatever is left in the last one — which is where a line that has too
 * few squares shows it, as a square over capacity.
 */
export function allocate(qty: number, squares: number): number[] {
  const out: number[] = [];
  let left = qty;
  for (let i = 0; i < squares; i++) {
    const here = i < squares - 1 ? Math.min(left, PALLET_UNITS) : left;
    out.push(here);
    left -= here;
  }
  return out;
}

export interface StockEntry {
  sku: string;
  /** The line's whole quantity. */
  qty: number;
  /** The part of it that sits in this square. */
  qtyHere: number;
  itemName: string | null;
  rowId: number;
  warehouse: string;
  /** How many squares the line spans. */
  span: number;
}

export interface CellStock {
  key: string;
  rowNumber: number;
  letter: string;
  entries: StockEntry[];
  /** Units in this square — each line's share of it, not its whole quantity. */
  units: number;
}

export type UnplacedReason =
  /** The row is in the zone but the drawing has no slot with that letter. */
  | 'letter'
  /** `ROW 20B`, `ROW 42 BURIED`: a place next to a row, not a slot of it. */
  | 'suffix'
  /** A line in the row with no sublocation letter. */
  | 'no-letter'
  /** The row number is the zone's but this layout does not draw that row. */
  | 'row';

export interface Unplaced {
  reason: UnplacedReason;
  row: StockRow;
  parsed: ParsedRowLocation;
  /** The letters that had no slot (for `letter`), else empty. */
  letters: string[];
}

export interface ZoneStock {
  cells: Map<string, CellStock>;
  unplaced: Unplaced[];
  /** Every line the zone answers for, drawn or not. */
  lines: number;
  units: number;
  /** Distinct `location` strings among them. */
  rows: number;
}

const NOTHING: ZoneStock = { cells: new Map(), unplaced: [], lines: 0, units: 0, rows: 0 };

/** The lines a zone answers for — rows in its range, with or without a suffix. */
export function zoneRows(config: ZoneConfig, rows: StockRow[]): StockRow[] {
  return rows.filter((r) => {
    const p = parseRowLocation(r.location);
    return p !== null && p.number !== null && zoneOwnsRow(config, p.number);
  });
}

/** Lines in a `ROW` location no zone answers for — `ROW X EP` has no number. */
export function outsideAnyPlan(configs: ZoneConfig[], rows: StockRow[]): StockRow[] {
  return rows.filter((r) => {
    const p = parseRowLocation(r.location);
    if (p === null) return false;
    if (p.number === null) return true;
    return !configs.some((c) => zoneOwnsRow(c, p.number!));
  });
}

/**
 * Lays the zone's lines over the layout. `model` may be null (nothing fits):
 * then every line is unplaced, which is the truth of that layout.
 */
export function zoneStock(
  config: ZoneConfig,
  model: LayoutModel | null,
  rows: StockRow[]
): ZoneStock {
  const own = zoneRows(config, rows);
  if (own.length === 0) return NOTHING;

  const drawnRows = new Set<string>();
  const drawnKeys = new Set<string>();
  if (model) {
    for (const cell of [...model.validCells, ...model.lost]) {
      drawnRows.add(cell.row.num);
      drawnKeys.add(`${cell.row.num}-${cell.letter}`);
    }
  }

  const cells = new Map<string, CellStock>();
  const unplaced: Unplaced[] = [];
  let units = 0;
  const locations = new Set<string>();

  for (const row of own) {
    const parsed = parseRowLocation(row.location)!;
    const n = parsed.number!;
    units += row.quantity;
    locations.add(row.location.trim().toUpperCase());

    if (parsed.suffix !== '') {
      unplaced.push({ reason: 'suffix', row, parsed, letters: [] });
      continue;
    }
    if (!drawnRows.has(String(n))) {
      unplaced.push({ reason: 'row', row, parsed, letters: [] });
      continue;
    }
    const letters = (row.sublocation ?? []).map((l) => l.trim().toUpperCase()).filter(Boolean);
    if (letters.length === 0) {
      unplaced.push({ reason: 'no-letter', row, parsed, letters: [] });
      continue;
    }
    const missing = letters.filter((letter) => !drawnKeys.has(`${n}-${letter}`));
    const drawn = letters.filter((letter) => drawnKeys.has(`${n}-${letter}`));
    const shares = allocate(row.quantity, drawn.length);
    drawn.forEach((letter, i) => {
      const key = `${n}-${letter}`;
      const cell = cells.get(key) ?? { key, rowNumber: n, letter, entries: [], units: 0 };
      cell.entries.push({
        sku: row.sku,
        qty: row.quantity,
        qtyHere: shares[i],
        itemName: row.itemName,
        rowId: row.id,
        warehouse: row.warehouse,
        span: drawn.length,
      });
      cell.units += shares[i];
      cells.set(key, cell);
    });
    if (missing.length > 0) unplaced.push({ reason: 'letter', row, parsed, letters: missing });
  }

  for (const cell of cells.values()) cell.entries.sort((a, b) => b.qtyHere - a.qtyHere);
  unplaced.sort(
    (a, b) =>
      a.parsed.number! - b.parsed.number! ||
      a.row.location.localeCompare(b.row.location) ||
      b.row.quantity - a.row.quantity
  );

  return { cells, unplaced, lines: own.length, units, rows: locations.size };
}

/** One line for the tooltip: `ROW 33 · A · 03-4085BK 41u · 03-3931BK 30 of 132u (5 squares)`. */
export function describeCell(cell: CellStock): string {
  const parts = cell.entries.map((e) =>
    e.span > 1 ? `${e.sku} ${e.qtyHere} of ${e.qty}u (${e.span} squares)` : `${e.sku} ${e.qty}u`
  );
  const over = cell.units > PALLET_UNITS ? ` · OVER CAPACITY (${PALLET_UNITS} per square)` : '';
  return `ROW ${cell.rowNumber} · ${cell.letter} · ${parts.join(' · ')}${over}`;
}

export interface UnplacedGroup {
  location: string;
  reason: UnplacedReason;
  items: Unplaced[];
  units: number;
}

/**
 * The unplaced lines by row and reason, in the row order they came in. Fifty
 * one-unit lines in ROW 33 with no letter are one fact, not fifty rows.
 */
export function groupUnplaced(unplaced: Unplaced[]): UnplacedGroup[] {
  const groups: UnplacedGroup[] = [];
  const byKey = new Map<string, UnplacedGroup>();
  for (const u of unplaced) {
    const location = u.row.location.trim().toUpperCase();
    const key = `${location}|${u.reason}`;
    let g = byKey.get(key);
    if (!g) {
      g = { location, reason: u.reason, items: [], units: 0 };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(u);
    g.units += u.row.quantity;
  }
  return groups;
}
