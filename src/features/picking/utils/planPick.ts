/**
 * Planning a pick against the stock as it is right now, for one order or for
 * every row of a combined one.
 *
 * The watcher decides where to pick when it imports the order and freezes that
 * address into the line. By the time somebody picks it up the shelf may have
 * been consolidated, emptied, or —the case that costs a trip— a unit may be
 * sitting in RETURN TO STOCK, which `byPickPreference` puts ahead of any shelf.
 * `rebaseToActualStock` has always known how to answer that; it just never ran
 * for an AS400 order, because it lives inside markAsReady and those orders are
 * born at `ready_to_double_check`, past the point where it fires.
 *
 * Two things here that a bare rebase does not do:
 *
 *   - **Other orders' claims come off the shelf first.** Planning against raw
 *     inventory sends two open orders to the same bike. What another list has
 *     already reserved at an address is not stock this pick can have.
 *   - **Siblings plan in turn, not in parallel.** A combined order is N rows
 *     picked as one; planning each against the same snapshot lets both claim
 *     the same units, so each row consumes what it takes before the next looks.
 */
import {
  rebaseToActualStock,
  type StaleInventoryRow,
  type StaleLocationItem,
} from '../hooks/useStaleLocationCheck';
import type { PickingOrderMap } from './pickLocation';

const norm = (s: string | null | undefined): string => (s || '').trim().toUpperCase();

const addressKey = (
  sku: string,
  warehouse: string | null | undefined,
  location: string | null | undefined
): string => `${sku}|${norm(warehouse)}|${norm(location)}`;

/** Minimal shape of a line this planner reads and rewrites. */
export interface PlannableItem {
  sku: string;
  location: string | null;
  warehouse?: string | null;
  sublocation?: string[] | null;
  pickingQty?: number;
  picked?: boolean;
  sku_not_found?: boolean;
  insufficient_stock?: boolean;
}

/** A claim some other picking list already holds at an address. */
export interface Claim {
  sku: string;
  warehouse?: string | null;
  location: string | null;
  pickingQty?: number;
}

/**
 * Subtract claims from the stock rows, never below zero. Rows the claims do not
 * name come back untouched, so a claim on an address that no longer exists
 * cannot make a real shelf disappear.
 */
export function stockMinusClaims(
  rows: readonly StaleInventoryRow[],
  claims: readonly Claim[]
): StaleInventoryRow[] {
  if (claims.length === 0) return [...rows];
  const owed = new Map<string, number>();
  for (const c of claims) {
    const qty = Math.max(0, Math.trunc(Number(c.pickingQty) || 0));
    if (!c.sku || qty === 0) continue;
    const key = addressKey(c.sku, c.warehouse, c.location);
    owed.set(key, (owed.get(key) ?? 0) + qty);
  }
  return rows.map((row) => {
    const key = addressKey(row.sku, row.warehouse, row.location);
    const take = owed.get(key);
    if (!take) return row;
    return { ...row, quantity: Math.max(0, Number(row.quantity || 0) - take) };
  });
}

/**
 * Plan every row of a group in turn against one snapshot, each consuming what
 * it takes so the next one cannot claim the same units. Rows come back in the
 * order given, each with its own planned items and whether anything moved.
 */
export function planListsInTurn<T extends { id: string; items: PlannableItem[] }>(
  lists: readonly T[],
  rows: readonly StaleInventoryRow[],
  pickingOrder?: PickingOrderMap
): Array<{ id: string; items: PlannableItem[]; changed: boolean; moves: StaleLocationItem[] }> {
  let remaining: StaleInventoryRow[] = [...rows];
  const out: Array<{
    id: string;
    items: PlannableItem[];
    changed: boolean;
    moves: StaleLocationItem[];
  }> = [];

  for (const list of lists) {
    // claimReturnsFloor: this is the planner, not the drift guard. A shelf that
    // covers the pick is not reason enough to leave units on the returns floor.
    const { items: planned, moves } = rebaseToActualStock(list.items, remaining, pickingOrder, {
      claimReturnsFloor: true,
    });
    const changed = !sameAddresses(list.items, planned);
    out.push({ id: list.id, items: planned, changed, moves });
    // What this row now takes is no longer on the shelf for the next one.
    remaining = stockMinusClaims(
      remaining,
      planned.filter((i) => !i.picked && !i.sku_not_found) as Claim[]
    );
  }
  return out;
}

/**
 * Did the plan actually move anything? Compared on address and quantity per
 * position — a rewrite that names the same shelves is not worth a write, and a
 * write echoes back through realtime into every open cart.
 */
export function sameAddresses(before: readonly PlannableItem[], after: readonly PlannableItem[]) {
  if (before.length !== after.length) return false;
  return before.every((b, i) => {
    const a = after[i];
    return (
      b.sku === a.sku &&
      norm(b.location) === norm(a.location) &&
      norm(b.warehouse) === norm(a.warehouse) &&
      (b.pickingQty ?? 0) === (a.pickingQty ?? 0) &&
      norm((b.sublocation ?? []).join('/')) === norm((a.sublocation ?? []).join('/'))
    );
  });
}
