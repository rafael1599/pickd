/**
 * Boxes per square (idea-253, docs/prds/stock-card-edit-and-pick-square.md).
 *
 * Each group of `inventory.distribution` may say which square of its ROW it
 * stands in (`square: 'F'`). A square's units are the sum of its groups — the
 * one source; `sublocation` follows from them (trigger
 * `keep_inventory_squares`). This file is the pure half every screen shares:
 * the Stock card, the map and Double Check read squares through it.
 */
import type { DistributionItem } from '../schemas/inventory.schema';

// A DS reads base then top; then line pallets, then a kids bike's towers and lines.
const TYPE_RANK: Record<string, number> = {
  BASE: 0,
  TOP: 1,
  LINE_PALLET: 2,
  TOWER: 3,
  LINE: 4,
};

const isLetter = (l: unknown): l is string => typeof l === 'string' && /^[A-Z]$/.test(l);

/** Count × units each, as whole numbers; 0 for a malformed group. */
export const groupUnits = (d: DistributionItem): number => {
  const count = Math.trunc(Number(d.count) || 0);
  const each = Math.trunc(Number(d.units_each) || 0);
  return count > 0 && each > 0 ? count * each : 0;
};

/** Units the boxes add up to. */
export const boxesTotal = (distribution: readonly DistributionItem[] | null | undefined): number =>
  (distribution ?? []).reduce((sum, d) => sum + groupUnits(d), 0);

/**
 * Units per square, when every group says its square; `null` while any group
 * does not (a row nobody has split yet — callers fall back to their old even
 * share).
 */
export function unitsPerSquare(
  distribution: readonly DistributionItem[] | null | undefined
): Map<string, number> | null {
  const groups = (distribution ?? []).filter((d) => groupUnits(d) > 0);
  if (groups.length === 0 || !groups.every((d) => isLetter(d.square))) return null;
  const out = new Map<string, number>();
  for (const d of groups) out.set(d.square!, (out.get(d.square!) ?? 0) + groupUnits(d));
  return out;
}

/**
 * The groups as the card shows and edits them: malformed ones dropped, equal
 * ones (same square, type and units each) merged, and — in a ROW — every group
 * in a square. A group without one goes to the row's first square (the study:
 * «al primer toque todos los grupos se ponen en el primer cuadro»). Outside a
 * ROW (no letters) groups carry no square.
 */
export function squaredGroups(
  distribution: readonly DistributionItem[] | null | undefined,
  sublocation: readonly string[] | null | undefined
): DistributionItem[] {
  const letters = [...(sublocation ?? [])].filter(isLetter).sort();
  const first = letters[0];
  const byKey = new Map<string, DistributionItem>();
  for (const d of distribution ?? []) {
    if (groupUnits(d) === 0) continue;
    const square = first ? (isLetter(d.square) ? d.square : first) : undefined;
    const count = Math.trunc(Number(d.count));
    const unitsEach = Math.trunc(Number(d.units_each));
    const key = `${square ?? ''}:${d.type}:${unitsEach}`;
    const prev = byKey.get(key);
    const next: DistributionItem = {
      type: d.type,
      count: (prev?.count ?? 0) + count,
      units_each: unitsEach,
    };
    if (d.label ?? prev?.label) next.label = (prev?.label ?? d.label) as string;
    if (square) next.square = square;
    byKey.set(key, next);
  }
  return [...byKey.values()].sort(byShowOrder);
}

/** Square A→Z, then towers, pallets, lines, then the biggest first. */
export function byShowOrder(a: DistributionItem, b: DistributionItem): number {
  return (
    (a.square ?? '').localeCompare(b.square ?? '') ||
    (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) ||
    b.units_each - a.units_each
  );
}

/** The distinct squares the groups stand in, A→Z. */
export const squaresOf = (distribution: readonly DistributionItem[]): string[] =>
  [...new Set(distribution.map((d) => d.square).filter(isLetter))].sort();
