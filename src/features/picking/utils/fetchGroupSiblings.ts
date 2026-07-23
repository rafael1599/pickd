import { supabase } from '../../../lib/supabase';
import { withSupabaseRetry } from '../../../lib/supabaseRetry';

/**
 * Fetches the other rows sharing a `group_id` — the single source of truth
 * for which siblings count as "part of the group" for display purposes.
 * Previously three independent call sites (DoubleCheckView's item merge,
 * ShipScreen's realtime resync, ShipScreen's initial-load grouping) each
 * hand-wrote this query with a different status-exclusion policy, so which
 * siblings showed up could depend on which of the three happened to run
 * last — this is what made a combined order's details/photos look
 * inconsistent between reloads and realtime updates.
 *
 * `excludeStatuses` defaults to just `cancelled` (ShipScreen's baseline —
 * it still needs completed/shipped siblings for its Shipped tab). Screens
 * with a stricter rule (e.g. DoubleCheckView must never merge in an
 * already-completed sibling) pass their own override explicitly.
 */
export async function fetchGroupSiblings<T extends { id: string }>(
  groupId: string,
  opts: { columns: string; excludeId?: string; excludeStatuses?: string[]; label: string }
): Promise<T[]> {
  const { columns, excludeId, excludeStatuses = ['cancelled'], label } = opts;
  const { data, error } = await withSupabaseRetry(
    () => {
      let query = supabase.from('picking_lists').select(columns).eq('group_id', groupId);
      if (excludeId) query = query.neq('id', excludeId);
      for (const status of excludeStatuses) {
        query = query.neq('status', status);
      }
      return query;
    },
    { label }
  );
  if (error) throw error;
  return (data ?? []) as unknown as T[];
}
