/**
 * Low-stock tracking helpers for the daily Activity Report (idea-070 / idea-071).
 *
 * The alerts surface SKUs that hit ≤1 unit warehouse-wide after an order
 * completion. On weekdays (Mon–Thu) we only show today's hits. On Fridays
 * we widen the window to the current week (Mon–Fri) so the end-of-week
 * recap captures everything that went low during the week.
 *
 * These are pure functions so they can be unit-tested without hitting
 * Supabase or relying on the browser's timezone.
 */

export type LowStockWindowLabel = 'Today' | 'This week';

export interface LowStockWindow {
  /** Inclusive NY calendar date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive NY calendar date (YYYY-MM-DD). */
  endDate: string;
  /** UI label shown above the sub-group. */
  label: LowStockWindowLabel;
}

export interface LowStockSkuRow {
  sku: string;
  item_name: string | null;
  remaining_qty: number;
}

export interface LowStockClassification {
  outOfStock: LowStockSkuRow[];
  lastUnit: LowStockSkuRow[];
}

/**
 * Returns 0 (Sun) .. 6 (Sat) for a YYYY-MM-DD NY date. Anchored at noon so
 * DST transitions never flip the weekday on the boundary days.
 */
export function getDayOfWeek(nyDate: string): number {
  const d = new Date(nyDate + 'T12:00:00');
  return d.getDay();
}

/**
 * Walks back `n` days from a YYYY-MM-DD string and returns the resulting
 * YYYY-MM-DD string. Uses noon anchoring to sidestep DST.
 */
function addDays(nyDate: string, delta: number): string {
  const d = new Date(nyDate + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Given a NY calendar date, returns the window to query for low-stock
 * alerts:
 *
 *   - Mon..Thu  → just that day, labelled "Today"
 *   - Fri       → Mon..Fri of the same week, labelled "This week"
 *   - Sat/Sun   → fall back to single-day (these days are rare for the
 *                 report, but we handle them gracefully rather than
 *                 throwing — pick the day itself)
 */
export function getLowStockWindow(nyDate: string): LowStockWindow {
  const dow = getDayOfWeek(nyDate);
  if (dow === 5) {
    // Friday — rewind to Monday of the same week (Mon = dow 1 → 4 days back).
    const startDate = addDays(nyDate, -4);
    return { startDate, endDate: nyDate, label: 'This week' };
  }
  return { startDate: nyDate, endDate: nyDate, label: 'Today' };
}

/**
 * Buckets the rows by remaining quantity. `remaining_qty === 0` → out of
 * stock, `=== 1` → last unit. Anything else is dropped. Both lists come
 * back sorted by SKU to give a stable presentation.
 */
export function classifyLowStock(rows: LowStockSkuRow[]): LowStockClassification {
  const outOfStock: LowStockSkuRow[] = [];
  const lastUnit: LowStockSkuRow[] = [];
  for (const r of rows) {
    if (r.remaining_qty === 0) outOfStock.push(r);
    else if (r.remaining_qty === 1) lastUnit.push(r);
  }
  const bySku = (a: LowStockSkuRow, b: LowStockSkuRow) => a.sku.localeCompare(b.sku);
  outOfStock.sort(bySku);
  lastUnit.sort(bySku);
  return { outOfStock, lastUnit };
}
