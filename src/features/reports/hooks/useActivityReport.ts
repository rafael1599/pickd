import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { getNYDayBounds } from '../../../lib/nyDate';

export interface UserActivity {
  user_id: string;
  full_name: string;
  orders_picked: number;
  items_picked: number;
  orders_checked: number;
  items_checked: number;
  inventory_adds: number;
  inventory_moves: number;
  inventory_deducts: number;
  cycle_count_items: number;
  cycle_count_discrepancies: number;
}

export interface CompletedOrderPhotos {
  order_number: string;
  photos: string[];
}

export interface VerifiedSkusBreakdown {
  cycle_counted: number;
  movements: number;
  additions: number;
  on_site_checked: number;
  quantity_edited: number;
}

export interface ActivityReport {
  date: string;
  users: UserActivity[];
  warehouse_totals: { orders_completed: number; total_items: number };
  verified_skus_2m: number;
  verified_skus_breakdown: VerifiedSkusBreakdown;
  total_skus: number;
  correction_count: number;
  completed_orders_with_photos: CompletedOrderPhotos[];
}

interface PickingRow {
  user_id: string;
  checked_by: string | null;
  items: { pickingQty?: number }[];
  order_number: string | null;
  pallet_photos: string[] | null;
}

interface LogRow {
  user_id: string;
  action_type: string;
  quantity_change: number;
  list_id: string | null;
}

interface CycleRow {
  counted_by: string | null;
  variance: number | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
}

export function useActivityReport(date: string) {
  return useQuery({
    queryKey: ['activity-report', date],
    queryFn: async () => {
      // NY-correct UTC bounds via Postgres (handles DST natively).
      // See src/lib/nyDate.ts and the NY tz migration.
      const { startsAt: dayStart, endsAt: dayEnd } = await getNYDayBounds(date);

      const twoMonthsAgo = new Date(new Date(dayEnd).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

      const [pickingRes, logsRes, cycleRes, profilesRes, verifiedRes, moveAddRes, statsRes, notesRes] =
        await Promise.all([
          supabase
            .from('picking_lists')
            .select('user_id, checked_by, items, order_number, pallet_photos')
            .eq('status', 'completed')
            .gte('updated_at', dayStart)
            .lte('updated_at', dayEnd),
          supabase
            .from('inventory_logs')
            .select('user_id, action_type, quantity_change, list_id')
            .eq('is_reversed', false)
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd),
          supabase
            .from('cycle_count_items')
            .select('counted_by, variance')
            .in('status', ['counted', 'verified'])
            .gte('counted_at', dayStart)
            .lte('counted_at', dayEnd),
          supabase
            .from('profiles')
            .select('id, full_name')
            .eq('is_active', true),
          supabase
            .from('cycle_count_items')
            .select('sku')
            .in('status', ['counted', 'verified'])
            .gte('counted_at', twoMonthsAgo)
            .lte('counted_at', dayEnd),
          // SKUs physically touched via MOVE/ADD/PHYSICAL_DISTRIBUTION/EDIT in last 90 days (coverage).
          // EDIT rows with quantity_change = 0 are filtered post-fetch.
          supabase
            .from('inventory_logs')
            .select('sku, action_type, quantity_change')
            .in('action_type', ['MOVE', 'ADD', 'PHYSICAL_DISTRIBUTION', 'EDIT'])
            .eq('is_reversed', false)
            .gte('created_at', twoMonthsAgo)
            .lte('created_at', dayEnd),
          supabase.rpc('get_inventory_stats', { p_include_parts: true }),
          supabase
            .from('picking_list_notes')
            .select('id')
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd),
        ]);

      const profiles = (profilesRes.data ?? []) as ProfileRow[];
      const profileMap = new Map(profiles.map((p) => [p.id, p.full_name]));
      const warehouseTeamId = profiles.find((p) => p.full_name === 'Warehouse Team')?.id;

      const picking = (pickingRes.data ?? []) as unknown as PickingRow[];
      const logs = (logsRes.data ?? []) as LogRow[];
      const cycles: CycleRow[] = cycleRes.data ?? [];

      // Aggregate per user
      const userMap = new Map<string, UserActivity>();
      const ensure = (uid: string): UserActivity => {
        if (!userMap.has(uid)) {
          userMap.set(uid, {
            user_id: uid,
            full_name: profileMap.get(uid) ?? 'Unknown',
            orders_picked: 0, items_picked: 0,
            orders_checked: 0, items_checked: 0,
            inventory_adds: 0, inventory_moves: 0, inventory_deducts: 0,
            cycle_count_items: 0, cycle_count_discrepancies: 0,
          });
        }
        return userMap.get(uid)!;
      };

      let totalOrders = 0;
      let totalItems = 0;

      for (const pl of picking) {
        const itemCount = (pl.items ?? []).reduce(
          (sum: number, i: { pickingQty?: number }) => sum + (i.pickingQty ?? 0), 0
        );
        totalOrders++;
        totalItems += itemCount;

        if (pl.user_id && pl.user_id !== warehouseTeamId) {
          const u = ensure(pl.user_id);
          u.orders_picked++;
          u.items_picked += itemCount;
        }
        if (pl.checked_by && pl.checked_by !== warehouseTeamId) {
          const u = ensure(pl.checked_by);
          u.orders_checked++;
          u.items_checked += itemCount;
        }
      }

      for (const log of logs) {
        if (!log.user_id || log.user_id === warehouseTeamId) continue;
        // Skip auto-deducts from order completion (they have a list_id)
        if (log.action_type === 'DEDUCT' && log.list_id) continue;
        const u = ensure(log.user_id);
        const qty = Math.abs(log.quantity_change ?? 1);
        if (log.action_type === 'ADD') u.inventory_adds += qty;
        else if (log.action_type === 'MOVE') u.inventory_moves += qty;
        else if (log.action_type === 'DEDUCT') u.inventory_deducts += qty;
      }

      for (const cc of cycles) {
        if (!cc.counted_by || cc.counted_by === warehouseTeamId) continue;
        const u = ensure(cc.counted_by);
        u.cycle_count_items++;
        if (cc.variance != null && cc.variance !== 0) u.cycle_count_discrepancies++;
      }

      const users = [...userMap.values()]
        .filter(
          (u) =>
            u.orders_picked > 0 || u.orders_checked > 0 ||
            u.inventory_adds > 0 || u.inventory_moves > 0 || u.inventory_deducts > 0 ||
            u.cycle_count_items > 0
        )
        .sort((a, b) => a.full_name.localeCompare(b.full_name));

      // Verified SKUs (90 days) — split by source category for the KPI breakdown.
      interface MoveAddLogRow {
        sku: string | null;
        action_type: string;
        quantity_change: number | null;
      }
      const moveAddRows = (moveAddRes.data ?? []) as MoveAddLogRow[];

      const cycleCountedSet = new Set<string>(
        (verifiedRes.data ?? []).map((r) => r.sku).filter((s): s is string => !!s)
      );
      const movementsSet = new Set<string>();
      const additionsSet = new Set<string>();
      const onSiteCheckedSet = new Set<string>();
      const quantityEditedSet = new Set<string>();

      for (const r of moveAddRows) {
        if (!r.sku) continue;
        switch (r.action_type) {
          case 'MOVE':
            movementsSet.add(r.sku);
            break;
          case 'ADD':
            additionsSet.add(r.sku);
            break;
          case 'PHYSICAL_DISTRIBUTION':
            onSiteCheckedSet.add(r.sku);
            break;
          case 'EDIT':
            // Only EDITs that actually changed a quantity count as verification.
            if ((r.quantity_change ?? 0) !== 0) quantityEditedSet.add(r.sku);
            break;
          default:
            break;
        }
      }

      const verifiedSkus = new Set<string>([
        ...cycleCountedSet,
        ...movementsSet,
        ...additionsSet,
        ...onSiteCheckedSet,
        ...quantityEditedSet,
      ]);
      const verifiedSkusBreakdown: VerifiedSkusBreakdown = {
        cycle_counted: cycleCountedSet.size,
        movements: movementsSet.size,
        additions: additionsSet.size,
        on_site_checked: onSiteCheckedSet.size,
        quantity_edited: quantityEditedSet.size,
      };
      const totalSkus = Number(statsRes.data?.[0]?.total_skus ?? 0);

      const correctionCount = (notesRes.data ?? []).length;

      const completedOrdersWithPhotos: CompletedOrderPhotos[] = (pickingRes.data ?? [])
        .filter(
          (r): r is PickingRow & { pallet_photos: string[]; order_number: string } =>
            !!r.order_number && Array.isArray(r.pallet_photos) && r.pallet_photos.length > 0
        )
        .map((r) => ({ order_number: r.order_number, photos: r.pallet_photos }));

      return {
        date,
        users,
        warehouse_totals: { orders_completed: totalOrders, total_items: totalItems },
        verified_skus_2m: verifiedSkus.size,
        verified_skus_breakdown: verifiedSkusBreakdown,
        total_skus: totalSkus,
        correction_count: correctionCount,
        completed_orders_with_photos: completedOrdersWithPhotos,
      } satisfies ActivityReport;
    },
    staleTime: 2 * 60_000,
    retry: 1,
    enabled: !!date,
  });
}

export function useActiveProfiles() {
  return useQuery({
    queryKey: ['profiles', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('is_active', true)
        .neq('full_name', 'Warehouse Team')
        .order('full_name');
      if (error) throw error;
      return data as { id: string; full_name: string; role: string }[];
    },
    staleTime: 30 * 60_000,
  });
}
