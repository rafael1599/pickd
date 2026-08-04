export interface ClassifiableItem {
  sku: string;
  pickingQty: number;
  /** Present when the item was saved with its metadata joined. */
  sku_metadata?: { is_bike?: boolean | null } | null;
  /** Present on combined carts/rows — which original order owns the item. */
  source_order?: string | null;
}

/** is_bike (sku_metadata) is the canonical source of truth. */
function isBikeItem(item: ClassifiableItem): boolean {
  return item.sku_metadata?.is_bike === true;
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

/**
 * A "deliberate" combine — the group represents one real, user-intended unit
 * (same-customer general combine, or a parked PICK UP group) — as opposed to
 * 'fedex', the auto-grouping trigger's operational bucket for whatever small
 * parcels happen to be active right now (any customer, decouples the moment
 * each member completes). Deliberate combines merge into one card and stay
 * merged after every member completes; the 'fedex' bucket never does.
 */
export function isDeliberateCombineGroupType(groupType: string | null | undefined): boolean {
  return groupType === 'general' || groupType === 'pickup';
}

/** The subset of an order's fields needed to decide whether it's FedEx. */
export interface FedexClassifiableOrder {
  shipping_type?: string | null;
  transport_company?: string | null;
  order_group?: { group_type?: string | null } | null;
  items?: ClassifiableItem[] | null;
}

/**
 * Single source of truth for "is this order FedEx" — Orders, Ship, and the
 * Live Board all call this so the same order can't read FedEx on one screen
 * and Regular/unassigned on another. Precedence:
 *   1. Explicit transport_company === 'FEDEX' (carrier already assigned).
 *   2. Combined-group's group_type === 'fedex'.
 *   3. Explicit shipping_type === 'fedex'.
 *   4. Auto-classify from items — only when shipping_type is unset. An
 *      explicit shipping_type of 'regular' always wins over the guess.
 */
export function isFedexOrder(
  order: FedexClassifiableOrder,
  skuWeights: Record<string, number> = {}
): boolean {
  const transport = String(order.transport_company ?? '')
    .trim()
    .toUpperCase();
  if (transport === 'FEDEX') return true;
  // An explicit transport_company carrier (e.g. RIST, R+L, DAYLIGHT, ESTES, ODFL, PICK UP)
  // means a freight/regular carrier has been assigned.
  if (transport && transport !== 'FEDEX') return false;
  if (order.order_group?.group_type === 'fedex') return true;
  if (order.shipping_type === 'fedex') return true;
  if (order.shipping_type) return false;
  return autoClassifyShippingType(order.items ?? [], skuWeights) === 'fedex';
}

/**
 * Single source of truth for the carrier chip/filter label shown on
 * Orders, Ship, and the Live Board — a raw `transport_company` string is
 * NOT the carrier: FedEx orders routinely have no transport_company set
 * (auto-classified by weight/bike-count, or inherited from a 'fedex'
 * group_type) and would otherwise read as "Unassigned" on one screen while
 * showing correctly as FedEx on another. PICK UP is checked first — it has
 * no shipping_type/weight signal of its own and would otherwise fall
 * through to the FedEx auto-classify guess.
 *
 * Callers compute `isFedex` via their own typed `isFedexOrder` wrapper
 * (item shapes vary slightly across screens) and pass it in here alongside
 * the raw transport_company string.
 */
export function getCarrierLabel(
  transportCompany: string | null | undefined,
  isFedex: boolean
): string | null {
  const explicit =
    String(transportCompany ?? '')
      .trim()
      .toUpperCase() || null;
  if (explicit === 'PICK UP') return explicit;
  if (isFedex) return 'FEDEX';
  return explicit;
}
