import type { PickingList } from '../../hooks/useDoubleCheckList';
import { isDeliberateCombineGroupType } from '../../../../utils/shippingClassification';

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
    if (order.group_id && isDeliberateCombineGroupType(order.order_group?.group_type)) {
      if (seenGroups.has(order.group_id)) continue;
      seenGroups.add(order.group_id);
    }
    count++;
  }
  return count;
}

/**
 * Collapse the members of a combined order (same group_id) into one pseudo
 * order so the standard OrderCardShell renders a group exactly like a single
 * order — "#880696 / 880669" with the yellow last-3 accent, aggregated
 * bikes/parts counts, summed pallets and combined verification progress.
 * This replaced the dashed GroupCard: one card look for everything.
 */
export function mergeGroupOrders(groupOrders: PickingList[]): PickingList {
  const first = groupOrders[0];
  if (groupOrders.length === 1) return first;

  // Worst status wins so the card correctly reflects open/active work:
  // 1. needs_correction
  // 2. double_checking
  // 3. ready_to_double_check
  // 4. active
  // 5. completed (only if all members are completed)
  const hasCorrection = groupOrders.some((o) => o.status === 'needs_correction');
  const activeChecker = groupOrders.find(isActivelyChecking);
  const hasChecking = groupOrders.some((o) => o.status === 'double_checking');
  const hasReady = groupOrders.some((o) => o.status === 'ready_to_double_check');
  const hasActive = groupOrders.some((o) => o.status === 'active');

  const status = hasCorrection
    ? 'needs_correction'
    : activeChecker || hasChecking
      ? 'double_checking'
      : hasReady
        ? 'ready_to_double_check'
        : hasActive
          ? 'active'
          : first.status;

  const workerSource = activeChecker ?? groupOrders.find((o) => o.profiles?.full_name) ?? first;

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
        ? keysOf(groupOrders.filter((o) => o.status !== 'completed'))
        : keysOf(groupOrders);

  return {
    ...first,
    order_number: groupOrders
      .map((o) => o.order_number || o.id.toString().slice(-6).toUpperCase())
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .join(' / '),
    items: groupOrders.flatMap((o) => (Array.isArray(o.items) ? o.items : [])),
    verified_item_keys,
    pallets_qty: groupOrders.reduce((s, o) => s + (o.pallets_qty ?? 0), 0),
    status,
    checked_by: workerSource.checked_by,
    profiles: workerSource.profiles,
    checker_profile: workerSource.checker_profile,
    is_addon: groupOrders.some((o) => o.is_addon),
    members: groupOrders.map((o) => ({
      id: o.id,
      order_number: o.order_number,
      notes: o.notes ?? null,
    })),
  };
}
