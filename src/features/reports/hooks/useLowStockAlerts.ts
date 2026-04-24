import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { getNYDayBounds } from '../../../lib/nyDate';
import {
  classifyLowStock,
  getLowStockWindow,
  type LowStockClassification,
  type LowStockSkuRow,
  type LowStockWindowLabel,
} from '../utils/lowStockWindow';

export interface LowStockAlerts extends LowStockClassification {
  /** Label to show above the block ("Today" or "This week"). */
  windowLabel: LowStockWindowLabel;
}

interface InventoryRow {
  sku: string;
  quantity: number | null;
  item_name: string | null;
  is_active: boolean | null;
}

interface DeductLogRow {
  sku: string | null;
}

/**
 * Detects SKUs that hit ≤1 unit warehouse-wide after being deducted by
 * order completions in the relevant window (today on Mon–Thu, Mon–Fri on
 * Friday). Data source (idea-070):
 *
 *   1. `inventory_logs` rows with `action_type='DEDUCT'` + `list_id IS NOT NULL`
 *      (these are the per-SKU events emitted when a picking list is completed)
 *      within the window's UTC bounds.
 *   2. Current warehouse-wide sum of `inventory.quantity` (active rows only)
 *      grouped by SKU, for the SKUs surfaced by step 1.
 *
 * We do not filter by warehouse code because PickD operates a single
 * warehouse (LUDLOW). The sum across active rows is the warehouse-wide
 * remainder.
 */
export function useLowStockAlerts(nyDate: string) {
  return useQuery<LowStockAlerts>({
    queryKey: ['low-stock-alerts', nyDate],
    queryFn: async () => {
      const window = getLowStockWindow(nyDate);

      // NY calendar-day → UTC bounds for start and end day. `startsAt` of
      // the start day and `endsAt` of the end day covers the full window.
      const [startBounds, endBounds] = await Promise.all([
        getNYDayBounds(window.startDate),
        getNYDayBounds(window.endDate),
      ]);

      // Step 1: find SKUs touched by order completions in the window.
      const { data: logRows, error: logErr } = await supabase
        .from('inventory_logs')
        .select('sku')
        .eq('action_type', 'DEDUCT')
        .eq('is_reversed', false)
        .not('list_id', 'is', null)
        .gte('created_at', startBounds.startsAt)
        .lte('created_at', endBounds.endsAt);
      if (logErr) throw logErr;

      const touchedSkus = Array.from(
        new Set(((logRows ?? []) as DeductLogRow[]).map((r) => r.sku).filter((s): s is string => !!s))
      );

      if (touchedSkus.length === 0) {
        return { outOfStock: [], lastUnit: [], windowLabel: window.label };
      }

      // Step 2: current warehouse-wide qty per SKU (active rows only).
      // `inventory` has one row per (sku, location) so we aggregate client-side.
      const { data: invRows, error: invErr } = await supabase
        .from('inventory')
        .select('sku, quantity, item_name, is_active')
        .eq('is_active', true)
        .in('sku', touchedSkus);
      if (invErr) throw invErr;

      const totals = new Map<string, { qty: number; name: string | null }>();
      for (const row of (invRows ?? []) as InventoryRow[]) {
        const prev = totals.get(row.sku) ?? { qty: 0, name: null };
        totals.set(row.sku, {
          qty: prev.qty + (row.quantity ?? 0),
          // Prefer the first non-null item_name we see; rows typically share it.
          name: prev.name ?? row.item_name ?? null,
        });
      }

      // For SKUs that were deducted but have no active inventory rows left,
      // the remaining qty is 0. Seed those explicitly so they still show up
      // as "out of stock".
      const rows: LowStockSkuRow[] = touchedSkus.map((sku) => {
        const agg = totals.get(sku);
        return {
          sku,
          item_name: agg?.name ?? null,
          remaining_qty: agg?.qty ?? 0,
        };
      });

      return {
        ...classifyLowStock(rows),
        windowLabel: window.label,
      };
    },
    staleTime: 2 * 60_000,
    retry: 1,
    enabled: !!nyDate,
  });
}
