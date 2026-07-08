import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { getNYDayBounds } from '../../../lib/nyDate';
import { moveDeltaUnits } from '../../inventory/utils/inventoryLogShape';

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
  /** Bikes physically confirmed via order picks (DEDUCT). Added 2026-07-08. */
  picked: number;
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

/** idea-091: minimal summary for the FedEx Returns block in the daily
 *  Activity Report. Intentionally drops names and timestamps — operationally
 *  we just want to know how much landed today. */
export interface FedExReturnSummary {
  tracking_number: string;
  status: string;
  /** Optional RMA / Return Merchandise Authorization issued by the
   *  manufacturer for this return. Captured at intake; null for legacy
   *  rows (column added 2026-05-06). */
  rma: string | null;
  item_count: number;
  total_qty: number;
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
  fedex_returns: FedExReturnSummary[];
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

      const [
        pickingRes,
        logsRes,
        cycleRes,
        profilesRes,
        notesRes,
        todayLogsRes,
        todayCyclesRes,
        fedexReturnsRes,
        accuracyRes,
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
          // idea-091 — today's FedEx returns. Basic info only: tracking +
          // status + item totals. No names, no timestamps.
          supabase
            .from('fedex_returns')
            .select('tracking_number, status, rma, items:fedex_return_items(quantity)')
            .gte('received_at', dayStart)
            .lte('received_at', dayEnd)
            .order('received_at', { ascending: false })
            .limit(200),
          // Inventory Accuracy KPI — single source of truth (honest coverage +
          // 180d window + sticky counts + picks). Same RPC the snapshot
          // (compute_daily_report_data) uses, so live and snapshot never drift.
          supabase.rpc('get_inventory_accuracy', { p_as_of: date }),
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

      // Inventory Accuracy KPI — read straight from get_inventory_accuracy, the
      // single source of truth shared with the snapshot RPC
      // (compute_daily_report_data). Honest coverage (numerator ⊆ active bikes),
      // 180-day window, sticky cycle-counts, and picks are all computed
      // server-side, so live (today) and snapshot (past days) never diverge.
      const accuracy = (accuracyRes.data ?? null) as unknown as {
        verified_skus_2m?: number;
        total_skus?: number;
        verified_skus_breakdown?: VerifiedSkusBreakdown;
      } | null;
      const verifiedSkusCount = Number(accuracy?.verified_skus_2m ?? 0);
      const verifiedSkusBreakdown: VerifiedSkusBreakdown = {
        cycle_counted: accuracy?.verified_skus_breakdown?.cycle_counted ?? 0,
        movements: accuracy?.verified_skus_breakdown?.movements ?? 0,
        additions: accuracy?.verified_skus_breakdown?.additions ?? 0,
        on_site_checked: accuracy?.verified_skus_breakdown?.on_site_checked ?? 0,
        quantity_edited: accuracy?.verified_skus_breakdown?.quantity_edited ?? 0,
        picked: accuracy?.verified_skus_breakdown?.picked ?? 0,
      };
      const totalSkus = Number(accuracy?.total_skus ?? 0);

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
        // Fetch ALL inventory rows for these SKUs (including qty=0). The
        // item_name often lives on a stale row with qty=0 while the freshly
        // moved-into row has an empty name — filtering by qty>0 here would
        // hide the SKU from the report. We do qty>0 filtering in JS below for
        // totals and locations, but use any non-empty item_name across all
        // rows to identify the SKU.
        const { data: inventoryData } = await supabase
          .from('inventory')
          .select('sku, item_name, location, sublocation, quantity')
          .in('sku', [...uniqueSkus])
          .limit(50_000);
        for (const r of (inventoryData ?? []) as InventoryRow[]) {
          if ((r.quantity ?? 0) > 0) {
            const list = inventoryBySku.get(r.sku) ?? [];
            list.push(r);
            inventoryBySku.set(r.sku, list);
          }
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
        // Tolerate both MOVE log shapes (Shape A historical, Shape B current).
        // See docs/inventory-log-shapes.md.
        const qtyMoved = moveDeltaUnits(l);
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
        // Skip SKUs with zero stock everywhere — a metadata-only EDIT on a
        // sold-out SKU isn't a real consolidation worth reporting and would
        // render as "consolidated on —".
        if (totalForSku(sku) <= 0) continue;
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

      // idea-091 — aggregate today's FedEx returns to the minimal basic
      // info the user wants in the daily report.
      type FedexReturnRow = {
        tracking_number: string | null;
        status: string | null;
        rma: string | null;
        items: { quantity: number | null }[] | null;
      };
      const fedex_returns: FedExReturnSummary[] = (
        (fedexReturnsRes.data ?? []) as unknown as FedexReturnRow[]
      ).map((r) => {
        const items = r.items ?? [];
        return {
          tracking_number: r.tracking_number ?? '—',
          status: r.status ?? 'unknown',
          rma: r.rma ?? null,
          item_count: items.length,
          total_qty: items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0),
        };
      });

      return {
        date,
        users,
        warehouse_totals: { orders_completed: totalOrders, total_items: totalItems },
        verified_skus_2m: verifiedSkusCount,
        verified_skus_breakdown: verifiedSkusBreakdown,
        total_skus: totalSkus,
        correction_count: correctionCount,
        completed_orders_with_photos: completedOrdersWithPhotos,
        today_events,
        fedex_returns,
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
