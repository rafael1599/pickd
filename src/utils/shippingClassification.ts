/**
 * Auto-classify shipping type for an order.
 * Rules (evaluated in order):
 *   1. Any item with weight > 50 lbs → 'regular'
 *   2. Total items (sum of pickingQty) >= 5 → 'regular'
 *   3. Otherwise → 'fedex'
 */
export function autoClassifyShippingType(
  items: { sku: string; pickingQty: number }[],
  skuWeights: Record<string, number> // sku → weight_lbs
): 'fedex' | 'regular' {
  // Rule 1: any item > 50 lbs
  const hasHeavyItem = items.some(item => (skuWeights[item.sku] ?? 0) > 50);
  if (hasHeavyItem) return 'regular';

  // Rule 2: >= 5 total items
  const totalItems = items.reduce((sum, i) => sum + (i.pickingQty || 0), 0);
  if (totalItems >= 5) return 'regular';

  return 'fedex';
}
