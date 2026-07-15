import type { PickingList } from '../../hooks/useDoubleCheckList';
import { isActivelyChecking } from './SortableOrderCard';

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

  // Worst status wins so the border/icon surface "needs attention" first.
  // Parked members (double_checking without a checker) don't count as
  // "checking" — the pseudo order should render as a plain card then.
  const activeChecker = groupOrders.find(isActivelyChecking);
  const status = groupOrders.some((o) => o.status === 'needs_correction')
    ? 'needs_correction'
    : activeChecker
      ? 'double_checking'
      : first.status;

  // Show whoever is actually on the order: the active checker if any member
  // is being double-checked, else the first member with a picker profile.
  const workerSource = activeChecker ?? groupOrders.find((o) => o.profiles?.full_name) ?? first;

  return {
    ...first,
    order_number: groupOrders
      .map((o) => o.order_number || o.id.toString().slice(-6).toUpperCase())
      .join(' / '),
    items: groupOrders.flatMap((o) => (Array.isArray(o.items) ? o.items : [])),
    verified_item_keys: groupOrders.flatMap((o) => o.verified_item_keys ?? []),
    pallets_qty: groupOrders.reduce((s, o) => s + (o.pallets_qty ?? 0), 0),
    status,
    checked_by: workerSource.checked_by,
    profiles: workerSource.profiles,
    checker_profile: workerSource.checker_profile,
    is_addon: groupOrders.some((o) => o.is_addon),
  };
}
