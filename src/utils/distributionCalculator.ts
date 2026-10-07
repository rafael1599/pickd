import type { DistributionItem } from '../schemas/inventory.schema';

/**
 * How N bikes of one SKU stand in the warehouse (idea-254,
 * docs/prds/ds-pallet-model.md, Rafael 6 Oct 2026): «no hay torres, sólo
 * pallets». A base is 18 on the floor, a top 12 on a base, a DS the two (30).
 * As many full DS as fit; the rest r: 19–29 an incomplete DS (base 18 + top
 * r − 18), 13–18 a base of r, 1–12 a line pallet of r.
 *
 * Kids bikes are the exception — «los usuarios las arman como les parezca» —
 * so they keep the old towers of 30 and lines of 5 as a starting point.
 *
 * Copied in SQL as `calculate_bike_distribution` (migration
 * 20261006…_todo_es_pallet): if one changes, change the other.
 */
export const DS_UNITS = 30;
export const BASE_UNITS = 18;
export const TOP_UNITS = 12;

export function palletsFor(qty: number): DistributionItem[] {
  if (!(qty > 0)) return [];
  const out: DistributionItem[] = [];
  const ds = Math.floor(qty / DS_UNITS);
  const r = qty - ds * DS_UNITS;
  const bases = ds + (r >= 13 ? 1 : 0);
  const fullTops = ds;
  if (bases > 0) {
    if (r >= 13 && r <= BASE_UNITS) {
      if (ds > 0) out.push({ type: 'BASE', count: ds, units_each: BASE_UNITS });
      out.push({ type: 'BASE', count: 1, units_each: r });
    } else {
      out.push({ type: 'BASE', count: bases, units_each: BASE_UNITS });
    }
  }
  if (fullTops > 0) out.push({ type: 'TOP', count: fullTops, units_each: TOP_UNITS });
  if (r > BASE_UNITS) out.push({ type: 'TOP', count: 1, units_each: r - BASE_UNITS });
  if (r >= 1 && r <= TOP_UNITS) out.push({ type: 'LINE_PALLET', count: 1, units_each: r });
  return out;
}

const TOWER_SIZE = 30;
const LINE_SIZE = 5;

/** The old rule, kept for kids bikes: towers of 30, lines of 5, the rest a line. */
export function towersAndLines(qty: number): DistributionItem[] {
  if (qty <= 0) return [];
  const distribution: DistributionItem[] = [];
  let remaining = qty;
  const towers = Math.floor(remaining / TOWER_SIZE);
  if (towers > 0) {
    distribution.push({ type: 'TOWER', count: towers, units_each: TOWER_SIZE });
    remaining -= towers * TOWER_SIZE;
  }
  const fullLines = Math.floor(remaining / LINE_SIZE);
  if (fullLines > 0) {
    distribution.push({ type: 'LINE', count: fullLines, units_each: LINE_SIZE });
    remaining -= fullLines * LINE_SIZE;
  }
  if (remaining > 0) distribution.push({ type: 'LINE', count: 1, units_each: remaining });
  return distribution;
}

/** A bike's starting shape: pallets, or the old towers and lines for a kids bike. */
export function calculateBikeDistribution(qty: number, isKid = false): DistributionItem[] {
  return isKid ? towersAndLines(qty) : palletsFor(qty);
}
