// Choosing which shelf to send the picker to when a SKU sits in several.
//
// The choice used to be quantity and nothing else: whichever row held the most
// units won. That reads as sensible and is wrong often enough to be the single
// biggest source of manual corrections — a third of every replacement recorded
// in five months is a picker changing the location of a SKU they were happy
// with otherwise. The clearest case is the buried row (named "42 BURIED" at the
// time, "ROW 42 BURIED" since): 39 units, so it beat a normal row holding 17,
// and the pickers re-routed it by hand four times in eight days.

import { LAST_RESORT_PICKING_ORDER, isLastResortOrder } from '../../../utils/pickingOrder';

export { LAST_RESORT_PICKING_ORDER };

/**
 * Picking order per address, as `locations` records it.
 *
 * Keyed on warehouse *and* location, because the name alone is not unique: both
 * LUDLOW and ATS have a row called PALLETIZED, and they are ranked differently —
 * 9995 in one, the plain 999 "unranked" default in the other. Keyed on the name
 * alone, whichever row the query returned last decided the answer for both, so a
 * normal shelf could be skipped as buried or a buried one walked into.
 */
export type PickingOrderMap = ReadonlyMap<string, number | null>;

const norm = (s: string | null | undefined): string => (s || '').trim().toUpperCase();

const addressKey = (warehouse: string | null | undefined, location: string | null | undefined) =>
  `${norm(warehouse)}|${norm(location)}`;

/** Enough of a row to look its ranking up. */
export interface Address {
  warehouse?: string | null;
  location: string | null;
}

/**
 * Whether this address is a last resort. An unranked location is *not* — half
 * the warehouse has no picking_order, containers included, and demoting all of
 * them would change where nearly every pick is sourced from. Only a location
 * someone deliberately ranked out of the way qualifies.
 *
 * An address whose warehouse is unknown never matches, which lands on the safe
 * side: the row is treated as a normal shelf, exactly as before this existed.
 *
 * The threshold itself lives in shared utils: warehouse-management reads the
 * same one to show that a location has been ranked out of the route.
 */
export function isLastResort(
  address: Address | null | undefined,
  order?: PickingOrderMap
): boolean {
  if (!order || !address) return false;
  return isLastResortOrder(order.get(addressKey(address.warehouse, address.location)));
}

/** The subset of an inventory row this comparison needs. */
interface LocatedRow extends Address {
  quantity?: number | null;
}

/**
 * Orders candidate rows best-first: normal shelves before last-resort ones,
 * deepest stock first within each group.
 *
 * Two groups rather than one blended score, because the intent is a hard
 * precedence — a buried pallet is not "worth less", it is where you go once
 * nothing else has the bike. Without the map this is exactly the old
 * quantity sort, so every caller that has no locations loaded behaves as before.
 */
export function byPickPreference<T extends LocatedRow>(
  order?: PickingOrderMap
): (a: T, b: T) => number {
  return (a, b) => {
    const lastA = Number(isLastResort(a, order));
    const lastB = Number(isLastResort(b, order));
    if (lastA !== lastB) return lastA - lastB;
    return Number(b.quantity || 0) - Number(a.quantity || 0);
  };
}

/**
 * Builds the lookup `byPickPreference` expects from raw `locations` rows.
 *
 * Select `warehouse` alongside `location` and `picking_order`: a row without it
 * can never be matched, so the ranking is silently ignored.
 */
export function toPickingOrderMap(
  rows:
    | { warehouse?: string | null; location: string | null; picking_order: number | null }[]
    | null
    | undefined
): PickingOrderMap {
  const map = new Map<string, number | null>();
  for (const row of rows ?? []) {
    map.set(addressKey(row.warehouse, row.location), row.picking_order);
  }
  return map;
}

/** One stop of a pick: the units that come off this exact address. */
export interface PickLeg {
  location: string | null;
  sublocation: string[] | null;
  /** Units to take here. */
  qty: number;
  /** Units the shelf holds — what the picker sees when they get there. */
  available: number;
  isLastResort: boolean;
}

/** How one SKU's pick is covered across the shelves that actually hold it. */
export interface PickPlan {
  legs: PickLeg[];
  /** Units nothing on the floor can cover — a real shortage, not a routing problem. */
  shortfall: number;
}

/**
 * Marks a pick that had to be spread over more than one address, so the card
 * can say which stop it is instead of looking like a duplicate SKU.
 *
 * A type alias rather than an interface on purpose: this rides inside
 * `picking_lists.items`, and only an alias gets the implicit index signature
 * that makes it assignable to the generated `Json` type.
 */
export type PickSplit = {
  /** 1-based stop number. */
  part: number;
  of: number;
  /** Units the whole pick needs, across every leg. */
  totalQty: number;
  isLastResort: boolean;
};

/** A row the planner can allocate from. */
interface PlannableRow extends LocatedRow {
  sublocation?: string[] | null;
}

/** An order row that may be one leg of a split pick. */
interface CollapsibleItem {
  sku: string;
  pickingQty?: number;
  pickSplit?: PickSplit | null;
}

/**
 * Folds a split pick back into a single row for `sku`, keeping the first stop
 * and the full quantity.
 *
 * Corrections address a SKU, not an address — Edit Order has no notion of
 * "leg 2 of 3". Applied leg by leg they misfire in ways that are hard to see
 * afterwards: adjust_qty writes the new quantity onto every leg and multiplies
 * the order, and a swap leaves two rows carrying identical
 * (sku, warehouse, location), which `pick_item` matches by — so the second one
 * can never be checked off.
 *
 * Collapsing first makes the correction mean what the operator meant. Nothing
 * is lost by it: the route is recomputed from live inventory on every rebase,
 * never inherited, so the pick splits again on the way out if the stock still
 * demands it.
 */
export function collapseSplitForSku<T extends CollapsibleItem>(items: T[], sku: string): T[] {
  const legs = items.filter((i) => i.sku === sku && i.pickSplit);
  if (legs.length < 2) return items;

  const totalQty = legs.reduce((sum, i) => sum + Number(i.pickingQty || 0), 0);

  let kept = false;
  const collapsed: T[] = [];
  for (const i of items) {
    if (i.sku !== sku || !i.pickSplit) {
      collapsed.push(i);
      continue;
    }
    if (kept) continue;
    kept = true;
    collapsed.push({ ...i, pickingQty: totalQty, pickSplit: null });
  }
  return collapsed;
}

/**
 * Works out where a pick of `requiredQty` actually comes from.
 *
 * Picking the single deepest shelf is right until the shelf cannot cover the
 * order, and then it is silently wrong: the picker walks to a row holding 13,
 * needs 20, and finishes the job by hand. This returns the whole route instead
 * — reachable shelves first, deepest first so the number of stops stays down,
 * and the buried pallet opened only for whatever is still missing at the end.
 *
 * One stop still beats two whenever a reachable shelf can do the entire job,
 * and `frozenLocation` breaks that tie in favour of staying put: the pick is
 * already pointed there, so moving it for nothing just costs the picker a
 * re-read of the card.
 *
 * A buried shelf that could cover the pick alone deliberately does *not* win
 * that shortcut. Emptying the reachable row first is the point — the units that
 * cost effort to dig out are the ones worth leaving until they are the only
 * ones left.
 */
export function planPickAcrossLocations<T extends PlannableRow>(
  rows: T[],
  requiredQty: number,
  order?: PickingOrderMap,
  frozenLocation?: string | null
): PickPlan {
  const needed = Math.max(0, Math.trunc(Number(requiredQty) || 0));
  if (needed === 0) return { legs: [], shortfall: 0 };

  const available = rows.filter((r) => Number(r.quantity || 0) > 0);
  if (available.length === 0) return { legs: [], shortfall: needed };

  const toLeg = (row: T, qty: number): PickLeg => ({
    location: row.location,
    sublocation: row.sublocation ?? null,
    qty,
    available: Number(row.quantity || 0),
    isLastResort: isLastResort(row, order),
  });

  const reachable = available.filter((r) => !isLastResort(r, order)).sort(byPickPreference(order));

  const frozen = frozenLocation ? norm(frozenLocation) : null;
  const coversAlone = (r: T): boolean => Number(r.quantity || 0) >= needed;
  const solo =
    reachable.find((r) => norm(r.location) === frozen && coversAlone(r)) ??
    reachable.find(coversAlone);
  if (solo) return { legs: [toLeg(solo, needed)], shortfall: 0 };

  const buried = available.filter((r) => isLastResort(r, order)).sort(byPickPreference(order));

  const legs: PickLeg[] = [];
  let remaining = needed;
  for (const row of [...reachable, ...buried]) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(row.quantity || 0));
    if (take <= 0) continue;
    legs.push(toLeg(row, take));
    remaining -= take;
  }

  return { legs, shortfall: remaining };
}
