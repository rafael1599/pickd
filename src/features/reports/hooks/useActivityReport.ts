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

// idea-097 — today's per-SKU events for the Inventory Accuracy block.
export interface TodayLocationQty {
  location: string; // formatted "ROW 20B / A" when sublocation present
  qty: number;
}
export interface TodayMoveEvent {
  sku: string;
  item_name: string;
  from_location: string; // location only — sublocation intentionally hidden
  to_location: string;
  // qty_moved is null when the underlying log row doesn't tell us (idea-098:
  // MOVE rows currently emit quantity_change=0; we fall back to
  // prev_quantity-new_quantity, but if both are missing we hide the (n) suffix).
  qty_moved: number | null;
  show_qty_in_arrow: boolean;
  other_locations: TodayLocationQty[]; // excluding to_location
  total_now: number;
  earliest_ts: string;
}
export interface TodayConsolidationEvent {
  sku: string;
  item_name: string;
  location: string; // location only — sublocation intentionally hidden
  earliest_ts: string;
}
export interface TodayEvents {
  moved: TodayMoveEvent[];
  consolidated: TodayConsolidationEvent[];
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
  today_events: TodayEvents;
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

      const [
        pickingRes,
        logsRes,
        cycleRes,
        profilesRes,
        verifiedRes,
        moveAddRes,
        statsRes,
        notesRes,
        todayLogsRes,
        todayCyclesRes,
        bikeSkusRes,
      ] = await Promise.all([
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
          // ⚠️ Explicit limit (50_000) — PostgREST defaults to 1000 rows, and a
          // 90-day window already crosses that on the current dataset (~2k rows
          // as of 2026-04). Without this the live breakdown silently truncates
          // and diverges from the snapshot RPC. Hitting this ceiling logs a
          // warning below.
          supabase
            .from('inventory_logs')
            .select('sku, action_type, quantity_change')
            .in('action_type', ['MOVE', 'ADD', 'PHYSICAL_DISTRIBUTION', 'EDIT'])
            .eq('is_reversed', false)
            .gte('created_at', twoMonthsAgo)
            .lte('created_at', dayEnd)
            .limit(50_000),
          // Bikes-only: matches the bikes-only numerator filter below.
          supabase.rpc('get_inventory_stats', { p_include_parts: false }),
          supabase
            .from('picking_list_notes')
            .select('id')
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd),
          // idea-097 — today's per-SKU events for the new tables (live only).
          // MOVE → "Moved" section. EDIT with quantity_change=0 → "Consolidation"
          // section (sublocation/distribution metadata edits, no stock movement).
          supabase
            .from('inventory_logs')
            .select(
              'sku, action_type, from_location, to_location, quantity_change, prev_quantity, new_quantity, created_at'
            )
            .in('action_type', ['MOVE', 'EDIT'])
            .eq('is_reversed', false)
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd)
            .limit(50_000),
          supabase
            .from('cycle_count_items')
            .select('sku, counted_at')
            .in('status', ['counted', 'verified'])
            .gte('counted_at', dayStart)
            .lte('counted_at', dayEnd)
            .limit(50_000),
          // Bike SKU set used to scope the accuracy KPI numerator to bikes only.
          supabase.from('sku_metadata').select('sku').eq('is_bike', true).limit(50_000),
        ]);

      const bikeSkuSet = new Set<string>(
        (bikeSkusRes.data ?? []).map((r) => r.sku).filter((s): s is string => !!s)
      );

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
      if (moveAddRows.length >= 50_000) {
        // If we ever hit this it means the dataset has outgrown the live
        // hook's single-page fetch — bullets will undercount and snapshot/
        // live will drift. Bump the limit or page through with .range().
        console.warn(
          '[useActivityReport] inventory_logs window hit the 50_000-row ceiling — accuracy breakdown may be incomplete.'
        );
      }

      // Inventory Accuracy KPI is scoped to bikes only — the denominator
      // (get_inventory_stats(false)) counts bike SKUs, so the numerator must
      // too. Mirrors the SQL filter in compute_daily_report_data.
      const cycleCountedSet = new Set<string>(
        (verifiedRes.data ?? [])
          .map((r) => r.sku)
          .filter((s): s is string => !!s && bikeSkuSet.has(s))
      );
      const movementsSet = new Set<string>();
      const additionsSet = new Set<string>();
      const onSiteCheckedSet = new Set<string>();
      const quantityEditedSet = new Set<string>();

      for (const r of moveAddRows) {
        if (!r.sku || !bikeSkuSet.has(r.sku)) continue;
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

      // idea-097 — today's per-SKU events.
      // The interfaces are intentionally narrow: only fields needed by the View.
      interface TodayLogRow {
        sku: string | null;
        action_type: string;
        from_location: string | null;
        to_location: string | null;
        quantity_change: number | null;
        prev_quantity: number | null;
        new_quantity: number | null;
        created_at: string;
      }
      interface TodayCycleSkuRow {
        sku: string | null;
        counted_at: string;
      }
      interface InventoryRow {
        sku: string;
        item_name: string | null;
        location: string;
        sublocation: string[] | null;
        quantity: number;
      }

      const todayLogs = (todayLogsRes.data ?? []) as TodayLogRow[];
      // Note: todayCycles is still fetched (used for the legacy verified_skus_2m
      // KPI denominator) but no longer drives a report section.
      void (todayCyclesRes.data as TodayCycleSkuRow[] | null);

      const uniqueSkus = new Set<string>();
      for (const l of todayLogs) if (l.sku) uniqueSkus.add(l.sku);

      const inventoryBySku = new Map<string, InventoryRow[]>();
      const itemNameBySku = new Map<string, string>();
      if (uniqueSkus.size > 0) {
        const { data: inventoryData } = await supabase
          .from('inventory')
          .select('sku, item_name, location, sublocation, quantity')
          .in('sku', [...uniqueSkus])
          .gt('quantity', 0)
          .limit(50_000);
        for (const r of (inventoryData ?? []) as InventoryRow[]) {
          const list = inventoryBySku.get(r.sku) ?? [];
          list.push(r);
          inventoryBySku.set(r.sku, list);
          if (r.item_name && r.item_name.trim() && !itemNameBySku.has(r.sku)) {
            itemNameBySku.set(r.sku, r.item_name.trim());
          }
        }
      }

      // Sublocations are intentionally hidden in the report (per user request);
      // only the parent location shows.
      const totalForSku = (sku: string): number =>
        (inventoryBySku.get(sku) ?? []).reduce((sum, r) => sum + (r.quantity ?? 0), 0);
      const otherLocsForSku = (sku: string, exclude: string): TodayLocationQty[] =>
        (inventoryBySku.get(sku) ?? [])
          .filter((r) => r.location !== exclude)
          .map((r) => ({ location: r.location, qty: r.quantity }))
          .sort((a, b) => b.qty - a.qty);
      const primaryLocationForSku = (sku: string): string => {
        const rows = (inventoryBySku.get(sku) ?? []).slice().sort((a, b) => b.quantity - a.quantity);
        return rows[0]?.location ?? '—';
      };

      // MOVED — dedupe per SKU, keep latest move event for that SKU today.
      const movedBySku = new Map<string, TodayLogRow>();
      for (const l of todayLogs) {
        if (l.action_type !== 'MOVE') continue;
        if (!l.sku) continue;
        if (!itemNameBySku.has(l.sku)) continue;
        const cur = movedBySku.get(l.sku);
        if (!cur || l.created_at > cur.created_at) movedBySku.set(l.sku, l);
      }

      const moved: TodayMoveEvent[] = [];
      for (const [sku, l] of movedBySku) {
        const others = otherLocsForSku(sku, l.to_location ?? '');
        // idea-098 dependency: MOVE rows have quantity_change=0 in prod, so we
        // fall back to prev-new on the source row. If both are missing we hide
        // the (n) suffix instead of guessing.
        const fromAbs = Math.abs(l.quantity_change ?? 0);
        const fromDelta = (l.prev_quantity ?? 0) - (l.new_quantity ?? 0);
        const qtyMoved = fromAbs > 0 ? fromAbs : fromDelta > 0 ? fromDelta : null;
        const isPartial = qtyMoved !== null && (l.prev_quantity ?? 0) > qtyMoved;
        const showQty = qtyMoved !== null && (others.length > 0 || isPartial);
        moved.push({
          sku,
          item_name: itemNameBySku.get(sku) ?? sku,
          from_location: l.from_location ?? '',
          to_location: l.to_location ?? '',
          qty_moved: qtyMoved,
          show_qty_in_arrow: showQty,
          other_locations: others,
          total_now: totalForSku(sku),
          earliest_ts: l.created_at,
        });
      }
      const movedSkuSet = new Set(moved.map((m) => m.sku));

      // CONSOLIDATION — sublocation/distribution metadata edits today.
      // Heuristic: inventory_logs.EDIT rows with quantity_change=0 are
      // metadata-only edits (location/sublocation/distribution tweaks).
      // Dedupe per SKU, keep earliest event today; exclude SKUs already in MOVED.
      const consolidatedTimes = new Map<string, string>();
      for (const l of todayLogs) {
        if (l.action_type !== 'EDIT') continue;
        if ((l.quantity_change ?? 0) !== 0) continue;
        if (!l.sku || movedSkuSet.has(l.sku)) continue;
        if (!itemNameBySku.has(l.sku)) continue;
        const cur = consolidatedTimes.get(l.sku);
        if (!cur || l.created_at < cur) consolidatedTimes.set(l.sku, l.created_at);
      }
      const consolidated: TodayConsolidationEvent[] = [];
      for (const [sku, ts] of consolidatedTimes) {
        consolidated.push({
          sku,
          item_name: itemNameBySku.get(sku) ?? sku,
          location: primaryLocationForSku(sku),
          earliest_ts: ts,
        });
      }

      moved.sort((a, b) => a.earliest_ts.localeCompare(b.earliest_ts));
      consolidated.sort((a, b) => a.earliest_ts.localeCompare(b.earliest_ts));

      const today_events: TodayEvents = { moved, consolidated };

      return {
        date,
        users,
        warehouse_totals: { orders_completed: totalOrders, total_items: totalItems },
        verified_skus_2m: verifiedSkus.size,
        verified_skus_breakdown: verifiedSkusBreakdown,
        total_skus: totalSkus,
        correction_count: correctionCount,
        completed_orders_with_photos: completedOrdersWithPhotos,
        today_events,
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
