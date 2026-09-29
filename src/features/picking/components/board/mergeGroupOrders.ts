import type { PickingList, PickingItem } from '../../hooks/useDoubleCheckList';
import { isDeliberateCombineGroupType } from '../../../../utils/shippingClassification';
import { combineOrdersCore } from '../../../../utils/combineOrders';

export function isActivelyChecking(order: PickingList): boolean {
  return order.status === 'double_checking' && !!order.checked_by;
}

/**
 * How many order slots `orders` actually takes on the board — what a lane
 * chip or a "(N)" count should show.
 *
 * A deliberate combine (general/pickup) renders as ONE card via
 * {@link mergeGroupOrders}, so its members count once, not once each — a
 * "Waiting (3)" badge for a single combined card reads as three separate
 * orders stuck in the queue when there is only one. A 'fedex' auto-group
 * never collapses (see isDeliberateCombineGroupType) and keeps counting each
 * member, matching the stacked list it actually renders as.
 */
export function countDistinctOrders(
  orders: readonly Pick<PickingList, 'group_id' | 'order_group'>[]
): number {
  const seenGroups = new Set<string>();
  let count = 0;
  for (const order of orders) {
    const key = combinedCardKey(order);
    if (key) {
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
    }
    count++;
  }
  return count;
}

/**
 * The card an order shares with its siblings, or null when it is its own card.
 * Only a deliberate combine (general/pickup): a FedEx batch is a work lot of
 * unrelated customers, and grouping by it put them on one "GRP" card that the
 * zone's own count still read as several orders.
 */
export function combinedCardKey(
  order: Pick<PickingList, 'group_id' | 'order_group'>
): string | null {
  return order.group_id && isDeliberateCombineGroupType(order.order_group?.group_type)
    ? order.group_id
    : null;
}

/**
 * Collapse the members of a combined order (same group_id or shipment_id) into
 * one pseudo order so the standard OrderCardShell renders a group exactly like a single
 * order — "#880696 / 880669" with the yellow last-3 accent, aggregated
 * bikes/parts counts, summed pallets and combined verification progress.
 *
 * Delegates to canonical combineOrdersCore for anchor selection (oldest by created_at),
 * item tagging, and summed units.
 */
export function mergeGroupOrders(groupOrders: PickingList[]): PickingList {
  if (groupOrders.length === 0) {
    throw new Error('Cannot merge empty groupOrders');
  }
  if (groupOrders.length === 1) return groupOrders[0];

  const core = combineOrdersCore(groupOrders);
  const { sorted, anchor } = core;

  // Worst status wins so the card correctly reflects open/active work:
  // 1. needs_correction
  // 2. double_checking
  // 3. ready_to_double_check
  // 4. active
  // 5. completed (only if all members are completed)
  const hasCorrection = sorted.some((o) => o.status === 'needs_correction');
  const activeChecker = sorted.find(isActivelyChecking);
  const hasChecking = sorted.some((o) => o.status === 'double_checking');
  const hasReady = sorted.some((o) => o.status === 'ready_to_double_check');
  const hasActive = sorted.some((o) => o.status === 'active');

  const status = hasCorrection
    ? 'needs_correction'
    : activeChecker || hasChecking
      ? 'double_checking'
      : hasReady
        ? 'ready_to_double_check'
        : hasActive
          ? 'active'
          : anchor.status;

  const workerSource = activeChecker ?? sorted.find((o) => o.profiles?.full_name) ?? anchor;

  // A group waiting in the queue shows no progress (Ready to DC empties its keys).
  // One being picked (active) reads what its open members carry — Double Check
  // writes the cart's keys to them as the picker ticks — but never what a
  // completed member kept from its own, earlier check.
  const keysOf = (orders: PickingList[]) =>
    Array.from(new Set(orders.flatMap((o) => o.verified_item_keys ?? [])));
  const verified_item_keys =
    status === 'ready_to_double_check'
      ? []
      : status === 'active'
        ? keysOf(sorted.filter((o) => o.status !== 'completed'))
        : keysOf(sorted);

  return {
    ...anchor,
    order_number: core.combinedOrderNumber || anchor.order_number,
    items: core.combinedItems as unknown as PickingItem[],
    total_units: core.combinedTotalUnits,
    pallets_qty: core.combinedPalletsQty,
    transport_company: core.combinedTransportCompany,
    load_number: core.combinedLoadNumber,
    status,
    checked_by: workerSource.checked_by,
    profiles: workerSource.profiles,
    checker_profile: workerSource.checker_profile,
    verified_item_keys,
    is_addon: sorted.some((o) => o.is_addon),
    members: sorted.map((o) => ({
      id: o.id,
      order_number: o.order_number,
      notes: o.notes ?? null,
    })),
  };
}
