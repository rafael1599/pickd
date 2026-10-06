/**
 * Editing a row's boxes from the Stock card (idea-253, part A). Every change
 * waits until SAVE, like the item card; this is the pure half — the edits, what
 * changed per square, and whether the boxes match the quantity.
 */
import type { DistributionItem } from '../../../schemas/inventory.schema';
import { boxesTotal, byShowOrder, groupUnits, squaredGroups } from '../../../utils/boxSquares';

/** A square's units before and after. `square` is '' outside a ROW. */
export interface SquareChange {
  square: string;
  before: number;
  after: number;
}

/** The hard top of a square (warehouse-map: 30 is the norm, 45 the cap). */
export const SQUARE_CAP = 45;

const totals = (groups: readonly DistributionItem[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const d of groups) out.set(d.square ?? '', (out.get(d.square ?? '') ?? 0) + groupUnits(d));
  return out;
};

/**
 * What the banner says: each square whose units changed, A→Z. When the units
 * stay but the boxes changed (2×15 → 1×30), the square is listed too — it is a
 * change to save, even if the number reads the same.
 */
export function squareChanges(
  base: readonly DistributionItem[],
  cur: readonly DistributionItem[]
): SquareChange[] {
  const b = totals(base);
  const c = totals(cur);
  const sig = (groups: readonly DistributionItem[], sq: string) =>
    groups
      .filter((d) => (d.square ?? '') === sq)
      .map((d) => `${d.type}:${d.count}:${d.units_each}`)
      .sort()
      .join('|');
  const out: SquareChange[] = [];
  for (const sq of [...new Set([...b.keys(), ...c.keys()])].sort()) {
    const before = b.get(sq) ?? 0;
    const after = c.get(sq) ?? 0;
    if (before !== after || sig(base, sq) !== sig(cur, sq)) out.push({ square: sq, before, after });
  }
  return out;
}

/** Quantity minus boxes: `+7` = 7 loose units, `−7` = boxes for 7 that are not there. */
export const boxesMismatch = (
  distribution: readonly DistributionItem[] | null | undefined,
  quantity: number
): number => quantity - boxesTotal(distribution);

/** `+7 loose` / `−7 extra`, or null when they match. */
export function mismatchLabel(diff: number): string | null {
  if (diff > 0) return `+${diff} loose`;
  if (diff < 0) return `−${-diff} extra`;
  return null;
}

/** Squares over the cap after the edit: `B 137 > 45`. */
export const overCap = (groups: readonly DistributionItem[]): SquareChange[] =>
  [...totals(groups)]
    .filter(([sq, n]) => sq && n > SQUARE_CAP)
    .map(([square, n]) => ({ square, before: n, after: n }));

/** Count or units each of one group. A count of 0 removes the group. */
export function setGroupNumber(
  groups: readonly DistributionItem[],
  index: number,
  field: 'count' | 'units_each',
  value: number
): DistributionItem[] {
  const v = Math.max(0, Math.trunc(value));
  if (field === 'count' && v === 0) return groups.filter((_, i) => i !== index);
  if (v === 0) return [...groups];
  return groups.map((d, i) => (i === index ? { ...d, [field]: v } : d));
}

/** The whole group to another square. */
export const moveGroup = (
  groups: readonly DistributionItem[],
  index: number,
  square: string
): DistributionItem[] => groups.map((d, i) => (i === index ? { ...d, square } : d));

/**
 * One box out of a group of several, in the same square, to be moved next
 * (2×30 in F → 1×30 + 1×30). Returns the new list and the index of the box
 * that came out.
 */
export function splitGroup(
  groups: readonly DistributionItem[],
  index: number
): { groups: DistributionItem[]; index: number } {
  const g = groups[index];
  if (!g || g.count < 2) return { groups: [...groups], index };
  const next = groups.map((d, i) => (i === index ? { ...d, count: d.count - 1 } : d));
  next.push({ ...g, count: 1 });
  return { groups: next, index: next.length - 1 };
}

export const addGroup = (
  groups: readonly DistributionItem[],
  group: DistributionItem
): DistributionItem[] => [...groups, group];

/**
 * What a save writes: equal groups merged, in show order, and the row's
 * letters = the squares that have boxes. Squares that end up empty leave the
 * row (the trigger does the same on the server).
 */
export function boxesToSave(
  groups: readonly DistributionItem[],
  sublocation: readonly string[] | null | undefined
): { distribution: DistributionItem[]; sublocation: string[] | null } {
  const merged = squaredGroups(groups, sublocation);
  const squares = [...new Set(merged.map((d) => d.square).filter(Boolean) as string[])].sort();
  return {
    distribution: merged.sort(byShowOrder),
    sublocation: squares.length ? squares : sublocation?.length ? [...sublocation] : null,
  };
}
