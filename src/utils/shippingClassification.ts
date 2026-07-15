interface ClassifiableItem {
  sku: string;
  pickingQty: number;
  /** Present when the item was saved with its metadata joined. */
  sku_metadata?: { is_bike?: boolean | null } | null;
  /** Present on combined carts/rows — which original order owns the item. */
  source_order?: string | null;
}

/** is_bike (sku_metadata) is the source of truth; the 03- prefix is only a
 *  fallback for legacy/watchdog items saved without metadata. */
function isBikeItem(item: ClassifiableItem): boolean {
  const flag = item.sku_metadata?.is_bike;
  if (typeof flag === 'boolean') return flag;
  return item.sku?.startsWith('03-') ?? false;
}

/**
 * Auto-classify shipping type for an order.
 * Rules (evaluated in order):
 *   1. Any item with weight > 50 lbs → 'regular'
 *   2. Total BIKES (is_bike, sum of pickingQty) >= 5 → 'regular'
 *   3. Otherwise → 'fedex'
 *
 * Parts never make an order 'regular' on their own: an order of 50 small
 * parts still ships FedEx. Only bike volume (or a heavy item) forces a truck.
 * Mirrored in DB by classify_picking_list_fedex — keep both in sync.
 */
function classifySingleOrder(
  items: ClassifiableItem[],
  skuWeights: Record<string, number>
): 'fedex' | 'regular' {
  // Rule 1: any item > 50 lbs
  const hasHeavyItem = items.some((item) => (skuWeights[item.sku] ?? 0) > 50);
  if (hasHeavyItem) return 'regular';

  // Rule 2: >= 5 bikes (parts don't count toward the threshold)
  const totalBikes = items.reduce((sum, i) => sum + (isBikeItem(i) ? i.pickingQty || 0 : 0), 0);
  if (totalBikes >= 5) return 'regular';

  return 'fedex';
}

export function autoClassifyShippingType(
  items: ClassifiableItem[],
  skuWeights: Record<string, number> // sku → weight_lbs
): 'fedex' | 'regular' {
  // Combined orders: a group of FedEx orders is still a FedEx order. Classify
  // each source order separately (items are tagged with source_order when
  // merged) — the combined order is regular only if some constituent order
  // is regular on its own. Never re-classify over the merged totals, or two
  // 3-bike FedEx orders would wrongly become a 6-bike "regular".
  if (items.some((i) => i.source_order)) {
    const bySource = new Map<string, ClassifiableItem[]>();
    for (const item of items) {
      const key = item.source_order ?? '__anchor__';
      const arr = bySource.get(key) ?? [];
      arr.push(item);
      bySource.set(key, arr);
    }
    for (const group of bySource.values()) {
      if (classifySingleOrder(group, skuWeights) === 'regular') return 'regular';
    }
    return 'fedex';
  }

  return classifySingleOrder(items, skuWeights);
}
