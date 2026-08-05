import type { PickingList } from '../../hooks/useDoubleCheckList';
export function isActivelyChecking(order: PickingList): boolean {
  return order.status === 'double_checking' && !!order.checked_by;
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

  // Un-checked orders (ready_to_double_check / active) must NOT inherit verified keys from completed/sibling orders
  const isUncheckedStatus = status === 'ready_to_double_check' || status === 'active';
  const verified_item_keys = isUncheckedStatus
    ? []
    : Array.from(new Set(groupOrders.flatMap((o) => o.verified_item_keys ?? [])));

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
  };
}
