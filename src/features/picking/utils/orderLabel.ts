/**
 * Header label logic for combined (merged) order numbers in DoubleCheckView.
 *
 * Order numbers are stored joined with ' / ' (e.g. "880083 / 880121"). The header
 * shows them compactly:
 *   - 0 orders  → a caller-provided fallback (stock deduction / active list id).
 *   - 1 order   → "#880083".
 *   - exactly 2 → last 3 digits of EACH, joined by " / " (e.g. "083 / 121") so both
 *                 are visible at a glance without a dropdown.
 *   - 3+ orders → "#<first>" plus a "+N" badge and a dropdown (unchanged behavior).
 *
 * Pure function so it is unit-testable without the DOM.
 */

/** Last 3 characters of an order number — the digits that differ between merges. */
export function lastThree(orderNumber: string): string {
  const t = orderNumber.trim();
  return t.length <= 3 ? t : t.slice(-3);
}

export type OrderHeaderKind = 'single' | 'pair' | 'many';

export interface OrderHeaderLabel {
  kind: OrderHeaderKind;
  /** Text shown in the chip/button. */
  label: string;
  /** How many orders are combined. */
  count: number;
}

export function splitOrderNumbers(orderNumber: string | null | undefined): string[] {
  return (orderNumber ?? '')
    .split(' / ')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function orderHeaderLabel(
  orderNumber: string | null | undefined,
  fallback: string
): OrderHeaderLabel {
  const orders = splitOrderNumbers(orderNumber);
  if (orders.length === 0) return { kind: 'single', label: fallback, count: 0 };
  if (orders.length === 1) return { kind: 'single', label: `#${orders[0]}`, count: 1 };
  if (orders.length === 2) {
    return { kind: 'pair', label: orders.map(lastThree).join(' / '), count: 2 };
  }
  return { kind: 'many', label: `#${orders[0]}`, count: orders.length };
}
