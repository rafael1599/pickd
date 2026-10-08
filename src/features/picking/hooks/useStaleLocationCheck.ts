import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import {
  buriedUnitsAt,
  byPickPreference,
  isFirstChoice,
  planPickAcrossLocations,
  type PickingOrderMap,
  type PickLeg,
  type PickSplit,
  type SquareGroup,
} from '../utils/pickLocation';
import { fetchPickingOrderMap } from '../api/pickingOrder';

/** A pick whose frozen location can no longer cover it on its own. */
export interface StaleLocationItem {
  sku: string;
  frozenLocation: string;
  warehouse: string | null;
  suggestedLocation: string | null;
  /** Position inside the suggested row, so the picker gets the whole address. */
  suggestedSublocation: string[] | null;
  suggestedQty: number;
  /**
   * Every stop the pick now needs, in walking order. One leg is the old
   * "it moved, go here instead"; more than one means no single shelf covers
   * the order and the pick is split across addresses.
   */
  legs: PickLeg[];
  /** Units even the full route cannot cover — a real shortage. */
  shortfall: number;
}

/** Minimal shape of an order/cart item this check needs. */
interface StaleCheckItem {
  sku: string;
  location: string | null;
  warehouse?: string | null;
  sku_not_found?: boolean;
  sublocation?: string[] | null;
  picked?: boolean;
  /** Drives the split. Absent → the check stays purely "is the shelf empty?". */
  pickingQty?: number;
  insufficient_stock?: boolean;
  pickSplit?: PickSplit | null;
}

/** Minimal shape of an inventory row this check needs. */
export interface StaleInventoryRow {
  sku: string;
  warehouse: string | null;
  location: string | null;
  quantity: number | null;
  /** Absent is treated as active — only an explicit `false` disqualifies a row. */
  is_active?: boolean | null;
  sublocation?: string[] | null;
  /**
   * Los grupos de la fila con su cuadro: sin ellos el motor no sabe qué
   * cuadro está a mano y la fila compite con su cantidad entera.
   */
  distribution?: readonly SquareGroup[] | null;
}

const norm = (s: string | null | undefined): string => (s || '').trim().toUpperCase();

/**
 * Pure detection: given order items and the current inventory rows for their
 * SKUs, return the items whose frozen location can no longer cover the pick on
 * its own, along with the route that can. Only active rows count as real stock
 * so register_new_sku placeholders / ghost rows never qualify as a suggestion.
 * Exported separately so it can be unit-tested without Supabase.
 *
 * Three things put an item in the result. The shelf went empty — someone
 * consolidated the row out from under the order — or it still holds units but
 * fewer than the pick needs, which used to surface as a bare `insufficient_stock`
 * flag even when the rest of the bikes were one row over, or the line never had
 * an address at all. All three are the same question: where does this pick
 * actually come from now.
 */
export interface PlanOptions {
  /**
   * Also replan an arrangement that holds on its own but leaves the cancelled pallet
   * units on the floor.
   *
   * Off by default, because this function's other caller is a drift GUARD: it
   * speaks when an address stopped working, and a shelf that still covers the
   * pick has not stopped working. On, it becomes a PLANNER, which is a
   * different question — where should this pick come from, given everything on
   * the floor right now — and there the returns floor is not optional: those
   * units owe a put-away trip, and the next pick of that SKU is the trip.
   */
  claimReturnsFloor?: boolean;
}

export function detectStaleLocations(
  cartItems: StaleCheckItem[],
  rows: StaleInventoryRow[],
  pickingOrder?: PickingOrderMap,
  opts?: PlanOptions
): StaleLocationItem[] {
  const result: StaleLocationItem[] = [];

  // Grouped by SKU and warehouse, not by row. An order can already name the
  // same SKU at two addresses — a split from an earlier pass, or a hand-added
  // extra — and planning each row on its own lets both of them claim the same
  // units: two rows needing 13 and 7 would each be sent to a shelf holding 15.
  // One SKU is one question, asked once, against the stock as a whole.
  const groups = new Map<string, StaleCheckItem[]>();
  for (const item of cartItems) {
    // A line with no address is not skipped, it is UNPLANNED: it joins its SKU's
    // group with `stockAt('') === 0`, so the arrangement never holds and the
    // planner below gives it a real shelf. That is what lets PickD own the
    // decision the watcher froze at import — and it already covers the
    // `insufficient_stock` lines that carry `location: null` today.
    if (item.sku_not_found) continue;
    const key = `${item.sku}|${norm(item.warehouse)}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const first = group[0];
    const skuRows = rows.filter(
      (r) => r.sku === first.sku && norm(r.warehouse) === norm(first.warehouse)
    );
    if (skuRows.length === 0) continue;

    const stockAt = (location: string | null | undefined): number =>
      skuRows
        .filter((r) => norm(r.location) === norm(location))
        .reduce((sum, r) => sum + Number(r.quantity || 0), 0);

    // Knowing the qty is what separates "it moved" from "it is no longer all in
    // one place". Without one, any stock at all counts, exactly as this read
    // before.
    const required = group.reduce(
      (sum, i) => sum + Math.max(0, Math.trunc(Number(i.pickingQty) || 0)),
      0
    );

    // Nothing to say while every address the order names still covers what it
    // was asked for there.
    const claimed = new Map<string, number>();
    for (const i of group) {
      claimed.set(
        norm(i.location),
        (claimed.get(norm(i.location)) ?? 0) + Math.max(0, Math.trunc(Number(i.pickingQty) || 0))
      );
    }
    const arrangementHolds = [...claimed.entries()].every(([location, qty]) =>
      required > 0 ? stockAt(location) >= qty : stockAt(location) > 0
    );
    // An arrangement that holds still gets replanned when it is ignoring the
    // returns floor — see PlanOptions.claimReturnsFloor.
    const ignoresReturnsFloor =
      !!opts?.claimReturnsFloor &&
      skuRows.some(
        (r) => isFirstChoice(r) && Number(r.quantity || 0) > 0 && r.is_active !== false
      ) &&
      ![...claimed.keys()].some((location) => isFirstChoice({ location }));
    const stocked = skuRows.filter((r) => Number(r.quantity || 0) > 0 && r.is_active !== false);

    // Cubrir no basta si para cubrir hay que desenterrar (8 oct 2026, Rafael:
    // «priorizar rows con acceso a pasillo y menor cantidad»). Una línea que ya
    // apunta a un cuadro enterrado —o a una fila de último recurso— se
    // redirige mientras no esté recogida, si el plan de ahora saca esas
    // unidades de algo a mano. #881852: 03-4038BL seguía en ROW 32 (D y E
    // enterrados) con una line pallet de 7 accesible en ROW 30 E.
    let holds = arrangementHolds && !ignoresReturnsFloor;
    if (holds && required > 0 && stocked.length > 0) {
      const dug = (addresses: Iterable<[string | null, number]>) =>
        [...addresses].reduce(
          (sum, [location, qty]) =>
            sum + buriedUnitsAt(stocked, first.warehouse, location, qty, pickingOrder),
          0
        );
      const dugNow = dug(claimed.entries());
      if (dugNow > 0) {
        const ideal = planPickAcrossLocations(stocked, required, pickingOrder);
        if (dug(ideal.legs.map((l) => [l.location, l.qty])) < dugNow) holds = false;
      }
    }
    if (holds) continue;

    if (stocked.length === 0) continue; // no stock anywhere → genuine out-of-stock, not stale

    if (required === 0) {
      // No qty to plan against: the old behaviour, move the pick somewhere it exists.
      const elsewhere = stocked
        .filter((r) => norm(r.location) !== norm(first.location))
        .sort(byPickPreference(pickingOrder));
      if (elsewhere.length === 0) continue;

      result.push({
        sku: first.sku,
        frozenLocation: first.location ?? '',
        warehouse: first.warehouse ?? null,
        suggestedLocation: elsewhere[0].location,
        suggestedSublocation: elsewhere[0].sublocation ?? null,
        suggestedQty: Number(elsewhere[0].quantity || 0),
        legs: [],
        shortfall: 0,
      });
      continue;
    }

    const plan = planPickAcrossLocations(stocked, required, pickingOrder, first.location);
    if (plan.legs.length === 0) continue;

    // Already right where it is, in one stop — nothing to tell the picker.
    if (
      plan.legs.length === 1 &&
      group.length === 1 &&
      norm(plan.legs[0].location) === norm(first.location)
    ) {
      continue;
    }

    result.push({
      sku: first.sku,
      frozenLocation: first.location ?? '',
      warehouse: first.warehouse ?? null,
      suggestedLocation: plan.legs[0].location,
      suggestedSublocation: plan.legs[0].sublocation,
      suggestedQty: plan.legs[0].available,
      legs: plan.legs,
      shortfall: plan.shortfall,
    });
  }

  return result;
}

/**
 * Moves each pick to wherever its stock actually is.
 *
 * A pick freezes the location the SKU was in when the order was built. Another
 * user consolidating a row hours later leaves that address empty, and every
 * check keyed on it then reads "no stock" for a bike that is sitting one row
 * over — the picker is blocked from sending the order to double-check by an
 * order that is, physically, entirely fillable.
 *
 * Naming the new address is not enough: the item still carries the old one, so
 * whatever the banner says, the guard still fails and the deduction would still
 * be aimed at an empty shelf. This rebases the item itself, which is what makes
 * the rest of the pipeline agree with the floor.
 *
 * When no single shelf covers the pick, the item is split — one row per stop,
 * each carrying the units taken there. The picker gets a card per address
 * instead of a card that quietly asks for more than the shelf holds.
 *
 * Only unpicked items move. A picked one is already on the pallet, so its
 * location is spent history — and rewriting it would read to
 * `compensate_picking_list_changes` as a remove-and-re-add of a picked item,
 * which restores and re-deducts stock for a bike that never moved.
 */
export function rebaseToActualStock<T extends StaleCheckItem>(
  items: T[],
  rows: StaleInventoryRow[],
  pickingOrder?: PickingOrderMap,
  opts?: PlanOptions
): { items: T[]; moves: StaleLocationItem[] } {
  const moves = detectStaleLocations(
    items.filter((i) => !i.picked),
    rows,
    pickingOrder,
    opts
  ).filter((m) => !!m.suggestedLocation);

  if (moves.length === 0) return { items, moves };

  // Keyed on the group the plan was made for, so the whole of a SKU is replaced
  // by the whole of its route. Anything else lets two rows for one SKU each
  // apply the same plan and double the order.
  const byGroup = new Map(moves.map((m) => [`${m.sku}|${norm(m.warehouse)}`, m]));
  const spent = new Set<string>();

  // flatMap, because a pick no single shelf can cover stops being one item.
  // Each leg becomes its own row with its own address and its own share of the
  // qty — which is exactly what the rest of the pipeline is keyed on: pick_item
  // matches (sku, warehouse, location), and process_picking_list deducts per
  // item, so the units come off each shelf in the amount actually taken there.
  const rebased = items.flatMap((item) => {
    if (item.picked) return [item];
    const groupKey = `${item.sku}|${norm(item.warehouse)}`;
    const move = byGroup.get(groupKey);
    if (!move) return [item];

    // The route replaces every row of the group at once, at the position of the
    // first of them. The rest drop out rather than each re-applying it.
    if (spent.has(groupKey)) return [];
    spent.add(groupKey);

    // No qty to plan against: a plain relocation, as this always did.
    if (move.legs.length === 0) {
      return [
        {
          ...item,
          location: move.suggestedLocation,
          sublocation: move.suggestedSublocation,
        },
      ];
    }

    // A shortfall is never planned away. The plan says where the units that
    // exist come from; what it cannot find stays on the order, on the last stop,
    // flagged LOW STOCK — so Double Check says "1 of 2" and the picker decides,
    // with a reason, instead of the order quietly losing a bike. Dropping it
    // turned #881798 (AS400: 2 × 03-4538BL, 1 on the shelf) into an order for
    // one, with no note and no flag (2 oct 2026).
    const short = move.shortfall > 0;

    // One stop covers it. The leg carries the group's whole quantity, which
    // matters when the group was several rows and is now one, and the split tag
    // is cleared so a card left over from an earlier pass stops claiming to be
    // part of a route that no longer exists.
    if (move.legs.length === 1) {
      return [
        {
          ...item,
          location: move.legs[0].location,
          sublocation: move.legs[0].sublocation,
          pickingQty: move.legs[0].qty + move.shortfall,
          insufficient_stock: short,
          pickSplit: null,
        },
      ];
    }

    const totalQty = move.legs.reduce((sum, leg) => sum + leg.qty, 0) + move.shortfall;

    const lastIdx = move.legs.length - 1;
    return move.legs.map((leg, idx) => ({
      ...item,
      location: leg.location,
      sublocation: leg.sublocation,
      pickingQty: idx === lastIdx ? leg.qty + move.shortfall : leg.qty,
      // The route covers the order, so the out-of-stock alarm the single-shelf
      // view raised was about the shelf, not the warehouse. A real shortfall
      // rides on the last stop, and that stop is the one that says so.
      insufficient_stock: short && idx === lastIdx,
      pickSplit: {
        part: idx + 1,
        of: move.legs.length,
        totalQty,
        isLastResort: leg.isLastResort,
      },
    }));
  });

  return { items: rebased, moves };
}

/**
 * Detects stale pick locations for the current order (see {@link detectStaleLocations}).
 *
 * Until 3 Oct 2026 it also left an "[AUTO] Stale pick location" note in the
 * order, which showed up among its instructions as if a person had written it,
 * and fed a banner. Now Double Check only uses it to wake the planner, which
 * writes the new address into the line. Old `[AUTO]` notes still classify as
 * system notes (`systemNotes.ts`); nothing writes new ones.
 *
 * Live (Rafael, 5 Oct 2026: «que sea en vivo»): a change to an `inventory` row
 * of one of the order's SKUs looks again, so a bike moved while the order is
 * open on a phone re-addresses its card there and then, not on the next open.
 */
export function useStaleLocationCheck(
  cartItems: StaleCheckItem[],
  activeListId: string | null | undefined
): StaleLocationItem[] {
  const [stale, setStale] = useState<StaleLocationItem[]>([]);
  const [tick, setTick] = useState(0);

  // The addresses too, not only the SKUs: once the planner re-addresses a line,
  // the check has to look again or it keeps reporting the shelf it left.
  const lineKey = cartItems
    .map((i) => `${i.sku}@${i.location ?? ''}`)
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const skus = [...new Set(cartItems.map((i) => i.sku).filter(Boolean))];
      if (skus.length === 0) {
        setStale([]);
        return;
      }

      const [{ data, error }, pickingOrder] = await Promise.all([
        supabase
          .from('inventory')
          .select('sku, warehouse, location, quantity, is_active, sublocation, distribution')
          .in('sku', skus),
        fetchPickingOrderMap(),
      ]);

      if (cancelled || error || !data) return;

      const result = detectStaleLocations(cartItems, data as StaleInventoryRow[], pickingOrder);
      if (!cancelled) setStale(result);
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey, activeListId, tick]);

  // The SKUs in a ref, so a re-addressed line doesn't resubscribe the channel.
  const skusRef = useRef<Set<string>>(new Set());
  skusRef.current = new Set(cartItems.map((i) => i.sku).filter(Boolean));

  useEffect(() => {
    if (!activeListId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`stale-locations-${activeListId}-${Math.random().toString(36).slice(2, 9)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (payload) => {
        const row = (payload.new ?? {}) as { sku?: string };
        const old = (payload.old ?? {}) as { sku?: string };
        const sku = row.sku ?? old.sku;
        // A delete may arrive with only the id: look again rather than miss it.
        if (sku && !skusRef.current.has(sku)) return;
        // A move is a pair of writes (out of one row, into another): one look.
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          setTick((t) => t + 1);
        }, 800);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [activeListId]);

  return stale;
}
