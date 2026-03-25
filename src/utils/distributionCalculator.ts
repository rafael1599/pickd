import type { DistributionItem } from '../schemas/inventory.schema';

const BIKE_SKU_REGEX = /^\d{2}-\d{4}[A-Za-z]{2,}$/;
const TOWER_SIZE = 30;
const LINE_SIZE = 5;

export function isBikeSku(sku: string): boolean {
  return BIKE_SKU_REGEX.test(sku);
}

export function calculateBikeDistribution(qty: number): DistributionItem[] {
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

  if (remaining > 0) {
    distribution.push({ type: 'LINE', count: 1, units_each: remaining });
  }

  return distribution;
}
